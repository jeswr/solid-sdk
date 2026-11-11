// AUTHORED-BY Codex (GPT-6.1 Sol)
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { recipeSubject, serializeMealPlan } from "../src/model.js";
import { recipeStore } from "../src/store.js";

const data = { name: "Soup", ingredients: ["2 eggs"], instructions: ["Mix"] };
async function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol });
  const recipes = await storage.create(storage.root, null, { kind: "container", name: "recipes" });
  const plans = await storage.create(storage.root, null, { kind: "container", name: "meal-plans" });
  const store = recipeStore(storage, recipes.url, plans.url);
  const good = await store.create(data);
  return { storage, store, good, container: recipes.url, planContainer: plans.url };
}

describe.each(["solid", "lws"] as const)("partial recipe listings on %s", (protocol) => {
  it.each([
    ["broken.ttl", "this is not Turtle {", "text/turtle"],
    ["photo.txt", "Not a recipe", "text/plain"],
    ["unrelated.ttl", "", "text/turtle"],
  ])("keeps good recipes and reports %s as skipped", async (name, body, contentType) => {
    const { store, storage, good, container } = await setup(protocol);
    const bad = await storage.create(container, body, { name, contentType });
    const result = await store.list();
    expect(result.recipes).toEqual([good]);
    expect(result.skipped).toEqual([{ url: bad.url, reason: "invalid-data" }]);
  });

  it.each([
    null,
    'W/"weak"',
    "invalid",
    "*",
  ])("loads recipes with ETag %s, refusing only writes", async (etag) => {
    const { store, storage, good } = await setup(protocol);
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (url, options) => ({
      ...(await read(url, options)),
      etag,
    }));
    const result = await store.list();
    expect(result.recipes).toEqual([{ ...good, etag }]);
    expect(result.skipped).toEqual([]);
    const write = vi.spyOn(storage, "write");
    await expect(store.update({ ...good, etag }, data)).rejects.toThrow("safe version");
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    "not-found",
    "not-rdf",
    "invalid-response",
    "unsupported",
  ] as const)("skips one %s resource without hiding another recipe", async (code) => {
    const { store, storage, good } = await setup(protocol);
    const bad = await store.create({ ...data, name: "Unreadable" });
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (url, options) => {
      if (url === bad.url) throw new StorageError(code, { url, method: "GET" });
      return read(url, options);
    });
    const result = await store.list();
    expect(result.recipes).toEqual([good]);
    expect(result.skipped).toEqual([{ url: bad.url, reason: "unreadable" }]);
  });

  it.each([
    "unauthenticated",
    "forbidden",
    "network",
  ] as const)("propagates %s failures from individual reads and either container", async (code) => {
    const { store, storage, good, planContainer } = await setup(protocol);
    const failure = new StorageError(code, { url: good.url, method: "GET" });
    vi.spyOn(storage, "read").mockRejectedValueOnce(failure);
    await expect(store.list()).rejects.toBe(failure);
    const list = storage.listAll.bind(storage);
    vi.spyOn(storage, "listAll").mockImplementation(async function* (url, options) {
      if (url === planContainer) throw failure;
      yield* list(url, options);
    });
    await expect(store.list()).rejects.toBe(failure);
  });
});

it("creates safely only with an observed strong ETag", async () => {
  const { store, storage } = await setup();
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (url, options) => ({
    ...(await read(url, options)),
    etag: null,
  }));
  const write = vi.spyOn(storage, "write");
  await expect(store.create(data)).rejects.toThrow("safe version");
  expect(write).not.toHaveBeenCalled();
});

it("saves destructured plan methods without relisting recipes, including after reopening", async () => {
  const { store, storage, good, container, planContainer } = await setup();
  const another = recipeStore(storage, container, planContainer);
  await another.list();
  const list = vi.spyOn(storage, "listAll");
  const read = vi.spyOn(storage, "read");
  const { savePlan } = another;
  const plan = await savePlan({ name: "2026-11-09", monday: recipeSubject(good.url) });
  expect(plan.url.startsWith(planContainer)).toBe(true);
  await savePlan({ ...plan.data, tuesday: recipeSubject(good.url) }, plan);
  expect(list).not.toHaveBeenCalled();
  expect(read.mock.calls.every(([url]) => url !== good.url)).toBe(true);
  await expect(savePlan({ name: "week", monday: "https://evil.example/r#it" })).rejects.toThrow(
    "Choose a recipe",
  );
  const listed = await store.list();
  expect(listed.recipes).toEqual([good]);
  expect(listed.plans).toHaveLength(1);
});

it("still discovers old plans in recipes/ while new plans use meal-plans/", async () => {
  const { store, storage, container } = await setup();
  const legacy = await storage.create(container, null, {
    name: "old-plan.ttl",
    contentType: "text/turtle",
  });
  const version = await storage.read(legacy.url);
  await storage.write(legacy.url, await serializeMealPlan(legacy.url, { name: "old week" }), {
    contentType: "text/turtle",
    ifMatch: version.etag as string,
  });
  const result = await store.list();
  expect(result.recipes).toHaveLength(1);
  expect(result.plans[0]?.data.name).toBe("old week");
  expect(result.skipped).toEqual([]);
});

it("refreshes the known recipe set and refuses weak plan validators before writing", async () => {
  const { store, storage, good } = await setup();
  const plan = await store.savePlan({ name: "week", monday: recipeSubject(good.url) });
  const write = vi.spyOn(storage, "write");
  await expect(store.savePlan(plan.data, { ...plan, etag: 'W/"weak"' })).rejects.toThrow(
    "safe version",
  );
  expect(write).not.toHaveBeenCalled();
  await storage.delete(good.url, { ifMatch: good.etag as string });
  await store.list();
  await expect(store.savePlan(plan.data, plan)).rejects.toThrow("Choose a recipe");
});
