// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  MEAL_PLAN_CLASS,
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
  etag: string | null;
  data: RecipeData;
}
export interface PlanRecord {
  url: string;
  etag: string | null;
  data: MealPlanData;
}
export interface SkippedRecipeEntry {
  url: string;
  reason: "unreadable" | "invalid-data";
}
export interface RecipeListing {
  recipes: RecipeRecord[];
  plans: PlanRecord[];
  skipped: SkippedRecipeEntry[];
}
export interface RecipeStore {
  container: string;
  registrationError?: unknown;
  list(): Promise<RecipeListing>;
  create(data: RecipeData, name?: string): Promise<RecipeRecord>;
  update(record: RecipeRecord, data: RecipeData): Promise<RecipeRecord>;
  savePlan(data: MealPlanData, previous?: PlanRecord): Promise<PlanRecord>;
}
function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function validator(etag: string | null): string {
  if (!etag || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag))
    throw new Error("Your pod did not provide a safe version for this recipe");
  return etag;
}
/** Shared pod I/O stays in the model package. URLs and listings are scoped by StorageClient. */
export function recipeStore(
  storage: StorageClient,
  container: string,
  planContainer = container,
): RecipeStore {
  let knownRecipes = new Set<string>();
  async function read(url: string) {
    const result = await storage.read(url, { accept: "text/turtle" });
    return {
      body: await result.text(),
      contentType: result.contentType ?? "text/turtle",
      etag: result.etag,
    };
  }
  // Create first, then use the actual server-assigned URL for generated subjects (also LWS).
  async function createResource(data: RecipeData | MealPlanData, isRecipe: boolean, name?: string) {
    const created = await storage.create(isRecipe ? container : planContainer, null, {
      contentType: "text/turtle",
      name,
      links: [{ rel: "type", target: isRecipe ? RECIPE_CLASS : MEAL_PLAN_CLASS }],
    });
    const current = await read(created.url);
    if (current.body.length)
      throw new Error("The new recipe resource was changed by another writer");
    const body = isRecipe
      ? await serializeRecipe(created.url, data as RecipeData)
      : await serializeMealPlan(created.url, data as MealPlanData);
    await storage.write(created.url, body, {
      contentType: "text/turtle",
      ifMatch: validator(current.etag),
    });
    return { url: created.url, ...(await read(created.url)) };
  }
  return {
    container,
    async list() {
      const recipes: RecipeRecord[] = [];
      const plans: PlanRecord[] = [];
      const skipped: SkippedRecipeEntry[] = [];
      let count = 0;
      for (const location of new Set([container, planContainer])) {
        try {
          for await (const entry of storage.listAll(location, { maxBytes: 4_000_000 })) {
            if (entry.kind === "container") continue;
            if (++count > 2000) throw new Error("This recipe box is too large to load in one view");
            let current: Awaited<ReturnType<typeof read>>;
            try {
              current = await read(entry.url);
            } catch (error) {
              if (
                error instanceof StorageError &&
                ["not-found", "not-rdf", "invalid-response", "unsupported"].includes(error.code)
              ) {
                skipped.push({ url: entry.url, reason: "unreadable" });
                continue;
              }
              throw error;
            }
            try {
              const recipe = await parseRecipe(entry.url, current.body, current.contentType);
              if (recipe) recipes.push({ url: entry.url, etag: current.etag, data: recipe });
              else {
                const plan = await parseMealPlan(entry.url, current.body, current.contentType);
                if (plan) plans.push({ url: entry.url, etag: current.etag, data: plan });
                else skipped.push({ url: entry.url, reason: "invalid-data" });
              }
            } catch {
              skipped.push({ url: entry.url, reason: "invalid-data" });
            }
          }
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      knownRecipes = new Set(recipes.map((recipe) => recipeSubject(recipe.url)));
      return { recipes, plans, skipped };
    },
    async create(data, name) {
      // Validate before creating an empty pod resource.
      await serializeRecipe("https://recipe.invalid/check", data);
      const result = await createResource(data, true, name);
      const parsed = await parseRecipe(result.url, result.body, result.contentType);
      if (!parsed) throw new Error("Couldn't read the saved recipe");
      knownRecipes.add(recipeSubject(result.url));
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
      knownRecipes.add(recipeSubject(record.url));
      return { url: record.url, etag: current.etag, data: parsed };
    },
    async savePlan(data, previous) {
      for (const [key, value] of Object.entries(data)) {
        if (key !== "name" && value && !knownRecipes.has(String(value)))
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
  async function ensureContainer(name: string): Promise<string> {
    let container = new URL(`${name}/`, storage.root).href;
    try {
      await storage.head(container);
    } catch (error) {
      if (!missing(error)) throw error;
      try {
        container = (await storage.create(storage.root, null, { name, kind: "container" })).url;
      } catch (createError) {
        if (
          !(createError instanceof StorageError) ||
          !["conflict", "precondition-failed"].includes(createError.code)
        )
          throw createError;
        await storage.head(container);
      }
    }
    return container;
  }
  const container = await ensureContainer("recipes");
  const planContainer = await ensureContainer("meal-plans");
  const store = recipeStore(storage, container, planContainer);
  const index = createTypeIndex({
    storage,
    features,
    profile: options.webId,
    fetch: options.fetch,
  });
  for (const [classIri, location] of [
    [RECIPE_CLASS, container],
    [MEAL_PLAN_CLASS, planContainer],
  ] as const) {
    try {
      await index.register(classIri, { container: location });
    } catch (error) {
      store.registrationError = error;
    }
  }
  return store;
}
