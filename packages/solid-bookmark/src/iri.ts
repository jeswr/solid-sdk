// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { httpIriOrUndefined as filterIri, isHttpIri as guardIri } from "@jeswr/model-runtime";

/** Canonical http(s) IRI; never repair an obfuscated or non-absolute scheme. */
export function httpIriOrUndefined(value: string | undefined): string | undefined {
  if (!value || !/^https?:\/\//i.test(value.trim())) return undefined;
  return filterIri(value);
}
export const isHttpIri: (value: string | undefined) => value is string = guardIri;
