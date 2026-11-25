// AUTHORED-BY Codex (GPT-6.1 Sol)

import { parseRdf } from "@jeswr/fetch-rdf";
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { serialize } from "@jeswr/rdf-serialize";
import {
  ENTRY_CLASS,
  type EntryData,
  type JournalStore,
  serializeEntry,
} from "@jeswr/solid-journal";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { ensureSample, sampleEntries } from "../src/apps/journal/demo/sample";
import { openJournalData } from "../src/apps/journal/lib/data/store";
import { JournalController } from "../src/apps/journal/state/journal-controller";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const NOW = new Date("2026-11-11T12:00:00Z");
const draft: EntryData = { created: NOW, text: "A quiet day.", mood: "good", tags: ["reflection"] };
const settings = `${DEMO_ROOT}settings/`;
const index = `${settings}privateTypeIndex.ttl`;
const preferences = `${settings}prefs.ttl`;
const profile = DEMO_WEBID.replace(/#.*$/, "");
const privateIndexPointer = "http://www.w3.org/ns/solid/terms#privateTypeIndex";
const preferencesPointer = "http://www.w3.org/ns/pim/space#preferencesFile";
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

async function writeDocument(session: PodSession, url: string, body: string) {
  const head = await session.fetch(url, { method: "HEAD" });
  const etag = head.headers.get("etag");
  const response = await session.fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
    },
    body,
  });
  expect(response.ok).toBe(true);
}

async function pointProfile(session: PodSession, destination?: { predicate: string; url: string }) {
  const read = await session.fetch(profile);
  const dataset = await parseRdf(await read.text(), "text/turtle", { baseIRI: profile });
  const pointer = (iri: string) =>
    SetFrom.subjectPredicate(
      new TermWrapper(DEMO_WEBID, dataset, DataFactory),
      iri,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  pointer(privateIndexPointer).clear();
  if (destination) pointer(destination.predicate).add(destination.url);
  await writeDocument(session, profile, await serialize([...dataset]));
}

async function share(session: PodSession, url: string) {
  const acl = `${url}.acl`;
  const policy = ownerPolicy(DEMO_WEBID, url.endsWith("/"));
  policy.grants.push({
    modes: new Set(["read"]),
    who: [[{ kind: "public" }]],
    except: [],
    appliesTo: url.endsWith("/") ? "members" : "resource",
    source: { url: acl, node: "#public" },
  });
  await writeDocument(session, acl, await writeWac(policy, url, acl));
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

it("refuses to read or write a reserved entry shared after an interrupted create", async () => {
  const { session } = await fixture();
  let reserved: string | undefined;
  let refused = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (
      !refused &&
      init?.method === "PUT" &&
      String(input).startsWith(`${DEMO_ROOT}journal/`) &&
      typeof init.body === "string" &&
      init.body.includes(draft.text)
    ) {
      refused = true;
      reserved = String(input);
      throw new Error("offline");
    }
    return session.fetch(input, init);
  });
  const store = await openJournalData({ ...session, fetch });
  await store.initialize();
  await expect(store.save(draft)).rejects.toMatchObject({ code: "network" });
  if (!reserved) throw new Error("Missing reserved entry");
  await share(session, reserved);
  fetch.mockClear();
  await expect(store.save(draft)).rejects.toThrow("This journal entry is shared");
  expect(
    fetch.mock.calls
      .filter(([input]) => String(input) === reserved)
      .map(([, init]) => init?.method),
  ).toEqual(["HEAD"]);
  expect(await (await session.fetch(reserved)).text()).toBe("");
});

it("reverifies an allocated entry after reading its empty body and before saving private words", async () => {
  const { session } = await fixture();
  let shared: string | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const response = await session.fetch(input, init);
    if (init?.method === "GET" && url.startsWith(`${DEMO_ROOT}journal/`) && url.endsWith(".ttl")) {
      await share(session, url);
      shared = url;
    }
    return response;
  });
  const store = await openJournalData({ ...session, fetch });
  await store.initialize();
  await expect(store.save(draft)).rejects.toThrow("This journal entry is shared");
  if (!shared) throw new Error("Missing reserved entry");
  expect(
    fetch.mock.calls.filter(([input, init]) => String(input) === shared && init?.method === "PUT"),
  ).toHaveLength(1);
  expect(await (await session.fetch(shared)).text()).toBe("");
});

it("keeps a changed placeholder intact and offers the retained draft a fresh URL", async () => {
  const { session } = await fixture();
  let reserved: string | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (
      !reserved &&
      init?.method === "PUT" &&
      String(input).startsWith(`${DEMO_ROOT}journal/`) &&
      typeof init.body === "string" &&
      init.body.includes(draft.text)
    ) {
      reserved = String(input);
      throw new Error("offline");
    }
    return session.fetch(input, init);
  };
  const store = await openJournalData({ ...session, fetch });
  await store.initialize();
  const controller = new JournalController(store, vi.fn());
  controller.save(draft);
  await controller.settled();
  expect(controller.getSnapshot().failed[0]?.conflict).toBe(false);
  if (!reserved) throw new Error("Missing reserved entry");
  const changed = await serializeEntry(reserved, { ...draft, text: "Another tab's words" });
  await writeDocument(session, reserved, changed);
  controller.retryFailed();
  await controller.settled();
  const conflict = controller.getSnapshot().failed[0];
  expect(conflict).toMatchObject({ conflict: true, data: draft });
  if (!conflict) throw new Error("Missing conflicted draft");
  controller.overwriteFailed(conflict.id);
  await controller.settled();
  expect(controller.getSnapshot().failed).toEqual([]);
  expect(controller.getSnapshot().entries).toContainEqual(
    expect.objectContaining({ url: expect.not.stringMatching(reserved), text: draft.text }),
  );
  expect(await (await session.fetch(reserved)).text()).toBe(changed);
});

