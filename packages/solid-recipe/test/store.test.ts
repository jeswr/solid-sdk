// AUTHORED-BY Codex (GPT-6.1 Sol)

import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { recipeSubject } from "../src/model.js";
import { openRecipeStore, recipeStore } from "../src/store.js";

const wiring = vi.hoisted(() => ({ client: vi.fn(), register: vi.fn() }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: wiring.client,
}));
vi.mock("@jeswr/pod-type-index", () => ({
  createTypeIndex: () => ({ register: wiring.register }),
}));
const recipe = { name: "Soup", ingredients: ["2 tins beans"], instructions: ["Boil"] };
async function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol, pageSize: 1 });
  const container = (
    await storage.create(storage.root, null, { kind: "container", name: "recipes" })
  ).url;
  return { storage, store: recipeStore(storage, container), container };
}
describe.each(["solid", "lws"] as const)("recipe storage on %s", (protocol) => {
  it("creates at returned URLs, lists all pages, updates conditionally and stores plans", async () => {
    const { store, storage, container } = await setup(protocol);
    const first = await store.create(recipe);
    const second = await store.create({ ...recipe, name: "Toast" }, "toast.ttl");
    expect(first.url.startsWith(container)).toBe(true);
    expect(first.data.name).toBe("Soup");
    const updated = await store.update(first, { ...first.data, favourite: true });
    expect(updated.data.favourite).toBe(true);
    await expect(store.update(first, recipe)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    const plan = await store.savePlan({ name: "2026-11-09", monday: recipeSubject(first.url) });
    await store.savePlan({ ...plan.data, tuesday: recipeSubject(second.url) }, plan);
    await storage.create(container, null, { name: "nested", kind: "container" });
    await storage.create(container, "", { name: "unrelated.ttl", contentType: "text/turtle" });
    expect((await store.list()).recipes).toHaveLength(2);
    expect((await store.list()).plans[0]?.data.tuesday).toBe(recipeSubject(second.url));
    await expect(
      store.savePlan({ name: "week", monday: "https://evil.example/a" }),
    ).rejects.toThrow("Choose a recipe");
    await expect(store.create({ ...recipe, name: " " })).rejects.toThrow();
  });
});
it("maps only missing containers to empty, and propagates access/list/read failures", async () => {
  const { store, storage } = await setup();
  expect(await recipeStore(storage, "https://pod.example/missing/").list()).toEqual({
    recipes: [],
    plans: [],
    skipped: [],
  });
  const saved = await store.create(recipe);
  vi.spyOn(storage, "read").mockRejectedValueOnce(
    new StorageError("not-found", { url: saved.url, method: "GET" }),
  );
  expect((await store.list()).recipes).toEqual([]);
  vi.spyOn(storage, "read").mockRejectedValueOnce(new Error("denied"));
  await expect(store.list()).rejects.toThrow("denied");
});
it("refuses missing/weak versions and changed newly created resources", async () => {
  const { store, storage } = await setup();
  const first = await store.create(recipe);
  await expect(store.update({ ...first, etag: "" }, recipe)).rejects.toThrow("safe version");
  await expect(store.update({ ...first, etag: 'W/"a"' }, recipe)).rejects.toThrow("safe version");
  await expect(store.update({ ...first, etag: "*" }, recipe)).rejects.toThrow("safe version");
  const original = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (url, options) => ({
    ...(await original(url, options)),
    text: async () => "changed",
  }));
  await expect(store.create(recipe)).rejects.toThrow("another writer");
});
it("opens storage, creates recipes/ once and reports Type Index failures without hiding recipes", async () => {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol: "solid" });
  wiring.client.mockResolvedValue({ storage, features: storage.features });
  wiring.register.mockResolvedValue(undefined);
  const input = {
    storageUrl: storage.root,
    webId: `${storage.root}profile#me`,
    fetch: vi.fn() as unknown as typeof fetch,
  };
  const first = await openRecipeStore(input);
  expect(first.container).toBe("https://pod.example/recipes/");
  expect(wiring.register).toHaveBeenCalledWith("http://schema.org/Recipe", {
    container: first.container,
  });
  expect(wiring.register).toHaveBeenCalledWith("https://jeswr.org/ns/recipe#MealPlan", {
    container: "https://pod.example/meal-plans/",
  });
  const savedRecipe = await first.create(recipe);
  const savedPlan = await first.savePlan({ name: "week", monday: recipeSubject(savedRecipe.url) });
  expect(savedPlan.url.startsWith("https://pod.example/meal-plans/")).toBe(true);
  wiring.register.mockRejectedValueOnce(new Error("index denied"));
  expect((await openRecipeStore(input)).registrationError).toBeInstanceOf(Error);
  vi.spyOn(storage, "head").mockRejectedValueOnce(new Error("access denied"));
  await expect(openRecipeStore(input)).rejects.toThrow("access denied");
});

