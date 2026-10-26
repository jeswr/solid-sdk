// AUTHORED-BY Codex GPT-6.1-Sol
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
import {
  ACL,
  DC_CREATED,
  LEGACY_SVC_NS,
  ODRL,
  RDF,
  RDFS,
  SCHEMA,
  SEC,
  SVC,
  VC,
  XSD,
} from "./vocab.js";

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
  // Preserve the historical projection of legacy signed graphs. Never rewrite
  // payload terms merely to change a display prefix.
  const hasCanonical = quads.some(
    (q) =>
      q.predicate.value.startsWith(SVC) ||
      (q.object.termType === "NamedNode" && q.object.value.startsWith(SVC)),
  );
  const hasLegacy = quads.some(
    (q) =>
      q.predicate.value.startsWith(LEGACY_SVC_NS) ||
      (q.object.termType === "NamedNode" && q.object.value.startsWith(LEGACY_SVC_NS)),
  );
  return legacySerialize(quads, format, {
    ...PREFIXES,
    svc: !hasCanonical && hasLegacy ? LEGACY_SVC_NS : SVC,
  });
}