it("refuses to create a Type Index under shared settings defaults and still opens Journal", async () => {
  const { session, store } = await fixture();
  await share(session, settings);
  const head = await session.fetch(index, { method: "HEAD" });
  const removed = await session.fetch(index, {
    method: "DELETE",
    headers: { "If-Match": head.headers.get("etag") ?? "" },
  });
  expect(removed.ok).toBe(true);
  await store.initialize();
  expect(store.registrationWarning).toContain("owner-only access");
  expect((await session.fetch(index)).status).toBe(404);
  expect(await store.list()).toEqual([]);
});

it("checks a shared preferences document before writing any private registration", async () => {
  const { session, store } = await fixture();
  const original = await (await session.fetch(index)).text();
  await pointProfile(session, { predicate: preferencesPointer, url: preferences });
  await writeDocument(session, preferences, "");
  await share(session, preferences);
  await store.initialize();
  expect(store.registrationWarning).toContain("owner-only access");
  expect(await (await session.fetch(index)).text()).toBe(original);
  expect(await (await session.fetch(preferences)).text()).toBe("");
  expect(await store.list()).toEqual([]);
});

it("registers through private preferences while keeping the WebID profile public", async () => {
  const { session, store } = await fixture();
  await pointProfile(session);
  await share(session, profile);
  await store.initialize();
  expect(store.registrationWarning).toBeUndefined();
  expect(await (await session.fetch(index)).text()).toContain(ENTRY_CLASS);
  expect(await (await session.fetch(preferences)).text()).toContain(index);
  const card = await (await session.fetch(profile)).text();
  expect(card).toContain(preferences);
  expect(card).not.toContain(ENTRY_CLASS);
});

it.each([
  "index",
  "preferences",
] as const)("refuses to use an ACL as the %s document and still opens Journal", async (kind) => {
  const { session, store } = await fixture();
  const acl = `${settings}.acl`;
  await share(session, settings);
  await pointProfile(session, {
    predicate: kind === "index" ? privateIndexPointer : preferencesPointer,
    url: acl,
  });
  const original = await (await session.fetch(acl)).text();
  await store.initialize();
  expect(store.registrationWarning).toContain("valid private Type Index");
  expect(await (await session.fetch(acl)).text()).toBe(original);
  expect(await store.list()).toEqual([]);
});

it("refuses a Type Index destination advertised as the settings access document", async () => {
  const { session } = await fixture();
  const original = await (await session.fetch(index)).text();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await session.fetch(input, init);
    if (String(input) !== settings || init?.method !== "HEAD") return response;
    const headers = new Headers(response.headers);
    headers.set("Link", `<${index}>; rel="acl"`);
    return new Response(null, { status: response.status, headers });
  });
  const store = await openJournalData({ ...session, fetch });
  await store.initialize();
  expect(store.registrationWarning).toContain("valid private Type Index");
  expect(
    fetch.mock.calls.some(([input, init]) => String(input) === index && init?.method === "HEAD"),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(([input, init]) => String(input) === index && init?.method === "GET"),
  ).toBe(false);
  expect(await (await session.fetch(index)).text()).toBe(original);
});

it.each([
  { kind: "photo", megabytes: 10, type: "image/png" },
  { kind: "entry", megabytes: 16, type: "text/turtle" },
  { kind: "acl", megabytes: 1, type: "text/turtle" },
] as const)("cancels an oversized $kind stream as it crosses the byte limit", async ({
  kind,
  megabytes,
  type,
}) => {
  const { session, store } = await fixture();
  await store.initialize();
  const entry = await store.save(draft);
  const photo = await store.attach(new Blob(["photo"], { type: "image/png" }));
  const target = kind === "acl" ? `${entry.url}.acl` : kind === "photo" ? photo : entry.url;
  if (kind === "acl")
    await writeDocument(
      session,
      target,
      await writeWac(ownerPolicy(DEMO_WEBID), entry.url, target),
    );
  const cancel = vi.fn();
  const chunk = new Uint8Array(1024 * 1024);
  let chunks = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) !== target || (init?.method && init.method !== "GET"))
      return session.fetch(input, init);
    return new Response(
      new ReadableStream({
        pull(controller) {
          chunks++;
          if (chunks > megabytes + 2) throw new Error("Read past the cap");
          controller.enqueue(chunk);
        },
        cancel,
      }),
      { headers: { "Content-Type": type } },
    );
  };
  const bounded = await openJournalData({ ...session, fetch });
  await expect(
    kind === "photo" ? bounded.photo(photo) : bounded.read(entry.url),
  ).rejects.toMatchObject({ code: "payload-too-large" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(chunks).toBeGreaterThan(megabytes);
});
