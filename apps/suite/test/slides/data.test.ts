// AUTHORED-BY Codex (GPT-6.1 Sol)
import { newDeck } from "@jeswr/solid-slides";
import { expect, it, vi } from "vitest";
import { seedSlides } from "../../src/apps/slides/demo/sample";
import { connectSlides } from "../../src/apps/slides/lib/data/connect";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/seed";
import type { PodSession } from "../../src/lib/session/pod-session";

it("connects to the real demo transport, registers the type and seeds exactly two fictional decks", async () => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  const session: PodSession = {
    mode: "demo",
    fetch: pod.fetch,
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: "Demo",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const repo = await connectSlides(session);
  await repo.initialise();
  const first = seedSlides(session, repo);
  expect(seedSlides(session, repo)).toBe(first);
  await first;
  const decks = await repo.list();
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
it("never seeds a real session and leaves existing demo presentations alone", async () => {
  const repo = { list: vi.fn(async () => [{}]) };
  const session = { mode: "solid", fetch: vi.fn() } as unknown as PodSession;
  await seedSlides(session, repo as never);
  expect(repo.list).not.toHaveBeenCalled();
  await seedSlides({ ...session, mode: "demo" } as PodSession, repo as never);
  expect(repo.list).toHaveBeenCalledTimes(1);
});
it("lets a failed demo seed retry", async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([{}]);
  const session = { mode: "demo", fetch: vi.fn() } as unknown as PodSession;
  const repo = { list };
  await expect(seedSlides(session, repo as never)).rejects.toThrow("offline");
  await seedSlides(session, repo as never);
  expect(list).toHaveBeenCalledTimes(2);
});
it("propagates storage discovery failure", async () => {
  const offline = await connectSlides({
    fetch: vi.fn(async () => {
      throw Error("offline");
    }),
    storageUrl: "https://unavailable.example/",
    webId: "https://unavailable.example/profile#me",
  } as unknown as PodSession);
  await expect(offline.initialise()).rejects.toThrow();
  expect(newDeck().slides).toHaveLength(1);
});
