// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
/**
 * RDF helpers for the generator: parse Turtle with the suite parser (`n3.Parser`),
 * query a graph through `n3.Store`, and serialise DETERMINISTICALLY with
 * `n3.Writer` (design §5 byte-reproducibility contract). No RDF is ever
 * hand-parsed or hand-concatenated — parsing is `n3.Parser`, serialisation is
 * `n3.Writer`, reads go through `Store`.
 */

import { isSafeAbsoluteIri, isTurtlePrefixName } from "@jeswr/model-runtime";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store, Writer } from "n3";

export const SH = "http://www.w3.org/ns/shacl#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const OWL = "http://www.w3.org/2002/07/owl#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const FEDGEN = "https://w3id.org/jeswr/fedgen#";

/** Parse a Turtle string into quads via `n3.Parser` (never a bespoke parser). */
export function parseTurtle(ttl: string, baseIRI?: string): Quad[] {
  return new Parser(baseIRI ? { baseIRI } : {}).parse(ttl);
}

/** A read-only graph query surface over an `n3.Store`. */
export class Graph {
  readonly store: Store;

  constructor(quads: Iterable<Quad>) {
    this.store = new Store([...quads]);
  }

  /** All object terms of `(subject, predicate, *)`. */
  objects(subject: Term | string, predicate: string): Term[] {
    return this.store.getQuads(subject as Term, predicate, null, null).map((q) => q.object);
  }

  /** The single object term of `(subject, predicate, *)`, or undefined. */
  object(subject: Term | string, predicate: string): Term | undefined {
    return this.objects(subject, predicate)[0];
  }

  /** The single object VALUE (string) of `(subject, predicate, *)`, or undefined. */
  value(subject: Term | string, predicate: string): string | undefined {
    return this.object(subject, predicate)?.value;
  }

  /** All subject terms of `(*, predicate, object)`. */
  subjects(predicate: string, object: Term | string): Term[] {
    return this.store.getQuads(null, predicate, object as Term, null).map((q) => q.subject);
  }

  /** Whether the graph contains `(subject, predicate, object)`. */
  has(subject: Term | string, predicate: string, object: Term | string): boolean {
    return this.store.getQuads(subject as Term, predicate, object as Term, null).length > 0;
  }

  /** All distinct subjects that carry `rdf:type <typeIri>`. */
  instancesOf(typeIri: string): Term[] {
    return this.subjects(`${RDF}type`, DataFactory.namedNode(typeIri));
  }
}

/** Canonical term key; any path-root blank nodes already have deterministic labels. */
function termKey(term: Term): string {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value}>`;
    case "BlankNode":
      return `_:${term.value}`;
    case "Literal": {
      const lit = term as Term & { language: string; datatype: { value: string } };
      const lang = lit.language ? `@${lit.language}` : "";
      const dt = lit.datatype?.value ? `^^<${lit.datatype.value}>` : "";
      return `"${term.value}"${lang}${dt}`;
    }
    default:
      return `${term.termType}:${term.value}`;
  }
}

/** A total order over quads by (subject, predicate, object) canonical keys. */
export function compareQuads(a: Quad, b: Quad): number {
  const ka = `${termKey(a.subject)} ${termKey(a.predicate)} ${termKey(a.object)}`;
  const kb = `${termKey(b.subject)} ${termKey(b.predicate)} ${termKey(b.object)}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Serialise quads to Turtle DETERMINISTICALLY: quads are sorted by canonical key
 * and prefixes emitted in sorted order, so (given skolemized nodes and stable
 * blank labels for complex-path roots) output is byte-reproducible regardless
 * of input quad order. The N-Triples mode preserves supplied quad order for
 * permutation tooling, through the SAME validated writer boundary.
 */
export function serializeCanonicalTurtle(
  quads: Iterable<Quad>,
  prefixes: Record<string, string>,
  format: "Turtle" | "N-Triples" = "Turtle",
): string {
  const output = [...quads];
  if (format === "Turtle") output.sort(compareQuads);
  const orderedPrefixes: Record<string, string> = {};
  for (const key of Object.keys(prefixes).sort()) {
    if (!isTurtlePrefixName(key)) throw new TypeError("invalid Turtle prefix name");
    const iri = prefixes[key];
    if (!isSafeAbsoluteIri(iri))
      throw new TypeError("prefix namespace must be a safe absolute IRI");
    orderedPrefixes[key] = iri;
  }
  // This is the ONLY generator writer boundary, after shape rewriting. Never
  // repair identity: N3 accepts unsafe lexical IRIs and would emit them verbatim.
  for (const quad of output) {
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
      if (term.termType === "NamedNode" && !isSafeAbsoluteIri(term.value)) {
        throw new TypeError("NamedNode must be a safe absolute IRI");
      }
      if (term.termType === "Literal" && !isSafeAbsoluteIri(term.datatype.value)) {
        throw new TypeError("literal datatype must be a safe absolute IRI");
      }
    }
  }
  const writer = new Writer({ prefixes: orderedPrefixes, format });
  writer.addQuads(output);
  let out = "";
  writer.end((error, result) => {
    if (error) throw error;
    out = result;
  });
  return out;
}
