// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  type MealPlanData,
  parseMealPlan,
  parseRecipe,
  RECIPE_CLASS,
  type RecipeData,
  recipeSubject,
  serializeMealPlan,
  serializeRecipe,
} from "./model.js";

export interface RecipeRecord {
  url: string;
  etag: string;
  data: RecipeData;
}
export interface PlanRecord {
  url: string;
  etag: string;
  data: MealPlanData;
}
export interface RecipeStore {
  container: string;
  registrationError?: unknown;
  list(): Promise<{ recipes: RecipeRecord[]; plans: PlanRecord[] }>;
  create(data: RecipeData, name?: string): Promise<RecipeRecord>;
  update(record: RecipeRecord, data: RecipeData): Promise<RecipeRecord>;
  savePlan(data: MealPlanData, previous?: PlanRecord): Promise<PlanRecord>;
}
function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function validator(etag: string | null): string {
  if (!etag || etag === "*" || etag.startsWith("W/"))
    throw new Error("Your pod did not provide a safe version for this recipe");
  return etag;
}
/** Shared pod I/O stays in the model package. URLs and listings are scoped by StorageClient. */
export function recipeStore(storage: StorageClient, container: string): RecipeStore {
  async function read(url: string) {
    const result = await storage.read(url, { accept: "text/turtle" });
    return {
      body: await result.text(),
      contentType: result.contentType ?? "text/turtle",
      etag: validator(result.etag),
    };
  }
  // Create first, then use the actual server-assigned URL for generated subjects (also LWS).
  async function createResource(data: RecipeData | MealPlanData, isRecipe: boolean, name?: string) {
    const created = await storage.create(container, null, {
      contentType: "text/turtle",
      name,
      links: [
        { rel: "type", target: isRecipe ? RECIPE_CLASS : "https://jeswr.org/ns/recipe#MealPlan" },
      ],
    });
    const current = await read(created.url);
    if (current.body.length)
      throw new Error("The new recipe resource was changed by another writer");
    const body = isRecipe
      ? await serializeRecipe(created.url, data as RecipeData)
      : await serializeMealPlan(created.url, data as MealPlanData);
    await storage.write(created.url, body, { contentType: "text/turtle", ifMatch: current.etag });
    return { url: created.url, ...(await read(created.url)) };
  }
  return {
    container,
    async list() {
      const recipes: RecipeRecord[] = [];
      const plans: PlanRecord[] = [];
      try {
        let count = 0;
        for await (const entry of storage.listAll(container, { maxBytes: 4_000_000 })) {
          if (entry.kind === "container") continue;
          if (++count > 2000) throw new Error("This recipe box is too large to load in one view");
          let current: Awaited<ReturnType<typeof read>>;
          try {
            current = await read(entry.url);
          } catch (error) {
            if (missing(error)) continue;
            throw error;
          }
          const recipe = await parseRecipe(entry.url, current.body, current.contentType);
          if (recipe) recipes.push({ url: entry.url, etag: current.etag, data: recipe });
          else {
            const plan = await parseMealPlan(entry.url, current.body, current.contentType);
            if (plan) plans.push({ url: entry.url, etag: current.etag, data: plan });
          }
        }
      } catch (error) {
        if (!missing(error)) throw error;
      }
      return { recipes, plans };
    },
    async create(data, name) {
      // Validate before creating an empty pod resource.
      await serializeRecipe("https://recipe.invalid/check", data);
      const result = await createResource(data, true, name);
      const parsed = await parseRecipe(result.url, result.body, result.contentType);
      if (!parsed) throw new Error("Couldn't read the saved recipe");
      return { url: result.url, etag: result.etag, data: parsed };
    },
    async update(record, data) {
      const body = await serializeRecipe(record.url, data);
      await storage.write(record.url, body, {
        contentType: "text/turtle",
        ifMatch: validator(record.etag),
      });
      const current = await read(record.url);
      const parsed = await parseRecipe(record.url, current.body, current.contentType);
      if (!parsed) throw new Error("Couldn't read the saved recipe");
      return { url: record.url, etag: current.etag, data: parsed };
    },
    async savePlan(data, previous) {
      const allowed = new Set(
        (await this.list()).recipes.map((recipe) => recipeSubject(recipe.url)),
      );
      for (const [key, value] of Object.entries(data)) {
        if (key !== "name" && value && !allowed.has(String(value)))
          throw new TypeError("Choose a recipe from your recipe box");
      }
      let url: string;
      if (previous) {
        url = previous.url;
        await storage.write(url, await serializeMealPlan(url, data), {
          contentType: "text/turtle",
          ifMatch: validator(previous.etag),
        });
      } else url = (await createResource(data, false)).url;
      const current = await read(url);
      const parsed = await parseMealPlan(url, current.body, current.contentType);
      if (!parsed) throw new Error("Couldn't read the saved meal plan");
      return { url, etag: current.etag, data: parsed };
    },
  };
}

export async function openRecipeStore(options: {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  webId: string;
  /** Explicit caller configuration for a known Solid transport without discovery headers. */
  protocol?: "solid";
}): Promise<RecipeStore> {
  const storage =
    options.protocol === "solid"
      ? createSolidBackend({ fetch: options.fetch, root: options.storageUrl })
      : (await createPodClient({ fetch: options.fetch, storage: options.storageUrl })).storage;
  const features = storage.features;
  let container = new URL("recipes/", storage.root).href;
  try {
    await storage.head(container);
  } catch (error) {
    if (!missing(error)) throw error;
    try {
      container = (await storage.create(storage.root, null, { name: "recipes", kind: "container" }))
        .url;
    } catch (createError) {
      if (
        !(createError instanceof StorageError) ||
        !["conflict", "precondition-failed"].includes(createError.code)
      )
        throw createError;
      await storage.head(container);
    }
  }
  const store = recipeStore(storage, container);
  try {
    await createTypeIndex({
      storage,
      features,
      profile: options.webId,
      fetch: options.fetch,
    }).register(RECIPE_CLASS, { container });
  } catch (error) {
    store.registrationError = error;
  }
  return store;
}
