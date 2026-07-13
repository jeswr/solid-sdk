// AUTHORED-BY Codex GPT-5
//
// Turtle / N-Triples serialisation of a federation registry graph via the shared
// suite serializer (never hand-concatenated RDF). JSON-LD is not produced here:
// callers who need JSON-LD already have the quads and the published
// `fedreg-context.jsonld`.

import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { DCAT, FEDAPP, FEDREG } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  fedreg: FEDREG,
  fedapp: FEDAPP,
  dcat: DCAT,
  dct: "http://purl.org/dc/terms/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
} as const;

/**
 * Serialise federation-registry quads to a string with `n3.Writer`. Defaults to
 * Turtle; pass an RDF media type (`text/turtle`, `application/n-triples`,
 * `application/n-quads`, `application/trig`) to choose another n3 format.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES, false);
}

/**
 * The structural shape of a finished build — quads plus a lazy serialise. The
 * public `BuiltGraph` (registry) and `BuiltStorage` (storage) interfaces are
 * structurally this; {@link built} produces it and each caller assigns it to its
 * own named public interface (which stays unchanged).
 */
export interface SerializableGraph {
  /** The constructed quads. */
  readonly quads: readonly Quad[];
  /** Serialise to Turtle (default) or another n3 format. */
  toString(format?: string): Promise<string>;
}

/**
 * Wrap a finished quad set as a {@link SerializableGraph} — `{ quads, toString }`
 * where `toString` lazily serialises via {@link serialize}. The single shared tail
 * of every build path (buildRegistry / buildMembership / describeStorage), so the
 * `{ quads, toString }` shape is constructed in ONE reviewed place.
 */
export function built(quads: readonly Quad[]): SerializableGraph {
  return { quads, toString: (format?: string) => serialize(quads, format) };
}
