// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tiny class-name joiner. We deliberately do NOT pull in clsx + tailwind-merge:
// the shell components use a fixed, non-conflicting set of utilities plus an
// optional caller `className` appended LAST (so a consumer override wins by
// CSS source order / specificity), which is all `cn` needs to support. Keeping
// zero extra deps keeps the package small and easy to install under
// `ignore-scripts=true`.
export type ClassValue = string | number | false | null | undefined;

/** Join truthy class values into a single space-separated string. */
export function cn(...values: ClassValue[]): string {
  return values.filter((v): v is string | number => Boolean(v)).join(" ");
}
