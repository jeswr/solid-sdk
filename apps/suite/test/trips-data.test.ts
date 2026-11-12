// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { ensureSample } from "../src/apps/trips/demo/sample";
import { openTrips } from "../src/apps/trips/lib/data/open";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

describe("Trips demo data through real storage and type index clients", () => {
  it("opens, seeds once, persists all four generated reservations and registers trips", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.now(), { calendar: false }),
    });
    const session: PodSession = {
      mode: "demo",
      webId: DEMO_WEBID,
      displayName: "Example",
      storageUrl: DEMO_ROOT,
      fetch: pod.fetch,
      subscribe: pod.subscribe,
      reset: async () => {},
    };
    const first = await openTrips(session);
    expect(first.snapshot.trips).toHaveLength(2);
    expect(first.snapshot.reservations).toHaveLength(4);
    expect(first.snapshot.trips.some((trip) => trip.name === "A long weekend in Lisbon")).toBe(
      true,
    );
    expect(first.snapshot.reservations.some((booking) => booking.trust === "unverified")).toBe(
      true,
    );
    await ensureSample(session, first.store);
    expect((await first.store.load()).trips).toHaveLength(2);
    const actual = { ...session, mode: "solid" as const, publicFetch: pod.fetch };
    await ensureSample(actual, first.store);
    expect((await first.store.load()).trips).toHaveLength(2);
  });
});
