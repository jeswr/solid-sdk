// AUTHORED-BY Codex (GPT-6.1 Sol)
import { normalizeDuration } from "./format.js";
import { type RecipeData, validateRecipe } from "./model.js";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : undefined;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}
function strings(value: unknown): string[] {
  return list(value)
    .map(text)
    .filter((entry): entry is string => entry !== undefined);
}
function http(value: unknown): string | undefined {
  for (const entry of list(value)) {
    const raw =
      text(entry) ??
      text(object(entry)?.url) ??
      text(object(entry)?.contentUrl) ??
      text(object(entry)?.["@id"]);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
        return url.href;
    } catch {
      /* Ignore unsafe or relative source URLs. */
    }
  }
  return undefined;
}
function findRecipe(json: unknown): JsonObject | undefined {
  // Iterative, bounded traversal prevents pathological @graph nesting from exhausting the stack.
  const pending = [json];
  const seen = new Set<unknown>();
  for (let visited = 0; pending.length && visited < 10000; visited++) {
    const value = pending.shift();
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value.slice(0, 10000));
      continue;
    }
    const row = object(value);
    if (!row) continue;
    if (
      strings(row["@type"]).some((type) =>
        [
          "Recipe",
          "https://schema.org/Recipe",
          "http://schema.org/Recipe",
          "schema:Recipe",
        ].includes(type),
      )
    )
      return row;
    if (row["@graph"]) pending.push(row["@graph"]);
    if (row.mainEntity) pending.push(row.mainEntity);
  }
  return undefined;
}
function steps(value: unknown, depth = 0): string[] {
  if (depth > 30) throw new TypeError("Recipe instructions are nested too deeply");
  return list(value).flatMap((entry) => {
    const row = object(entry);
    if (row?.itemListElement !== undefined) return steps(row.itemListElement, depth + 1);
    const content = text(row?.text) ?? text(entry) ?? text(row?.name);
    return content
      ? content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  });
}
function duration(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const weeks = /^P(\d+)W$/.exec(raw);
  const result = weeks ? `P${Number(weeks[1]) * 7}D` : raw;
  return normalizeDuration(result);
}
export function fromSchemaOrgJsonLd(json: unknown): RecipeData {
  const row = findRecipe(typeof json === "string" ? JSON.parse(json) : json);
  if (!row) throw new TypeError("No schema.org Recipe found");
  const name = text(row.name);
  if (!name) throw new TypeError("The recipe needs a name");
  const recipe: RecipeData = {
    name,
    description: text(row.description),
    image: http(row.image),
    url: http(row.url) ?? http(row.mainEntityOfPage),
    author:
      list(row.author)
        .map((author) => text(object(author)?.name) ?? text(author))
        .filter(Boolean)
        .join(", ") || undefined,
    recipeYield: strings(row.recipeYield).join(", ") || undefined,
    prepTime: duration(row.prepTime),
    cookTime: duration(row.cookTime),
    totalTime: duration(row.totalTime),
    category: strings(row.recipeCategory).join(", ") || undefined,
    cuisine: strings(row.recipeCuisine).join(", ") || undefined,
    keywords: strings(row.keywords)
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean),
    ingredients: strings(row.recipeIngredient),
    instructions: steps(row.recipeInstructions),
    calories: text(object(row.nutrition)?.calories),
    favourite: false,
  };
  validateRecipe(recipe);
  return recipe;
}

/** Read JSON only. No DOM insertion, script execution, remote contexts or network access. */
export function extractRecipeJsonLd(html: string): unknown[] {
  if (html.length > 5_000_000) throw new TypeError("Paste a page smaller than 5 MB");
  const result: unknown[] = [];
  // Script raw-text ends at its first closing tag. Quoted attributes may contain '>'.
  const opening = /<script\b/gi;
  const closing = /<\/script\s*>/gi;
  let cursor = 0;
  while (cursor < html.length) {
    opening.lastIndex = cursor;
    const start = opening.exec(html);
    if (!start) break;
    const attributeStart = opening.lastIndex;
    let end = attributeStart;
    let quote = "";
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) break;
    closing.lastIndex = end + 1;
    const close = closing.exec(html);
    if (!close) break; // An unclosed raw-text script consumes the rest of the page.
    cursor = closing.lastIndex;
    const attributes = html.slice(attributeStart, end);
    const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attributes);
    if ((type?.[1] ?? type?.[2] ?? type?.[3] ?? "").trim().toLowerCase() !== "application/ld+json")
      continue;
    try {
      result.push(JSON.parse(html.slice(end + 1, close.index).replace(/^\s*<!--|-->\s*$/g, "")));
    } catch {
      /* A broken block must not hide a later valid recipe. */
    }
  }
  return result;
}
export function importRecipe(source: string): RecipeData {
  if (source.length > 5_000_000) throw new TypeError("Paste a page smaller than 5 MB");
  if (!source.trim().startsWith("<")) return fromSchemaOrgJsonLd(source);
  for (const block of extractRecipeJsonLd(source)) {
    try {
      return fromSchemaOrgJsonLd(block);
    } catch {
      /* Try the next structured-data block. */
    }
  }
  throw new TypeError("No recipe found. Paste the page source or its Recipe JSON-LD.");
}
