// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import "./drive-ui-dom";

import type { RecipeData, RecipeRecord, RecipeStore } from "@jeswr/solid-recipe";
import { type ReactNode, useSyncExternalStore } from "react";
import { expect, it, vi } from "vitest";
import { RecipeForm } from "../src/apps/recipes/components/recipe-form";
import { RecipesApp } from "../src/apps/recipes/components/recipes-app";
import { recipeFromForm } from "../src/apps/recipes/lib/recipes";
import { createRecipeState, type RecipeState } from "../src/apps/recipes/state/recipe-state";
import { act, click, h, mount } from "./drive-ui-dom";

let currentState: RecipeState;
vi.mock("../src/apps/recipes/state/recipes-context", () => ({
  RecipesProvider: ({ children }: { children: ReactNode }) => children,
  useRecipes: () => ({
    ...useSyncExternalStore(currentState.subscribe, currentState.getSnapshot),
    actions: currentState,
  }),
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: { webId: "demo", storageUrl: "demo" } }),
}));
vi.mock("@/shell/app-frame", () => ({
  AppSessionGuard: ({ children }: { children: ReactNode }) => children,
  AppFrame: ({ children }: { children: ReactNode }) => h("main", { children }),
  AppHeading: ({ children }: { children: ReactNode }) => h("h1", { children }),
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));

const data: RecipeData = {
  name: "Test soup",
  ingredients: ["2 eggs"],
  instructions: ["Mix"],
  favourite: false,
};
const record: RecipeRecord = { url: "https://pod.example/recipes/soup", etag: '"1"', data };
const button = (host: Element, name: string) => {
  const element = [...host.querySelectorAll("button")].find((item) => item.textContent === name);
  if (!element) throw new Error(`Missing button: ${name}`);
  return element;
};
it.each([
  ["loads a bounded image", "https://93.184.216.34/soup.png", 4, "loaded"],
  ["refuses an oversized image", "https://93.184.216.34/soup.png", 2_097_153, "refused"],
  ["blocks loopback", "https://127.0.0.1/soup.png", 4, "blocked"],
] as const)("%s only after the user opts in", async (_test, image, bytes, outcome) => {
  const transport = vi.fn(
    async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } }),
  );
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(transport);
  const create = vi.spyOn(URL, "createObjectURL");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  try {
    const store: RecipeStore = {
      container: "https://pod.example/recipes/",
      list: async () => ({
        recipes: [{ ...record, data: { ...data, image } }],
        plans: [],
        skipped: [],
      }),
      create: vi.fn(),
      update: vi.fn(),
      savePlan: vi.fn(),
    };
    currentState = createRecipeState(store, vi.fn());
    await currentState.refresh();
    const view = await mount(h(RecipesApp));
    expect(transport).not.toHaveBeenCalled();
    expect(view.host.innerHTML).not.toContain(image);
    await click(button(view.host, "Load external image"));
    if (outcome === "blocked") expect(transport).not.toHaveBeenCalled();
    else {
      expect(transport).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledWith(
        image,
        expect.objectContaining({
          credentials: "omit",
          redirect: "manual",
          referrerPolicy: "no-referrer",
        }),
      );
    }
    if (outcome === "loaded") {
      expect(view.host.querySelector(".recipes-image-preview")?.getAttribute("style")).toContain(
        "blob:",
      );
      expect(create).toHaveBeenCalledOnce();
      await act(async () => view.unmount());
      expect(revoke).toHaveBeenCalledWith(create.mock.results[0]?.value);
    } else {
      expect(view.host.textContent).toContain("Image unavailable");
      expect(create).not.toHaveBeenCalled();
    }
  } finally {
    fetch.mockRestore();
    create.mockRestore();
    revoke.mockRestore();
  }
});

it("keeps cook mode, scaling and checked steps/ingredients after a favourite write changes modified", async () => {
  const store: RecipeStore = {
    container: "https://pod.example/recipes/",
    list: vi.fn(async () => ({ recipes: [record], plans: [], skipped: [] })),
    create: vi.fn(),
    savePlan: vi.fn(),
    update: vi.fn(async (original, next) => ({ ...original, data: next, etag: '"2"' })),
  };
  currentState = createRecipeState(store, vi.fn());
  await currentState.refresh();
  const view = await mount(h(RecipesApp));
  await click(button(view.host, "Test soup"));
  await click(button(view.host, "Start cooking"));
  const scale = view.host.querySelector<HTMLSelectElement>("#recipe-scale");
  if (!scale) throw new Error("Missing scale");
  await act(async () => {
    scale.value = "2";
    scale.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const ingredient = view.host.querySelector("#ingredient-0");
  const step = view.host.querySelector("#step-0");
  if (!ingredient || !step) throw new Error("Missing checklist");
  await click(ingredient);
  await click(step);
  const favourite = view.host.querySelector('[aria-label="Add to favourites"]');
  if (!favourite) throw new Error("Missing favourite");
  await click(favourite);
  expect(store.update).toHaveBeenCalled();
  expect(currentState.getSnapshot().recipes[0]?.data.modified).toBeInstanceOf(Date);
  expect(button(view.host, "Leave cook mode")).toBeTruthy();
  expect(view.host.querySelector<HTMLSelectElement>("#recipe-scale")?.value).toBe("2");
  expect(view.host.textContent).toContain("4 eggs");
  expect(view.host.querySelector("#ingredient-0")).toBe(ingredient);
  expect(ingredient.getAttribute("aria-checked")).toBe("true");
  expect(step.getAttribute("aria-checked")).toBe("true");
});

it("shows a quiet skipped-file notice while keeping valid recipes available", async () => {
  const store: RecipeStore = {
    container: "https://pod.example/recipes/",
    list: vi.fn(async () => ({
      recipes: [record],
      plans: [],
      skipped: [{ url: "https://pod.example/recipes/bad", reason: "invalid-data" as const }],
    })),
    create: vi.fn(),
    update: vi.fn(),
    savePlan: vi.fn(),
  };
  currentState = createRecipeState(store, vi.fn());
  await currentState.refresh();
  const view = await mount(h(RecipesApp));
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
    "One file could not be read",
  );
  expect(button(view.host, "Test soup")).toBeTruthy();
});

it("accepts the fractional minutes it displays when editing a PT45S recipe", async () => {
  await mount(
    h(RecipeForm, {
      initial: { ...data, prepTime: "PT45S", cookTime: "PT1M30S", totalTime: "PT2M15S" },
      disabled: false,
      onSave: vi.fn(),
      onClose: vi.fn(),
    }),
  );
  const form = new FormData();
  form.set("name", data.name);
  for (const name of ["prepTime", "cookTime", "totalTime"]) {
    const input = document.getElementById(`recipe-${name}`) as HTMLInputElement;
    expect(input.step).toBe("any");
    expect(input.checkValidity()).toBe(true);
    form.set(name, input.value);
  }
  expect(recipeFromForm(form)).toMatchObject({
    prepTime: "PT45S",
    cookTime: "PT1M30S",
    totalTime: "PT2M15S",
  });
});