it("uses a Turtle default when media type is absent and fails closed on unreadable saved data", async () => {
  const { store, storage } = await setup();
  const first = await store.create(recipe);
  const original = storage.read.bind(storage);
  const read = vi.spyOn(storage, "read");
  read.mockImplementationOnce(async (url, options) => ({
    ...(await original(url, options)),
    contentType: null,
  }));
  expect((await store.list()).recipes).toHaveLength(1);
  read.mockImplementationOnce(async (url, options) => ({
    ...(await original(url, options)),
    text: async () => "",
  }));
  await expect(store.update(first, recipe)).rejects.toThrow("Couldn't read the saved recipe");
  read.mockImplementation(async (url, options) => ({
    ...(await original(url, options)),
    text: async () => "",
  }));
  await expect(store.create(recipe)).rejects.toThrow("Couldn't read the saved recipe");
  vi.spyOn(store, "list").mockResolvedValue({ recipes: [first], plans: [], skipped: [] });
  await expect(store.savePlan({ name: "week" })).rejects.toThrow(
    "Couldn't read the saved meal plan",
  );
});

it("rejects a listing above the bound without returning partial results", async () => {
  const { store, storage, container } = await setup();
  const empty = await storage.create(container, "", { contentType: "text/turtle" });
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    for (let index = 0; index < 2001; index++)
      yield {
        url: empty.url,
        kind: "resource",
        contentType: "text/turtle",
        size: 0,
        modified: null,
        types: [],
      };
  });
  await expect(store.list()).rejects.toThrow("too large");
});

it.each([
  "conflict",
  "precondition-failed",
] as const)("rechecks a container created concurrently (%s)", async (code) => {
  const { storage, container } = await setup();
  wiring.client.mockResolvedValue({ storage, features: storage.features });
  wiring.register.mockResolvedValue(undefined);
  vi.spyOn(storage, "head").mockRejectedValueOnce(
    new StorageError("not-found", { url: container, method: "HEAD" }),
  );
  vi.spyOn(storage, "create").mockRejectedValueOnce(
    new StorageError(code, { url: container, method: "PUT" }),
  );
  expect(
    (await openRecipeStore({ fetch, storageUrl: storage.root, webId: `${storage.root}profile#me` }))
      .container,
  ).toBe(container);
});
it.each([
  new Error("offline"),
  new StorageError("forbidden", { url: "https://pod.example/recipes/", method: "PUT" }),
])("does not swallow a non-conflict create failure", async (failure) => {
  const { storage, container } = await setup();
  wiring.client.mockResolvedValue({ storage, features: storage.features });
  vi.spyOn(storage, "head").mockRejectedValueOnce(
    new StorageError("not-found", { url: container, method: "HEAD" }),
  );
  vi.spyOn(storage, "create").mockRejectedValueOnce(failure);
  await expect(
    openRecipeStore({ fetch, storageUrl: storage.root, webId: `${storage.root}profile#me` }),
  ).rejects.toBe(failure);
});
