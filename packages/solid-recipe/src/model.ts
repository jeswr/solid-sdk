// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  entities,
  type RecipeData as GeneratedRecipe,
  type MealPlanData,
} from "./generated/model.js";

export const RECIPE_CLASS = "https://schema.org/Recipe";
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
export type { MealPlanData };

type OptionalRecipeFields = Omit<GeneratedRecipe, "name" | "ingredients" | "instructions">;
export type RecipeData = {
  [Key in keyof OptionalRecipeFields]: OptionalRecipeFields[Key] | undefined;
} & {
  name: string;
  ingredients: string[];
  instructions: string[];
};

/** RDF sets do not preserve order or duplicates. Prefix each literal before generation. */
export function encodeOrdered(lines: readonly string[]): string[] {
  if (lines.length > 999999) throw new TypeError("Too many recipe lines");
  return lines.map((line, index) => `${String(index).padStart(6, "0")}:${line}`);
}

/** Unprefixed external RDF values retain their dataset order; malformed prefixes are text. */
export function decodeOrdered(lines: readonly string[]): string[] {
  return [...lines]
    .sort((a, b) => {
      if (/^\d{6}:/.test(a) && /^\d{6}:/.test(b)) return a.localeCompare(b);
      return 0;
    })
    .map((line) => line.replace(/^\d{6}:/, ""));
}

function toGenerated(data: RecipeData): GeneratedRecipe {
  return {
    ...data,
    ingredients: encodeOrdered(data.ingredients),
    instructions: encodeOrdered(data.instructions),
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
  return data
    ? {
        ...data,
        ingredients: decodeOrdered(data.ingredients ?? []),
        instructions: decodeOrdered(data.instructions ?? []),
      }
    : undefined;
}
export const recipeSubject = entities.Recipe.subject;
export const serializeMealPlan = entities.MealPlan.serialize;
export const parseMealPlan = entities.MealPlan.parseDocument;
