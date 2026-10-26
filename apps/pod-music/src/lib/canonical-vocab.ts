// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";

function federationTerm(iri: string): string {
  const resolved = canonicalize(iri);
  return resolved.startsWith(NS.FED) || resolved.startsWith("https://jeswr.org/ns/sectors/")
    ? resolved
    : iri;
}

/**
 * A canonical copy of `dataset`: legacy federation metadata is rewritten, music and resource IRIs
 * are kept, and the caller's dataset is never changed.
 */
export function canonicalizeFederationDataset(dataset: DatasetCore, factory: DataFactory): Store {
  const copy = new Store([...dataset]);
  for (const quad of dataset) {
    const predicate = federationTerm(quad.predicate.value);
    const vocabularyObject =
      predicate === `${NS.RDF}type` ||
      predicate === `${NS.SOLID}forClass` ||
      predicate === `${NS.FED}sector` ||
      predicate === `${NS.FED}consumes` ||
      predicate === `${NS.FED}produces`;
    const object =
      vocabularyObject && quad.object.termType === "NamedNode"
        ? factory.namedNode(federationTerm(quad.object.value))
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
