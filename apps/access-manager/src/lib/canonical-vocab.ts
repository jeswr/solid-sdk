// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";

/** Resolve accm vocabulary only; resource identifiers and literals stay intact. */
export function accmTerm(iri: string): string {
  const resolved = canonicalize(iri);
  return resolved.startsWith(NS.ACCESS_MANAGER) ? resolved : iri;
}

/** Predicate aliases, canonical first. Resource identifiers are never resolved here. */
export function accmAliases(iri: string): string[] {
  const canonical = accmTerm(iri);
  return canonical.startsWith(NS.ACCESS_MANAGER)
    ? [canonical, `https://w3id.org/jeswr/accm#${canonical.slice(NS.ACCESS_MANAGER.length)}`]
    : [iri];
}

/** Canonicalize a serialization copy, preserving the caller's quads and graph names. */
export function canonicalizeAccmDataset(dataset: DatasetCore, factory: DataFactory): DatasetCore {
  const copy = new Store([...dataset]);
  for (const quad of dataset) {
    const predicate = accmTerm(quad.predicate.value);
    const vocabularyObject =
      predicate === `${NS.RDF}type` ||
      predicate === `${NS.SOLID}forClass` ||
      predicate === `${NS.ACCESS_MANAGER}status` ||
      predicate === `${NS.ACCESS_MANAGER}dataClass`;
    const object =
      vocabularyObject && quad.object.termType === "NamedNode"
        ? factory.namedNode(accmTerm(quad.object.value))
        : quad.object;
    if (predicate === quad.predicate.value && object.equals(quad.object)) continue;
    const graph =
      quad.graph.termType === "DefaultGraph"
        ? copy
        : new NamedGraphDataset(quad.graph, copy, factory);
    const anchor = new TermWrapper(quad.subject, graph, factory);
    SetFrom.subjectPredicate(anchor, predicate, TermAs.term, TermFrom.itself).add(object);
    copy.delete(quad);
  }
  return copy;
}
