// AUTHORED-BY Codex (GPT-6.1 Sol)

import { entities, type RecipeData as GeneratedRecipe } from "./generated/model.js";

export { type MealPlanData, parseMealPlan, serializeMealPlan } from "./meal-plan.js";

export const RECIPE_CLASS = "http://schema.org/Recipe";
export const MEAL_PLAN_CLASS = "https://jeswr.org/ns/recipe#MealPlan";
export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Day = (typeof DAYS)[number];

type OptionalRecipeFields = Omit<
  GeneratedRecipe,
  "name" | "ingredients" | "instructions" | "orderedIngredients" | "orderedInstructions"
>;
export type RecipeData = {
  [Key in keyof OptionalRecipeFields]: OptionalRecipeFields[Key] | undefined;
} & {
  name: string;
  ingredients: string[];
  instructions: string[];
};

/** RDF sets do not preserve order or duplicates. Prefix each literal before generation. */
export function encodeOrdered(lines: readonly string[]): string[] {
  if (lines.length > 2000) throw new TypeError("Too many recipe lines (maximum 2,000)");
  return lines.map((line, index) => `${String(index).padStart(6, "0")}:${line}`);
}

/** Invalid private copies return undefined; callers must use the standard text instead. */
export function decodeOrdered(lines: readonly string[]): string[] | undefined {
  // The generator rejects this prefix pattern; contiguity and the read cap are domain policy.
  if (lines.length > 2000 || lines.some((line) => !/^\d{6}:/.test(line))) return undefined;
  const sorted = [...lines].sort();
  if (sorted.some((line, index) => !line.startsWith(`${String(index).padStart(6, "0")}:`)))
    return undefined;
  return sorted.map((line) => line.slice(7));
}

/** Trust private ordering only while it agrees with schema.org-only writers. */
function reconcileOrdered(standard: string[] = [], ordered: string[] = []): string[] {
  const decoded = decodeOrdered(ordered);
  const standardValues = new Set(standard);
  return decoded &&
    new Set(decoded).size === standardValues.size &&
    decoded.every((line) => standardValues.has(line))
    ? decoded
    : standard;
}

function toGenerated(data: RecipeData): GeneratedRecipe {
  return {
    ...data,
    orderedIngredients: encodeOrdered(data.ingredients),
    orderedInstructions: encodeOrdered(data.instructions),
  };
}
export function validateRecipe(data: RecipeData): void {
  const url = "https://recipe.invalid/check";
  const raw = toGenerated(data);
  const parsed = entities.Recipe.parse(url, entities.Recipe.build(url, raw));
  if (!parsed || !data.name.trim()) throw new TypeError("Give your recipe a name");
  // Optional invalid values otherwise drop silently in the runtime. A form must report them.
  for (const key of [
    "image",
    "url",
    "prepTime",
    "cookTime",
    "totalTime",
    "rating",
    "created",
    "modified",
  ] as const) {
    if (data[key] !== undefined && parsed[key] === undefined)
      throw new TypeError(`Check the recipe ${key}`);
  }
}
export async function serializeRecipe(url: string, data: RecipeData): Promise<string> {
  validateRecipe(data);
  return entities.Recipe.serialize(url, toGenerated(data));
}
export async function parseRecipe(
  url: string,
  body: string,
  contentType = "text/turtle",
): Promise<RecipeData | undefined> {
  const data = await entities.Recipe.parseDocument(url, body, contentType);
  const { orderedIngredients, orderedInstructions, ...plain } = data ?? {};
  return data
    ? {
        ...plain,
        name: data.name,
        ingredients: reconcileOrdered(data.ingredients, orderedIngredients),
        instructions: reconcileOrdered(data.instructions, orderedInstructions),
      }
    : undefined;
}
export const recipeSubject = entities.Recipe.subject;
