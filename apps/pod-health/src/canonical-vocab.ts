// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";

/**
 * Normalize vocabulary predicates and rdf:type objects in memory through typed
 * accessors. Resource identities, literal contents and graph names are preserved.
 * No pod write occurs until the caller explicitly saves the document.
 */
export function canonicalizeHealthDataset(
  dataset: DatasetCore,
  factory: DataFactory,
  subject?: Term,
): DatasetCore {
  const quads = subject === undefined ? dataset : dataset.match(subject);
  for (const quad of [...quads]) {
    const predicate = canonicalize(quad.predicate.value);
    const object =
      quad.predicate.value === `${NS.RDF}type` && quad.object.termType === "NamedNode"
        ? factory.namedNode(canonicalize(quad.object.value))
        : quad.object;
    if (predicate === quad.predicate.value && object.equals(quad.object)) continue;
    const graph =
      quad.graph.termType === "DefaultGraph"
        ? dataset
        : new NamedGraphDataset(quad.graph, dataset, factory);
    const anchor = new TermWrapper(quad.subject, graph, factory);
    SetFrom.subjectPredicate(anchor, predicate, TermAs.term, TermFrom.itself).add(object);
    dataset.delete(quad);
  }
  return dataset;
}

/** Health entities accept legacy vocabulary even when wrapped independently. */
export class HealthTerm extends TermWrapper {
  constructor(term: string | Term, dataset: DatasetCore, factory: DataFactory) {
    const subject = typeof term === "string" ? factory.namedNode(term) : term;
    super(subject, canonicalizeHealthDataset(dataset, factory, subject), factory);
  }
}
