// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type RecipeData,
  type RecipeRecord,
  type RecipeStore,
  recipeStore,
} from "@jeswr/solid-recipe";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { ensureSample, SAMPLE_RECIPES } from "../src/apps/recipes/demo/sample";
import { filterRecipes, recipeFromForm, weekDays } from "../src/apps/recipes/lib/recipes";
import { createRecipeState } from "../src/apps/recipes/state/recipe-state";
import type { PodSession } from "../src/lib/session/pod-session";

const data: RecipeData = {
  name: "Soup",
  ingredients: ["2 tins beans"],
  instructions: ["Boil"],
  favourite: false,
};
const record: RecipeRecord = { url: "https://pod.example/recipes/a", etag: '"1"', data };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup() {
  const store: RecipeStore = {
    container: "https://pod.example/recipes/",
    list: vi.fn(async () => ({ recipes: [record], plans: [] })),
    create: vi.fn(async (value) => ({ ...record, url: `${record.url}new`, data: value })),
    update: vi.fn(async (original, value) => ({ ...original, data: value, etag: '"2"' })),
    savePlan: vi.fn(async (value) => ({ url: `${record.url}plan`, etag: '"1"', data: value })),
  };
  const errors = vi.fn();
  return { store, errors, state: createRecipeState(store, errors) };
}
describe("recipe view helpers", () => {
  it("searches terms across name, ingredients, description, author and tags with intersecting filters", () => {
    const recipes = [
      record,
      {
        ...record,
        url: "b",
        data: {
          ...data,
          name: "Pancakes",
          category: "Breakfast",
          cuisine: "British",
          description: "Fluffy",
          keywords: ["Weekend"],
          author: "Fictional Cook",
          favourite: true,
        },
      },
    ];
    expect(filterRecipes(recipes, "  BEANS Soup ", "", "", false)).toEqual([record]);
    expect(
      filterRecipes(recipes, "cook weekend fluffy", "Breakfast", "British", true),
    ).toHaveLength(1);
    expect(filterRecipes(recipes, "", "Dinner", "", false)).toEqual([]);
    expect(filterRecipes(recipes, "", "", "Italian", false)).toEqual([]);
    expect(filterRecipes(recipes, "", "", "", true)[0]?.data.name).toBe("Pancakes");
    expect(filterRecipes(recipes, "", "", "", false).map((row) => row.data.name)).toEqual([
      "Pancakes",
      "Soup",
    ]);
  });
  it("uses Monday-start weeks across month, year and DST boundaries", () => {
    expect(weekDays(new Date("2026-11-11T12:00:00Z"))).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(weekDays(new Date("2027-01-03T12:00:00Z"))[0]).toBe("2026-12-28");
    expect(weekDays(new Date("2026-03-29T12:00:00Z"), 1)[0]).toBe("2026-03-30");
  });
  it("converts a raw form, preserves created/favourite and reports invalid fields", () => {
    const form = new FormData();
    form.set("name", "  Soup  ");
    form.set("ingredients", "beans\n\n water ");
    form.set("instructions", "Boil\r\nServe");
    form.set("keywords", "quick, , easy");
    form.set("rating", "4.5");
    form.set("prepTime", "10");
    const now = new Date("2026-11-11T12:00:00Z");
    expect(recipeFromForm(form, undefined, now)).toMatchObject({
      name: "Soup",
      ingredients: ["beans", "water"],
      instructions: ["Boil", "Serve"],
      keywords: ["quick", "easy"],
      rating: 4.5,
      created: now,
      modified: now,
      favourite: false,
    });
    const created = new Date("2020-01-01");
    expect(recipeFromForm(form, { ...data, favourite: true, created }, now)).toMatchObject({
      created,
      favourite: true,
    });
    form.delete("rating");
    expect(recipeFromForm(form).rating).toBeUndefined();
    form.set("image", "javascript:bad");
    expect(() => recipeFromForm(form)).toThrow();
    form.delete("image");
    form.set("prepTime", "ten minutes");
    expect(() => recipeFromForm(form)).toThrow();
    form.set("prepTime", "-1");
    expect(() => recipeFromForm(form)).toThrow();
    form.set("prepTime", "0");
    expect(recipeFromForm(form).prepTime).toBe("PT0M");
    expect(() => recipeFromForm(new FormData())).toThrow("name");
  });
});
describe("recipe optimistic state", () => {
  it("drops a successful write callback after disposal", async () => {
    const { state, store } = setup();
    await state.refresh();
    const pending = deferred<RecipeRecord>();
    vi.mocked(store.update).mockReturnValueOnce(pending.promise);
    state.favourite(record.url);
    state.dispose();
    const before = state.getSnapshot();
    pending.resolve({ ...record, data: { ...data, favourite: true } });
    await Promise.resolve();
    await Promise.resolve();
    expect(state.getSnapshot()).toBe(before);
  });
  it("ignores an older rejected refresh after a newer read succeeds", async () => {
    const { state, store } = setup();
    const old = deferred<{ recipes: RecipeRecord[]; plans: [] }>();
    vi.mocked(store.list).mockReturnValueOnce(old.promise);
    const pending = state.refresh();
    await state.refresh();
    old.reject(new Error("late"));
    await pending;
    expect(state.getSnapshot().status).toBe("ready");
  });
  it("keeps other recipes intact and rejects dependent edits of a failed create", async () => {
    const { state, store, errors } = setup();
    await state.refresh();
    state.save({ ...data, name: "Toast" });
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    state.favourite(record.url);
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(state.getSnapshot().recipes[1]?.data.name).toBe("Toast");
    const failed = deferred<RecipeRecord>();
    vi.mocked(store.create).mockReturnValueOnce(failed.promise);
    state.save(data);
    const temporary = state.getSnapshot().recipes.at(-1)?.url;
    if (!temporary) throw new Error("Missing optimistic recipe");
    state.favourite(temporary);
    failed.reject(new Error("create failed"));
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(errors).toHaveBeenCalledTimes(2);
    expect(state.getSnapshot().recipes).toHaveLength(2);
  });
  it("keeps loaded recipes available when a pod read goes offline", async () => {
    const { state, store } = setup();
    await state.refresh();
    vi.mocked(store.list).mockRejectedValueOnce(
      new StorageError("network", { method: "GET", url: store.container }),
    );
    await state.refresh();
    expect(state.getSnapshot()).toMatchObject({ status: "ready", recipes: [record] });
  });
  it("does not resurrect a failed favourite change through a later editor save", async () => {
    const { state, store } = setup();
    await state.refresh();
    const failed = deferred<RecipeRecord>();
    vi.mocked(store.update).mockReturnValueOnce(failed.promise);
    state.favourite(record.url);
    state.save({ ...data, name: "Edited soup", favourite: true }, record.url);
    failed.reject(new Error("failed favourite"));
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(state.getSnapshot().recipes[0]?.data).toMatchObject({
      name: "Edited soup",
      favourite: false,
    });
  });
  it("paints immediately, rolls back failure and retains a newer favourite intent", async () => {
    const { store, state, errors } = setup();
    await state.refresh();
    const failed = deferred<RecipeRecord>();
    vi.mocked(store.update).mockReturnValueOnce(failed.promise);
    const listener = vi.fn();
    const stop = state.subscribe(listener);
    state.favourite(record.url);
    expect(state.getSnapshot().recipes[0]?.data.favourite).toBe(true);
    state.favourite(record.url);
    expect(state.getSnapshot().recipes[0]?.data.favourite).toBe(false);
    expect(state.getSnapshot().pending).toBe(2);
    await state.refresh();
    expect(store.list).toHaveBeenCalledOnce();
    failed.reject(new Error("offline"));
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(state.getSnapshot().recipes[0]?.data.favourite).toBe(false);
    expect(errors).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();
    stop();
    const before = listener.mock.calls.length;
    await state.refresh();
    expect(listener).toHaveBeenCalledTimes(before);
  });
  it("recomputes two failed writes from the confirmed baseline", async () => {
    const { state, store } = setup();
    await state.refresh();
    vi.mocked(store.update).mockRejectedValue(new Error("no"));
    state.favourite(record.url);
    state.favourite(record.url);
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(state.getSnapshot().recipes[0]?.data.favourite).toBe(false);
  });
  it("creates and edits asynchronously and applies day changes to a single weekly plan", async () => {
    const { state, store } = setup();
    await state.refresh();
    state.save({ ...data, name: "Toast" });
    expect(state.getSnapshot().recipes).toHaveLength(2);
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    state.save({ ...data, name: "Bean soup" }, record.url);
    state.assign("2026-11-09", "monday", `${record.url}#it`);
    state.assign("2026-11-09", "tuesday", `${record.url}#it`);
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(state.getSnapshot().recipes[0]?.data.name).toBe("Bean soup");
    expect(state.getSnapshot().plans).toHaveLength(1);
    expect(state.getSnapshot().plans[0]?.data).toMatchObject({
      monday: `${record.url}#it`,
      tuesday: `${record.url}#it`,
    });
    state.assign("2026-11-09", "monday", undefined);
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(0));
    expect(state.getSnapshot().plans[0]?.data.monday).toBeUndefined();
    expect(store.savePlan).toHaveBeenCalledTimes(3);
  });
  it("ignores stale refreshes and clears data when a fresh read fails", async () => {
    const { state, store } = setup();
    const slow = deferred<{ recipes: RecipeRecord[]; plans: [] }>();
    vi.mocked(store.list).mockReturnValueOnce(slow.promise);
    const stale = state.refresh();
    await state.refresh();
    slow.resolve({ recipes: [], plans: [] });
    await stale;
    expect(state.getSnapshot().recipes).toHaveLength(1);
    vi.mocked(store.list).mockRejectedValueOnce(new Error("forbidden"));
    await state.refresh();
    expect(state.getSnapshot()).toMatchObject({ status: "error", recipes: [], plans: [] });
  });
  it("does not expose old-account callbacks after disposal", async () => {
    const { state, store, errors } = setup();
    await state.refresh();
    const pending = deferred<RecipeRecord>();
    vi.mocked(store.update).mockReturnValueOnce(pending.promise);
    state.favourite(record.url);
    const listener = vi.fn();
    state.subscribe(listener);
    state.dispose();
    pending.reject(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    state.save(data);
    await state.refresh();
    expect(store.create).not.toHaveBeenCalled();
  });
  it("ignores favourite actions for absent rows and safely rejects missing edited rows", async () => {
    const { state, errors } = setup();
    await state.refresh();
    state.favourite("absent");
    expect(state.getSnapshot().pending).toBe(0);
    state.save(data, "absent");
    await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
  });
});
describe("recipe demo seed", () => {
  it("seeds fictional recipes and a weekly plan into the actual data store only in demo", async () => {
    const storage = createMemoryStorage({ root: "https://pod.example/", protocol: "solid" });
    const container = (
      await storage.create(storage.root, null, { kind: "container", name: "recipes" })
    ).url;
    const store = recipeStore(storage, container);
    const session = {
      mode: "demo",
      fetch: vi.fn(),
      storageUrl: storage.root,
      webId: `${storage.root}profile#me`,
    } as unknown as PodSession;
    const first = ensureSample(session, store, new Date("2026-11-11T12:00:00Z"));
    expect(ensureSample(session, store)).toBe(first);
    await first;
    const result = await store.list();
    expect(result.recipes).toHaveLength(SAMPLE_RECIPES.length);
    expect(result.plans).toHaveLength(1);
    const live = { ...session, mode: "solid" } as PodSession;
    const list = vi.spyOn(store, "list");
    await ensureSample(live, store);
    expect(list).not.toHaveBeenCalled();
    await ensureSample({ ...session, fetch: vi.fn() } as unknown as PodSession, store);
    expect((await store.list()).recipes).toHaveLength(SAMPLE_RECIPES.length);
  });
  it("retries a failed seed", async () => {
    const { store } = setup();
    vi.mocked(store.list).mockRejectedValueOnce(new Error("offline"));
    const session = { mode: "demo", fetch: vi.fn() } as unknown as PodSession;
    await expect(ensureSample(session, store)).rejects.toThrow("offline");
    await ensureSample(session, store);
    expect(store.list).toHaveBeenCalledTimes(2);
  });
});
