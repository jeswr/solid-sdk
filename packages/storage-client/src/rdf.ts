// AUTHORED-BY Claude Opus 5.5
// RDF helpers shared by the backends: serialise through @jeswr/rdf-serialize (n3.Writer) and
// apply insert/delete quad patches to an n3 Store. Never hand-builds RDF text.

import type { DatasetCore, Quad, Term } from "@jeswr/fetch-rdf";
import { extractMediaType } from "@jeswr/fetch-rdf";
import { escapeIri, serialize } from "@jeswr/rdf-serialize";
import { DataFactory, type Store } from "n3";

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

const BLANK_LABEL = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const LANGUAGE = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;
/** Turtle PN_PREFIX (empty allowed): a letter first, no trailing dot. */
const PREFIX =
  /^(?:\p{L}(?:[\p{L}\p{N}\p{M}_\-.\u00B7\u203F\u2040]*[\p{L}\p{N}\p{M}_\-\u00B7\u203F\u2040])?)?$/u;

/**
 * n3.Writer emits IRIs, blank-node labels and language tags verbatim, so a crafted value could
 * break out of `<…>` and forge triples. Percent-encode IRIREF-forbidden characters in every IRI
 * (@jeswr/rdf-serialize `escapeIri`; legitimate IRIs are unchanged), relabel unsafe blank nodes
 * consistently, and refuse malformed language tags.
 */
function injectionSafe(quads: readonly Quad[]): Quad[] {
  const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;
  const labels = new Map<string, string>();
  const term = (value: Term): Term => {
    switch (value.termType) {
      case "NamedNode":
        return namedNode(escapeIri(value.value));
      case "BlankNode": {
        if (BLANK_LABEL.test(value.value)) return value;
        let label = labels.get(value.value);
        if (label === undefined) {
          label = `x${labels.size}_${crypto.randomUUID().replaceAll("-", "")}`;
          labels.set(value.value, label);
        }
        return blankNode(label);
      }
      case "Literal":
        if (value.language) {
          const direction = (value as { direction?: string | null }).direction;
          if (!LANGUAGE.test(value.language)) {
            throw new TypeError(`Invalid language tag: ${JSON.stringify(value.language)}`);
          }
          if (direction && direction !== "ltr" && direction !== "rtl") {
            throw new TypeError(`Invalid base direction: ${JSON.stringify(direction)}`);
          }
          return value;
        }
        return literal(value.value, namedNode(escapeIri(value.datatype.value)));
      case "DefaultGraph":
        return defaultGraph();
      default:
        throw new TypeError(`${value.termType} terms cannot be serialised`);
    }
  };
  return quads.map((q) =>
    quad(
      term(q.subject) as Quad["subject"],
      term(q.predicate) as Quad["predicate"],
      term(q.object) as Quad["object"],
      term(q.graph) as Quad["graph"],
    ),
  );
}

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
  const safe = injectionSafe(quads);
  // n3.Writer copies an IRI that already looks like `name:…` for a declared prefix verbatim, so a
  // prefix is dropped whenever some IRI starts with its name (the output stays correct, unabbreviated).
  const iris = new Set<string>();
  for (const q of safe) {
    for (const t of [q.subject, q.predicate, q.object, q.graph]) {
      if (t.termType === "NamedNode") iris.add(t.value);
      if (t.termType === "Literal") iris.add(t.datatype.value);
    }
  }
  const safePrefixes: Record<string, string> = {};
  for (const [name, namespace] of Object.entries(prefixes)) {
    if (!PREFIX.test(name)) throw new TypeError(`Invalid prefix name: ${JSON.stringify(name)}`);
    if ([...iris].some((iri) => iri.startsWith(`${name}:`))) continue;
    safePrefixes[name] = escapeIri(namespace);
  }
  return serialize(safe, {
    format,
    prefixes: safePrefixes,
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
