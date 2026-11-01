// AUTHORED-BY Codex
export const isUrlAttribute = (key: string) =>
  ["src", "href", "poster", "cite", "action", "formaction", "xlink:href"].includes(key) ||
  key.startsWith("data-");

/** Rewrite URL leaves in ProseMirror's JSON attributes, including links and arrays. */
export function relocateAttributes<T>(value: T, relocate: (iri: string) => string, key = ""): T {
  if (typeof value === "string") return (isUrlAttribute(key) ? relocate(value) : value) as T;
  if (Array.isArray(value))
    return value.map((item) => relocateAttributes(item, relocate, key)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, relocateAttributes(value, relocate, key)]),
    ) as T;
  return value;
}
