// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { newDeck } from "@jeswr/solid-slides";
import { expect, it, vi } from "vitest";
import { seedSlides } from "../../src/apps/slides/demo/sample";
import { connectSlides } from "../../src/apps/slides/lib/data/connect";
import { slideImageFetch } from "../../src/apps/slides/lib/data/image-transport";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/seed";
import type { PodSession } from "../../src/lib/session/pod-session";

async function demoSession(): Promise<PodSession> {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  return {
    mode: "demo",
    fetch: pod.fetch,
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: "Demo",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
}

it("connects to the real demo transport, registers the type and seeds exactly two fictional decks", async () => {
  const session = await demoSession();
  const repo = await connectSlides(session);
  await repo.initialise();
  const first = seedSlides(session, repo);
  expect(seedSlides(session, repo)).toBe(first);
  await first;
  const { decks, broken } = await repo.list();
  expect(broken).toEqual([]);
  expect(decks.map((entry) => entry.deck.name).sort()).toEqual([
    "A greener neighbourhood",
    "Paper Moon Studio",
  ]);
  const firstDeck = decks[0];
  if (!firstDeck) throw new Error("Expected sample presentation");
  const saved = await repo.save(firstDeck, { ...firstDeck.deck, name: "Renamed" });
  expect((await repo.read(saved.url)).deck.name).toBe("Renamed");
  const index = await session.fetch(`${DEMO_ROOT}settings/privateTypeIndex.ttl`);
  expect(await index.text()).toContain("PresentationDigitalDocument");
});
it("repairs a sample an interrupted seed left empty or broken", async () => {
  const session = await demoSession();
  const repo = await connectSlides(session);
  await repo.initialise();
  const garden = `${repo.container}sample-garden.ttl`;
  await session.fetch(garden, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: "",
  });
  await seedSlides(session, repo);
  expect((await repo.list()).decks.map((entry) => entry.deck.name).sort()).toEqual([
    "A greener neighbourhood",
    "Paper Moon Studio",
  ]);
  // A broken sample beside a valid deck is repaired too, on the next session.
  const next = { ...session, fetch: session.fetch.bind(null) } as PodSession;
  const current = await session.fetch(garden, { method: "HEAD" });
  await session.fetch(garden, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-match": current.headers.get("etag") ?? "" },
    body: "<broken",
  });
  expect((await repo.list()).broken).toEqual([{ url: garden, reason: "invalid" }]);
  await seedSlides(next, repo);
  expect((await repo.list()).broken).toEqual([]);
});
it("never seeds a real session and leaves existing demo presentations alone", async () => {
  const repo = {
    container: "https://pod.example/slides/",
    list: vi.fn(async () => ({ decks: [{}], broken: [] })),
    ensure: vi.fn(),
  };
  const session = { mode: "solid", fetch: vi.fn() } as unknown as PodSession;
  await seedSlides(session, repo as never);
  expect(repo.list).not.toHaveBeenCalled();
  await seedSlides({ ...session, mode: "demo" } as PodSession, repo as never);
  expect(repo.list).toHaveBeenCalledTimes(1);
  expect(repo.ensure).not.toHaveBeenCalled();
});
it("lets a failed demo seed retry", async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ decks: [{}], broken: [] });
  const session = { mode: "demo", fetch: vi.fn() } as unknown as PodSession;
  const repo = { container: "https://pod.example/slides/", list };
  await expect(seedSlides(session, repo as never)).rejects.toThrow("offline");
  await seedSlides(session, repo as never);
  expect(list).toHaveBeenCalledTimes(2);
});
it("discovers real pods and propagates discovery failure instead of guessing a protocol", async () => {
  const offline = vi.fn(async () => {
    throw Error("offline");
  });
  await expect(
    connectSlides({
      mode: "solid",
      fetch: offline,
      storageUrl: "https://unavailable.example/",
      webId: "https://unavailable.example/profile#me",
    } as unknown as PodSession),
  ).rejects.toThrow();
  // The demo pod advertises no storage description; only demo sessions may assume Solid.
  const demo = await demoSession();
  await expect(connectSlides({ ...demo, mode: "solid" } as PodSession)).rejects.toMatchObject({
    code: "no-storage-link",
  });
  expect(newDeck().slides).toHaveLength(1);
});
it("sends pod credentials only to the signed-in pod", async () => {
  const fetch = vi.fn();
  const publicFetch = vi.fn();
  const solid = {
    mode: "solid",
    storageUrl: "https://pod.example/alice/",
    fetch,
    publicFetch,
  } as unknown as PodSession;
  expect(slideImageFetch(solid, "https://pod.example/alice/slides/a.png")).toBe(fetch);
  expect(slideImageFetch(solid, "https://pod.example/bob/a.png")).toBe(publicFetch);
  expect(slideImageFetch(solid, "https://tracker.example/a.png")).toBe(publicFetch);
  const demo = { ...solid, mode: "demo" } as unknown as PodSession;
  expect(slideImageFetch(demo, "https://pod.example/alice/a.png")).toBe(fetch);
  const anonymous = slideImageFetch(demo, "https://tracker.example/a.png");
  expect(anonymous).not.toBe(fetch);
  const global = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x"));
  await anonymous("https://tracker.example/a.png", { redirect: "error" });
  expect(global).toHaveBeenCalledWith("https://tracker.example/a.png", {
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  global.mockRestore();
});
