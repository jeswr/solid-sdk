// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openRecipeStore, type RecipeData, type RecipeStore } from "@jeswr/solid-recipe";
import { toast } from "@jeswr/suite-ui";
import { expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/recipes/demo/sample";
import { RecipesProvider, useRecipes } from "../src/apps/recipes/state/recipes-context";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";

vi.mock("@jeswr/solid-recipe", async (original) => ({
  ...(await original<typeof import("@jeswr/solid-recipe")>()),
  openRecipeStore: vi.fn(),
}));
vi.mock("../src/apps/recipes/demo/sample", () => ({ ensureSample: vi.fn(async () => {}) }));
vi.mock("@jeswr/suite-ui", () => ({
  toast: { error: vi.fn() },
  LoadingSkeleton: () => h("p", { children: "Loading" }),
  ErrorState: ({ actions }: { actions: { retry: () => void } }) =>
    h("button", { onClick: actions.retry, children: "Retry" }),
}));
const data: RecipeData = { name: "Soup", ingredients: [], instructions: [] };
function fixture() {
  let notify: () => void = () => {};
  const stop = vi.fn();
  const session = {
    mode: "demo",
    webId: "https://pod.example/profile#me",
    storageUrl: "https://pod.example/",
    fetch: vi.fn(),
    subscribe: (listener: () => void) => {
      notify = listener;
      return stop;
    },
  } as unknown as PodSession;
  const store: RecipeStore = {
    container: "https://pod.example/recipes/",
    list: vi.fn(async () => ({ recipes: [], plans: [], skipped: [] })),
    create: vi.fn(async () => {
      throw new Error("save failed");
    }),
    update: vi.fn(),
    savePlan: vi.fn(),
  };
  return { session, store, stop, notify: () => notify() };
}
it("opens a session-scoped store, subscribes, surfaces registration/write failures and disposes", async () => {
  const { session, store, stop, notify } = fixture();
  store.registrationError = new Error("index");
  vi.mocked(openRecipeStore).mockResolvedValueOnce(store);
  let current: ReturnType<typeof useRecipes> | undefined;
  function Consumer() {
    current = useRecipes();
    return h("p", { children: current.status });
  }
  const view = await mount(h(RecipesProvider, { session, children: h(Consumer) }));
  await act(async () => {
    await vi.waitFor(() => expect(current?.status).toBe("ready"));
  });
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Type Index"));
  await act(async () => {
    notify();
  });
  expect(store.list).toHaveBeenCalledTimes(2);
  await act(async () => {
    current?.actions.save(data);
  });
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"));
  await act(async () => view.unmount());
  expect(stop).toHaveBeenCalledOnce();
});
it("offers retry after an opening error", async () => {
  const { session, store } = fixture();
  vi.mocked(openRecipeStore)
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(store);
  const view = await mount(
    h(RecipesProvider, { session, children: h("p", { children: "Opened" }) }),
  );
  await act(async () => {
    await vi.waitFor(() => expect(view.host.textContent).toContain("Retry"));
  });
  await act(async () => {
    view.host.querySelector("button")?.click();
  });
  await act(async () => {
    await vi.waitFor(() => expect(view.host.textContent).toContain("Opened"));
  });
});

it("opens a live session through discovery and rejects use outside its provider", async () => {
  const { session, store } = fixture();
  vi.mocked(openRecipeStore).mockResolvedValueOnce(store);
  const live = { ...session, mode: "solid" } as PodSession;
  const view = await mount(
    h(RecipesProvider, { session: live, children: h("p", { children: "Live recipes" }) }),
  );
  await act(async () => {
    await vi.waitFor(() => expect(view.host.textContent).toContain("Live recipes"));
  });
  expect(vi.mocked(openRecipeStore).mock.calls.at(-1)?.[0].protocol).toBeUndefined();
  function Orphan() {
    useRecipes();
    return null;
  }
  await expect(mount(h(Orphan))).rejects.toThrow("RecipesProvider is required");
});

it("ignores a session opening that resolves after unmount", async () => {
  const { session, store } = fixture();
  let finish!: (value: RecipeStore) => void;
  vi.mocked(openRecipeStore).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = await mount(h(RecipesProvider, { session, children: null }));
  await view.unmount();
  await act(async () => {
    finish(store);
  });
  expect(store.list).not.toHaveBeenCalled();
});

it("ignores a seed completion or opening error after the session is gone", async () => {
  const { session, store } = fixture();
  let seeded!: () => void;
  vi.mocked(ensureSample).mockReturnValueOnce(
    new Promise((resolve) => {
      seeded = resolve;
    }),
  );
  vi.mocked(openRecipeStore).mockResolvedValueOnce(store);
  const view = await mount(h(RecipesProvider, { session, children: null }));
  await view.unmount();
  await act(async () => {
    seeded();
  });
  expect(store.list).not.toHaveBeenCalled();
  let fail!: (error: Error) => void;
  vi.mocked(openRecipeStore).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const second = await mount(h(RecipesProvider, { session, children: null }));
  await second.unmount();
  await act(async () => {
    fail(new Error("late"));
  });
});
