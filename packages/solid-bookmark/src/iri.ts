// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { httpIriOrUndefined as filterIri, isHttpIri as guardIri } from "@jeswr/model-runtime";

/** Canonical http(s) IRI, or undefined; retain the package's public signatures. */
export const httpIriOrUndefined: (value: string | undefined) => string | undefined = filterIri;
export const isHttpIri: (value: string | undefined) => value is string = guardIri;
