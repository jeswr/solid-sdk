// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { type Grant, ownerPolicy, writeWac } from "@jeswr/pod-access";
import { openRecipeStore } from "@jeswr/solid-recipe";
import { expect, it, vi } from "vitest";
import { ensureSample, SAMPLE_RECIPES } from "../src/apps/recipes/demo/sample";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

function publicRead(aclUrl: string, appliesTo: Grant["appliesTo"]): Grant {
  return {
    modes: new Set(["read"]),
    who: [[{ kind: "public" }]],
    except: [],
    appliesTo,
    source: { url: aclUrl, node: `${aclUrl}#public` },
  };
}

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

it("refuses recipe and plan saves when the demo transport advertises inherited public access", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const policy = ownerPolicy(DEMO_WEBID, true);
  const aclUrl = new URL(".acl", DEMO_ROOT).href;
  policy.grants.push(publicRead(aclUrl, "members"));
  const body = await writeWac(policy, DEMO_ROOT, aclUrl);
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: (await buildDemoSeed(now, { calendar: false })).map((file) =>
      file.path === ".acl" ? { ...file, body } : file,
    ),
    now: () => now,
  });
  const fetch = vi.fn(pod.fetch);
  const store = await openRecipeStore({
    fetch,
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    protocol: "solid",
  });
  expect(store.registrationError).toMatchObject({ name: "RecipePrivacyError" });
  fetch.mockClear();
  await expect(
    store.create({ name: "Private", ingredients: [], instructions: [], rating: 5 }),
  ).rejects.toThrow("owner-only");
  await expect(store.savePlan({ name: "2026-11-09" })).rejects.toThrow("owner-only");
  expect(
    fetch.mock.calls.every(([, init]) => init?.method === "HEAD" || init?.method === "GET"),
  ).toBe(true);
});

it("keeps the store usable when the advertised private Type Index is publicly readable", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const path = "settings/privateTypeIndex.ttl.acl";
  const index = new URL("settings/privateTypeIndex.ttl", DEMO_ROOT).href;
  const aclUrl = new URL(path, DEMO_ROOT).href;
  const policy = ownerPolicy(DEMO_WEBID);
  policy.grants.push(publicRead(aclUrl, "resource"));
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: [
      ...(await buildDemoSeed(now, { calendar: false })),
      {
        path,
        body: await writeWac(policy, index, aclUrl),
        contentType: "text/turtle",
        modified: now,
      },
    ],
  });
  const fetch = vi.fn(pod.fetch);
  const store = await openRecipeStore({
    fetch,
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    protocol: "solid",
  });
  expect(store.registrationError).toMatchObject({ name: "RecipePrivacyError" });
  expect(fetch.mock.calls.some(([url, init]) => url === index && init?.method === "PUT")).toBe(
    false,
  );
  const saved = await store.create({ name: "Private", ingredients: [], instructions: [] });
  expect((await store.list()).recipes).toEqual([saved]);
});
