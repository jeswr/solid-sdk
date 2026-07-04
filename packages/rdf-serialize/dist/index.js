// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public entry point for @jeswr/rdf-serialize — the single sanctioned n3.Writer
// RDF serialiser for the @jeswr suite. See ./serialize.ts for the implementation
// and the consolidation rationale, and ./iri.ts for the canonical IRI-safety
// helpers every RDF-writing package should consume.
export { escapeIri, isHttpIri, safeHttpIri, safeIri } from "./iri.js";
export { DEFAULT_FORMAT, legacySerialize, serialize } from "./serialize.js";
//# sourceMappingURL=index.js.map