// AUTHORED-BY Claude Opus 5.5
// RDF helpers shared by the backends: serialise through @jeswr/rdf-serialize (n3.Writer) and
// apply insert/delete quad patches to an n3 Store. Never hand-builds RDF text.

import type { DatasetCore, Quad, Term } from "@jeswr/fetch-rdf";
import { extractMediaType } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { Store } from "n3";

/** Media types the n3 writer can produce, so stored RDF can be patched in place. */
export const WRITABLE_RDF = new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

/** Formats that cannot carry named graphs. */
export const TRIPLE_FORMATS = new Set(["text/turtle", "application/n-triples"]);

const inNamedGraph = (quad: Quad) => quad.graph.termType !== "DefaultGraph";

/** Lower-cased media type without parameters, or null when absent/invalid. */
export function mediaType(contentType: string): string | null {
  return extractMediaType(contentType)?.toLowerCase() ?? null;
}

/** Serialise quads (from a dataset or any iterable) in one of the WRITABLE_RDF formats. */
export function serializeQuads(
  dataset: DatasetCore | Iterable<Quad>,
  format: string,
  prefixes: Record<string, string> = {},
): Promise<string> {
  const quads = [...(dataset as Iterable<Quad>)];
  if (TRIPLE_FORMATS.has(format) && quads.some(inNamedGraph)) {
    // n3.Writer would emit graph blocks, which are not valid in a triple-only format.
    throw new TypeError(
      `${format} cannot carry named graphs; use application/n-quads or application/trig`,
    );
  }
  return serialize(quads, {
    format,
    prefixes,
    emptyAsEmptyString: false,
  });
}

function hasTerm(quad: Quad, termType: Term["termType"]): boolean {
  return [quad.subject, quad.predicate, quad.object, quad.graph].some(
    (term) => term.termType === termType,
  );
}

/** Why an RDF patch was refused: `invalid` (malformed) or `conflict` (a deletion is absent). */
export class RdfPatchError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "RdfPatchError";
  }
}

/**
 * Apply N3-Patch-equivalent inserts/deletes (no `where`) to `store`, atomically: every deletion
 * must be present (else `conflict`, like N3 Patch's 409); variables are refused anywhere, and
 * blank nodes are refused in deletions (they cannot identify an existing node); `triplesOnly`
 * refuses named graphs for Turtle / N-Triples resources.
 */
export function applyQuadPatch(
  store: Store,
  inserts: readonly Quad[],
  deletes: readonly Quad[],
  triplesOnly = false,
): void {
  for (const quad of [...inserts, ...deletes]) {
    if (hasTerm(quad, "Variable")) {
      throw new RdfPatchError("invalid", "Variables are only allowed in `where`");
    }
    if (triplesOnly && inNamedGraph(quad)) {
      throw new RdfPatchError("invalid", "Named graphs cannot be patched into a triple format");
    }
  }
  for (const quad of deletes) {
    if (hasTerm(quad, "BlankNode")) {
      throw new RdfPatchError("invalid", "Blank nodes cannot be deleted by value");
    }
    if (store.countQuads(quad.subject, quad.predicate, quad.object, quad.graph) === 0) {
      throw new RdfPatchError("conflict", "A quad to delete is not present");
    }
  }
  store.removeQuads([...deletes]);
  store.addQuads([...inserts]);
}
