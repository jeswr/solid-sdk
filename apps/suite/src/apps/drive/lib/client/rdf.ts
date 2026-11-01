// AUTHORED-BY Codex
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";

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
