// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of a federation graph — a thin adapter over
// `@jeswr/rdf-serialize` (the suite's single sanctioned `n3.Writer` serialiser;
// never hand-concatenated RDF). This file keeps federation-client's own public
// `serialize(quads, format)` surface unchanged while delegating the actual
// quads→string work to the consolidated package (Phase-2 consolidation).
//
// JSON-LD is intentionally NOT produced here: callers who need JSON-LD already
// have the quads and the published `context.jsonld`.

import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { ACL, FEDAPP, SHACL } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  fedapp: FEDAPP,
  acl: ACL,
  sh: SHACL,
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
} as const;

/**
 * Serialise federation quads to a string with `n3.Writer` (via
 * `@jeswr/rdf-serialize`). Defaults to Turtle; pass an RDF media type
 * (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 *
 * `emptyAsEmptyString: false` reproduces federation-client's long-standing
 * behaviour: an empty graph emits the bare prefix preamble that `n3.Writer`
 * produces (a non-empty string), NOT the `""` short-circuit that four of the
 * five consolidated suite copies use. (`n3.Writer` already emits `""` for the
 * line-based N-Triples / N-Quads formats with no quads — that is its own
 * behaviour, not the short-circuit, and is unchanged here.)
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES, false);
}
