// AUTHORED-BY Codex (GPT-6.1 Sol)

import { ENTRY_CLASS, type EntryData, type JournalStore } from "@jeswr/solid-journal";
import { expect, it, vi } from "vitest";
import { ensureSample, sampleEntries } from "../src/apps/journal/demo/sample";
import { openJournalData } from "../src/apps/journal/lib/data/store";
import { JournalController } from "../src/apps/journal/state/journal-controller";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const NOW = new Date("2026-11-11T12:00:00Z");
const draft: EntryData = { created: NOW, text: "A quiet day.", mood: "good", tags: ["reflection"] };
async function fixture() {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(NOW.getTime(), { calendar: false }),
  });
  const session: PodSession = {
    mode: "demo",
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: "Fictional journal writer",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { pod, session, store: await openJournalData(session) };
}
it("opens a private container, registers privately, round-trips entries and rejects stale updates", async () => {
  const { session, store } = await fixture();
  await store.initialize();
  const first = await store.save(draft);
  expect(first.url).toContain("/journal/");
  expect(first.etag).toBeTruthy();
  expect(await store.list()).toEqual([first]);
  const updated = await store.save({ ...draft, text: "An edited day." }, first);
  expect(updated.text).toBe("An edited day.");
  await expect(store.save(draft, first)).rejects.toMatchObject({ code: "precondition-failed" });
  const indexResponse = await session.fetch(`${DEMO_ROOT}settings/privateTypeIndex.ttl`);
  expect(await indexResponse.text()).toContain(ENTRY_CLASS);
  const acl = await session.fetch(`${store.container}.acl`);
  const access = await acl.text();
  expect(access).toContain(DEMO_WEBID);
  expect(access).not.toContain("AgentClass");
  expect(access).not.toContain("AuthenticatedAgent");
  expect(access).not.toContain("foaf:Agent");
  await store.remove(updated);
  expect(await store.list()).toEqual([]);
});
it("uploads photos through storage, reads authenticated bytes and rejects foreign/active attachments", async () => {
  const { store } = await fixture();
  await store.initialize();
  const url = await store.attach(
    new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
  );
  expect((await store.photo(url)).type).toBe("image/png");
  expect((await store.photo(url)).size).toBe(4);
  await expect(store.attach(new Blob(["<svg/>"], { type: "image/svg+xml" }))).rejects.toThrow(
    "Choose",
  );
  await expect(store.photo("https://foreign.example/photo.png")).rejects.toThrow();
  await expect(store.photo(`${store.container}../profile/card`)).rejects.toThrow();
});
it("seeds fictional entries once, with an on-this-day memory, and doesn't seed live sessions", async () => {
  const { store, session } = await fixture();
  await store.initialize();
  const one = ensureSample(session, store, NOW);
  expect(ensureSample(session, store, NOW)).toBe(one);
  await one;
  expect((await store.list()).length).toBe(sampleEntries(NOW).length);
  const other = { ...session, fetch: vi.fn(session.fetch) };
  await ensureSample(other, store, NOW);
  expect((await store.list()).length).toBe(sampleEntries(NOW).length);
  const noSeed = { list: vi.fn() } as unknown as JournalStore;
  await ensureSample({ ...session, mode: "solid", publicFetch: session.fetch }, noSeed, NOW);
  expect(noSeed.list).not.toHaveBeenCalled();
});
it("permits demo seeding to retry after a failed attempt", async () => {
  const { store, session } = await fixture();
  await store.initialize();
  const list = vi.spyOn(store, "list").mockRejectedValueOnce(new Error("offline"));
  await expect(ensureSample(session, store, NOW)).rejects.toThrow("offline");
  await ensureSample(session, store, NOW);
  expect(list).toHaveBeenCalledTimes(2);
});

it("recovers a real create 412 through an explicitly chosen fresh create", async () => {
  const { session } = await fixture();
  let conflicted = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (
      !conflicted &&
      init?.method === "PUT" &&
      String(input).startsWith(`${DEMO_ROOT}journal/`) &&
      String(input).endsWith(".ttl") &&
      typeof init.body === "string" &&
      init.body.length > 0
    ) {
      conflicted = true;
      return new Response(null, { status: 412 });
    }
    return session.fetch(input, init);
  };
  const store = await openJournalData({ ...session, fetch });
  await store.initialize();
  const controller = new JournalController(store, vi.fn());
  controller.save(draft, undefined, [new Blob(["photo"], { type: "image/png" })]);
  await controller.settled();
  expect(conflicted).toBe(true);
  const conflict = controller.getSnapshot().failed[0];
  expect(conflict).toMatchObject({ conflict: true, key: expect.stringMatching(/^draft:/) });
  controller.overwriteFailed(conflict?.id ?? -1);
  await controller.settled();
  expect(controller.getSnapshot().failed).toEqual([]);
  const entries = await store.list();
  expect(entries).toHaveLength(1);
  expect(entries[0]?.text).toBe(draft.text);
  expect(entries[0]?.images).toHaveLength(1);
});
