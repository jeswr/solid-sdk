// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6

import { checkOwnerOnly } from "@jeswr/pod-access";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { recipeSubject } from "../src/model.js";
import { openRecipeStore, recipeStore } from "../src/store.js";

const wiring = vi.hoisted(() => ({ client: vi.fn(), index: vi.fn(), register: vi.fn() }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: wiring.client,
}));
vi.mock("@jeswr/pod-type-index", () => ({
  createTypeIndex: wiring.index,
}));
vi.mock("@jeswr/pod-access", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-access")>()),
  checkOwnerOnly: vi.fn(async () => ({ private: true })),
}));
wiring.index.mockImplementation(() => ({ register: wiring.register }));
const OWNER = "https://pod.example/profile#me";
const recipe = { name: "Soup", ingredients: ["2 tins beans"], instructions: ["Boil"] };
async function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol, pageSize: 1 });
  const container = (
    await storage.create(storage.root, null, { kind: "container", name: "recipes" })
  ).url;
  return { storage, store: recipeStore(storage, container, container, OWNER), container };
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
    if (protocol === "solid") {
      const plan = await store.savePlan({ name: "2026-11-09", monday: recipeSubject(first.url) });
      await store.savePlan({ ...plan.data, tuesday: recipeSubject(second.url) }, plan);
      expect((await store.list()).plans[0]?.data.tuesday).toBe(recipeSubject(second.url));
      await expect(store.savePlan({ ...plan.data, monday: undefined }, plan)).rejects.toMatchObject(
        {
          code: "precondition-failed",
        },
      );
    } else {
      await expect(store.savePlan({ name: "2026-11-09" })).rejects.toThrow(
        "does not support reserving one meal plan",
      );
    }
    await storage.create(container, null, { name: "nested", kind: "container" });
    await storage.create(container, "", { name: "unrelated.ttl", contentType: "text/turtle" });
    expect((await store.list()).recipes).toHaveLength(2);
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

it("uses a Turtle default for listings and rejects updates to a different RDF type", async () => {
  const { store, storage } = await setup();
  const first = await store.create(recipe);
  const original = storage.read.bind(storage);
  const read = vi.spyOn(storage, "read");
  read.mockImplementationOnce(async (url, options) => ({
    ...(await original(url, options)),
    contentType: null,
  }));
  expect((await store.list()).recipes).toHaveLength(1);
  const other = await storage.create(store.container, "", { contentType: "text/turtle" });
  await expect(
    store.update({ ...first, url: other.url, etag: other.etag }, recipe),
  ).rejects.toThrow("Couldn't read the recipe to update");
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

it("refuses personal writes when the collection or allocated resource is public", async () => {
  const { store, storage, container } = await setup();
  const good = await store.create(recipe);
  const create = vi.spyOn(storage, "create");
  const write = vi.spyOn(storage, "write");
  const denied = { private: false, reasons: [] } as const;
  vi.mocked(checkOwnerOnly).mockResolvedValueOnce({ ...denied, reasons: [] });
  await expect(store.create({ ...recipe, rating: 4 })).rejects.toThrow("owner-only");
  vi.mocked(checkOwnerOnly).mockResolvedValueOnce({ ...denied, reasons: [] });
  await expect(store.savePlan({ name: "2026-11-09" })).rejects.toThrow("owner-only");
  expect(create).not.toHaveBeenCalled();

  vi.mocked(checkOwnerOnly).mockImplementation(async ({ url }) =>
    url === container ? { private: true } : { private: false, reasons: [] },
  );
  try {
    await expect(store.create({ ...recipe, rating: 4 })).rejects.toThrow("owner-only");
    await expect(store.update(good, { ...recipe, rating: 5 })).rejects.toThrow("owner-only");
    expect(create).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  } finally {
    vi.mocked(checkOwnerOnly).mockResolvedValue({ private: true });
  }
});

it("keeps an acknowledged create after the write even when no usable ETag or GET is available", async () => {
  const { store, storage } = await setup();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
    const result = await write(...args);
    vi.spyOn(storage, "read").mockRejectedValueOnce(new Error("GET unavailable"));
    return { ...result, etagSource: "follow-up" };
  });
  const saved = await store.create(recipe);
  expect(saved).toMatchObject({ data: { name: "Soup" }, etag: null });
  vi.mocked(storage.read).mockRestore();
  expect((await store.list()).recipes.map(({ url }) => url)).toEqual([saved.url]);
});

