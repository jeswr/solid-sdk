// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of a VC graph — a thin adapter over the shared
// @jeswr/rdf-serialize package (the single audited n3.Writer serialiser for the
// @jeswr suite). rdf-serialize was extracted from these repos' near-identical
// `src/serialize.ts` copies, so delegating here is a behaviour-preserving
// consolidation: the emitted bytes are byte-identical (same n3.Writer call, same
// VC/Data-Integrity prefix map, same empty-graph short-circuit). RDF is still
// ALWAYS produced through `n3.Writer` (inside the package) — never hand-concatenated.

import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { ACL, DC_CREATED, ODRL, RDF, RDFS, SCHEMA, SEC, SVC, VC, XSD } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  cred: VC,
  sec: SEC,
  svc: SVC,
  acl: ACL,
  odrl: ODRL,
  schema: SCHEMA,
  xsd: XSD,
  rdf: RDF,
  rdfs: RDFS,
  dcterms: DC_CREATED.replace("created", ""),
} as const;

/**
 * Serialise quads to a string with `n3.Writer` (via {@link legacySerialize} from
 * `@jeswr/rdf-serialize`). Defaults to Turtle; pass an RDF media type
 * (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 *
 * An empty graph serialises to an empty string (n3.Writer otherwise emits a
 * content-free prefix preamble) — `legacySerialize`'s `emptyAsEmptyString`
 * default (`true`) preserves that behaviour, so a zero-quad input round-trips as
 * empty exactly as before.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES);
}
