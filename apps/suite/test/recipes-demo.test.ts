// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openRecipeStore } from "@jeswr/solid-recipe";
import { expect, it } from "vitest";
import { ensureSample, SAMPLE_RECIPES } from "../src/apps/recipes/demo/sample";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

it("opens and seeds the real browser demo transport, with discoverable Type Index registration", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(now, { calendar: false }),
    now: () => now,
  });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Fictional demo cook",
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const store = await openRecipeStore({ ...session, protocol: "solid" });
  expect(store.registrationError).toBeUndefined();
  await ensureSample(session, store, new Date(now));
  const content = await store.list();
  expect(content.recipes).toHaveLength(SAMPLE_RECIPES.length);
  expect(content.plans).toHaveLength(1);
  const reopened = await openRecipeStore({ ...session, protocol: "solid" });
  expect((await reopened.list()).recipes).toHaveLength(SAMPLE_RECIPES.length);
});
