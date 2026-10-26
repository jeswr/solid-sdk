// AUTHORED-BY Claude Opus 5.5
// RDF helpers shared by the backends: serialise through @jeswr/rdf-serialize (n3.Writer) and
// apply insert/delete quad patches to an n3 Store. Never hand-builds RDF text.
import { extractMediaType } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import type { Store } from "n3";

/** Media types the n3 writer can produce, so stored RDF can be patched in place. */
export const WRITABLE_RDF = new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

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
  return serialize([...(dataset as Iterable<Quad>)], {
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
 * blank nodes are refused in deletions (they cannot identify an existing node).
 */
export function applyQuadPatch(
  store: Store,
  inserts: readonly Quad[],
  deletes: readonly Quad[],
): void {
  for (const quad of [...inserts, ...deletes]) {
    if (hasTerm(quad, "Variable")) {
      throw new RdfPatchError("invalid", "Variables are only allowed in `where`");
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
