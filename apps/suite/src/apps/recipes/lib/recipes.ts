// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  durationFromMinutes,
  type RecipeData,
  type RecipeRecord,
  validateRecipe,
} from "@jeswr/solid-recipe";

export function filterRecipes(
  recipes: RecipeRecord[],
  query: string,
  category: string,
  cuisine: string,
  favourites: boolean,
): RecipeRecord[] {
  const terms = query.toLocaleLowerCase("en-GB").trim().split(/\s+/).filter(Boolean);
  return recipes
    .filter(
      ({ data }) =>
        (!category || data.category === category) &&
        (!cuisine || data.cuisine === cuisine) &&
        (!favourites || data.favourite) &&
        terms.every((term) =>
          [data.name, data.description, data.author, ...(data.keywords ?? []), ...data.ingredients]
            .join(" ")
            .toLocaleLowerCase("en-GB")
            .includes(term),
        ),
    )
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}
export function weekDays(date: Date, offset = 0): string[] {
  const start = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10),
  );
}
export function recipeFromForm(
  form: FormData,
  original?: RecipeData,
  now = new Date(),
): RecipeData {
  const get = (key: string) => String(form.get(key) ?? "").trim();
  const optional = (key: string) => get(key) || undefined;
  const time = (key: string) => {
    const raw = get(key);
    if (!raw) return undefined;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0)
      throw new TypeError("Enter a cooking time in minutes, zero or more");
    return durationFromMinutes(minutes);
  };
  const lines = (key: string) =>
    get(key)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const data: RecipeData = {
    name: get("name"),
    description: optional("description"),
    image: optional("image"),
    url: optional("url"),
    author: optional("author"),
    recipeYield: optional("recipeYield"),
    prepTime: time("prepTime"),
    cookTime: time("cookTime"),
    totalTime: time("totalTime"),
    category: optional("category"),
    cuisine: optional("cuisine"),
    ingredients: lines("ingredients"),
    instructions: lines("instructions"),
    keywords: get("keywords")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    calories: optional("calories"),
    rating: get("rating") ? Number(get("rating")) : undefined,
    favourite: original?.favourite ?? false,
    created: original?.created ?? now,
    modified: now,
  };
  validateRecipe(data);
  return data;
}
