// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

const suiteRoot = new URL(".", NS.CORE).href;
const readAliases = Object.entries(LEGACY_NAMESPACES)
  .filter(([, canonical]) => canonical.startsWith(suiteRoot))
  .map(([legacy]) => legacy);

/** Resolve suite read aliases only; schema.org and other standard IRIs stay exact. */
export function canonicalJeswrIri(iri: string): string {
  return readAliases.some((legacy) => iri.startsWith(legacy)) ? canonicalize(iri) : iri;
}

/** Copy connector-owned data for typed access, preserving identifiers and literal contents. */
export function canonicalizeJeswrDataset(dataset?: DatasetCore): Store {
  const result = new Store();
  if (!dataset) return result;
  for (const quad of dataset) {
    const predicate = canonicalJeswrIri(quad.predicate.value);
    const object =
      (predicate === `${NS.RDF}type` || predicate === `${NS.SOLID}forClass`) &&
      quad.object.termType === "NamedNode"
        ? DataFactory.namedNode(canonicalJeswrIri(quad.object.value))
        : quad.object;
    if (predicate === quad.predicate.value && object.equals(quad.object)) {
      result.add(quad);
      continue;
    }
    const graph =
      quad.graph.termType === "DefaultGraph"
        ? result
        : new NamedGraphDataset(quad.graph, result, DataFactory);
    const anchor = new TermWrapper(quad.subject, graph, DataFactory);
    SetFrom.subjectPredicate(anchor, predicate, TermAs.term, TermFrom.itself).add(object);
  }
  return result;
}
