// AUTHORED-BY Claude Fable 5
/** Naming helpers shared by args parsing, walkthrough generation, and scaffolding. */

/** Registry/deploy slug charset (matches the walkthrough schema's `^[a-z0-9-]+$`). */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Normalise free text to a slug; returns undefined when nothing slug-like remains. */
export function toSlug(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return SLUG_PATTERN.test(cleaned) ? cleaned : undefined;
}

/** `car-hire` → `CAR_HIRE` (the walkthrough schema's `^[A-Z][A-Z0-9_]*$`). */
export function toEnvPrefix(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

/** `car-hire` → `Car Hire`. */
export function toTitleWords(slug: string): string {
  return slug
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => `${(word[0] as string).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/** `car-hire` → `car hire` (for prose like the branding purpose clause). */
export function toWords(slug: string): string {
  return slug.split("-").join(" ");
}

/** Escape text for embedding as JSX text content (no element/expression breakout). */
export function jsxTextEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}
