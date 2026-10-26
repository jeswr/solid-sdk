// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";

function taskTerm(iri: string): string {
  const resolved = canonicalize(iri);
  return resolved.startsWith(NS.TASK) ? resolved : iri;
}

/** Normalize app-local tm extensions without changing task/resource identities. */
export function canonicalizeTaskDataset(dataset: DatasetCore, factory: DataFactory): DatasetCore {
  for (const quad of [...dataset]) {
    const predicate = taskTerm(quad.predicate.value);
    const vocabularyObject =
      predicate === `${NS.RDF}type` ||
      predicate === `${NS.SOLID}forClass` ||
      predicate === `${NS.TASK}trigger` ||
      predicate === `${NS.TASK}action`;
    const object =
      vocabularyObject && quad.object.termType === "NamedNode"
        ? factory.namedNode(taskTerm(quad.object.value))
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

/** Tracker reads include linked status/rule nodes in the same document. */
export class TaskTerm extends TermWrapper {
  constructor(term: string | Term, dataset: DatasetCore, factory: DataFactory) {
    const subject = typeof term === "string" ? factory.namedNode(term) : term;
    super(subject, canonicalizeTaskDataset(dataset, factory), factory);
  }
}
