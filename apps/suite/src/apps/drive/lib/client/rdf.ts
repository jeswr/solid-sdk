// AUTHORED-BY Codex
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { getBijection } from "rdf-isomorphic";

const LDP = "http://www.w3.org/ns/ldp#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Remove only server-maintained containment, stat data and resource types. */
export function containerData(dataset: DatasetCore, resource: string): Store {
  const managed = new Set([
    resource,
    ...[...new Container(resource, dataset, DataFactory).contains].map((child) => child.id),
  ]);
  return new Store(
    [...dataset].filter(
      (q) =>
        !managed.has(q.subject.value) ||
        (q.predicate.value !== `${LDP}contains` &&
          !q.predicate.value.startsWith("http://www.w3.org/ns/posix/stat#") &&
          q.predicate.value !== "http://purl.org/dc/terms/modified" &&
          q.predicate.value !== "http://purl.org/dc/elements/1.1/modified" &&
          !(
            q.predicate.value === TYPE &&
            q.object.termType === "NamedNode" &&
            ([
              `${LDP}Resource`,
              `${LDP}Container`,
              `${LDP}BasicContainer`,
              "http://www.w3.org/ns/pim/space#Storage",
            ].includes(q.object.value) ||
              q.object.value.startsWith("http://www.w3.org/ns/iana/media-types/"))
          )),
    ),
  );
}

/** Transform existing RDF, including document-local fragments and blank-node graphs. */
export function relocate(
  dataset: DatasetCore,
  pairs: readonly (readonly [string, string])[],
  objectPredicates?: ReadonlySet<string>,
): Store {
  const term = <T extends Term>(value: T): T => {
    if (value.termType !== "NamedNode") return value;
    for (const [from, to] of pairs) {
      if (
        value.value === from ||
        value.value.startsWith(`${from}#`) ||
        (from.endsWith("/") && value.value.startsWith(from))
      )
        return DataFactory.namedNode(`${to}${value.value.slice(from.length)}`) as unknown as T;
    }
    return value;
  };
  return new Store(
    [...dataset].map((q) =>
      DataFactory.quad(
        term(q.subject),
        term(q.predicate),
        !objectPredicates || objectPredicates.has(q.predicate.value) ? term(q.object) : q.object,
        term(q.graph),
      ),
    ),
  );
}

/** RDF equality modulo blank-node labels (a server may relabel on every GET). */
export function sameGraph(expected: DatasetCore, actual: DatasetCore): boolean {
  if (expected.size !== actual.size) return false;
  return containsGraph(expected, actual);
}

/** Inclusion modulo blank-node labels, for a merge into a surviving graph. */
export function containsGraph(expected: DatasetCore, actual: DatasetCore): boolean {
  if (expected.size > actual.size) return false;
  const right = [...actual];
  const visit = (quads: Quad[], mapping: Map<string, string>): boolean => {
    const [head, ...tail] = quads;
    if (!head) return true;
    for (const candidate of right) {
      const next = new Map(mapping);
      const matches = (["subject", "predicate", "object", "graph"] as const).every((key) => {
        const a = head[key];
        const b = candidate[key];
        if (a.termType !== "BlankNode") return a.equals(b);
        if (b.termType !== "BlankNode") return false;
        const mapped = next.get(a.value);
        if (mapped !== undefined) return mapped === b.value;
        if ([...next.values()].includes(b.value)) return false;
        next.set(a.value, b.value);
        return true;
      });
      if (matches && visit(tail, next)) return true;
    }
    return false;
  };
  return visit([...expected], new Map());
}

/**
 * Isomorphism for read-back certification. rdf-isomorphic proposes a blank-node
 * mapping from term hashes alone, which can pair graphs that are not isomorphic
 * (a six-node blank cycle and two three-node cycles hash alike). Apply its mapping
 * and require the relabelled quads to be exactly the other graph.
 */
export function isomorphicGraph(expected: DatasetCore, actual: DatasetCore): boolean {
  if (expected.size !== actual.size) return false;
  const bijection = getBijection([...expected], [...actual]);
  if (!bijection) return false;
  const targets = Object.values(bijection);
  if (new Set(targets).size !== targets.length) return false;
  // rdf-isomorphic keys blank nodes as "_:<label>" (rdf-string). Quoted triples fail closed.
  const key = (quad: Quad, blank: (label: string) => string | undefined) => {
    const terms = [quad.subject, quad.predicate, quad.object, quad.graph].map((term) => {
      if (term.termType === "BlankNode") return blank(`_:${term.value}`);
      if (term.termType === "Quad") return undefined;
      return term.termType === "Literal"
        ? [term.termType, term.value, term.language, term.datatype.value]
        : [term.termType, term.value];
    });
    return terms.includes(undefined) ? undefined : JSON.stringify(terms);
  };
  const stored = new Set([...actual].map((quad) => key(quad, (label) => label)));
  for (const quad of expected) {
    const mapped = key(quad, (label) => bijection[label]);
    if (mapped === undefined || !stored.has(mapped)) return false;
  }
  // An injective mapping sends distinct quads to distinct quads, and the sizes match.
  return true;
}