it.each([
  false,
  true,
])("retries the same allocation after a failed placeholder read or ambiguous write (%s)", async (afterWrite) => {
  const { store, storage } = await setup();
  const create = vi.spyOn(storage, "create");
  const failure = new StorageError("network", { url: store.container, method: "GET" });
  if (afterWrite) {
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
      await write(...args);
      throw failure;
    });
  } else vi.spyOn(storage, "read").mockRejectedValueOnce(failure);
  await expect(store.create(recipe)).rejects.toBe(failure);
  const saved = await store.create(recipe);
  expect(create).toHaveBeenCalledOnce();
  expect((await store.list()).recipes).toEqual([saved]);
});

it("merges simultaneous first assignments into the same conditionally created Solid week", async () => {
  const { store, storage, container } = await setup();
  const soup = await store.create(recipe);
  const toast = await store.create({ ...recipe, name: "Toast" });
  const other = recipeStore(storage, container, container, OWNER);
  await other.list();
  const name = "2026-11-09";
  const [monday, tuesday] = await Promise.all([
    store.savePlan({ name, monday: recipeSubject(soup.url) }),
    other.savePlan({ name, tuesday: recipeSubject(toast.url) }),
  ]);
  expect(monday.url).toBe(tuesday.url);
  expect((await other.list()).plans).toEqual([
    expect.objectContaining({
      url: monday.url,
      data: expect.objectContaining({
        name,
        monday: recipeSubject(soup.url),
        tuesday: recipeSubject(toast.url),
      }),
    }),
  ]);
});

it("reopens both opaque LWS collections using the markers saved on the pod", async () => {
  const storage = createMemoryStorage({
    root: "https://pod.example/",
    protocol: "lws",
    pageSize: 1,
  });
  wiring.client.mockResolvedValue({ storage });
  const create = storage.create.bind(storage);
  const allocate = vi.spyOn(storage, "create");
  allocate.mockImplementationOnce((url, body, opts) =>
    create(url, body, { ...opts, name: "opaque-one" }),
  );
  allocate.mockImplementationOnce((url, body, opts) =>
    create(url, body, { ...opts, name: "opaque-two" }),
  );
  const input = { storageUrl: storage.root, webId: OWNER, fetch };
  const first = await openRecipeStore(input);
  expect(first.container).toBe(`${storage.root}opaque-one/`);
  const saved = await first.create(recipe);
  const plan = await storage.create(`${storage.root}opaque-two/`, null, {
    contentType: "text/turtle",
  });
  const { serializeMealPlan } = await import("../src/model.js");
  await storage.write(plan.url, await serializeMealPlan(plan.url, { name: "week" }), {
    contentType: "text/turtle",
    ifMatch: plan.etag as string,
  });
  allocate.mockClear();
  const reopened = await openRecipeStore(input);
  expect(reopened.container).toBe(first.container);
  expect(await reopened.list()).toMatchObject({
    recipes: [saved],
    plans: [{ url: plan.url, data: { name: "week" } }],
  });
  expect(allocate).not.toHaveBeenCalled();
});

it("opens and saves recipes when the Type Index rejects a foreign WebID", async () => {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol: "solid" });
  wiring.client.mockResolvedValue({ storage });
  const { createTypeIndex } =
    await vi.importActual<typeof import("@jeswr/pod-type-index")>("@jeswr/pod-type-index");
  wiring.index.mockImplementationOnce(createTypeIndex);
  const store = await openRecipeStore({
    storageUrl: storage.root,
    webId: "https://profile.example/card#me",
    fetch,
  });
  expect(store.registrationError).toMatchObject({ code: "scope" });
  const saved = await store.create(recipe);
  expect((await store.list()).recipes).toEqual([saved]);
});

it("skips an oversized representation through the storage reader's byte cap", async () => {
  const { store, storage, container } = await setup();
  const good = await store.create(recipe);
  const oversized = await storage.create(container, " ".repeat(1_048_577), {
    contentType: "text/turtle",
  });
  expect(await store.list()).toEqual({
    recipes: [good],
    plans: [],
    skipped: [{ url: oversized.url, reason: "unreadable" }],
  });
});
