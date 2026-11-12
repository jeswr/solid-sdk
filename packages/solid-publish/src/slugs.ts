// AUTHORED-BY Codex (GPT-6.1 Sol)
export function isSlug(value: string): boolean {
  return value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
export function assertSlug(value: string): void {
  if (!isSlug(value))
    throw new TypeError("Use lowercase letters, numbers and single hyphens (up to 80 characters).");
}
export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .replace(/-$/, "") || "untitled"
  );
}
export function uniqueSlug(title: string, taken: readonly string[]): string {
  const base = slugify(title);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base.slice(0, 70).replace(/-$/, "")}-${suffix}`)) suffix++;
  return `${base.slice(0, 70).replace(/-$/, "")}-${suffix}`;
}
