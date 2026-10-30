// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";

/** Resolve pc: read aliases without changing resource identifiers or literals. */
function chatTerm(iri: string): string {
  const resolved = canonicalize(iri);
  return resolved.startsWith(NS.POD_CHAT) ? resolved : iri;
}

/** Migrate pc: vocabulary in memory; the caller controls when it is persisted. */
export function canonicalizeChatDataset(
  dataset: DatasetCore,
  factory: DataFactory,
  subject?: Term,
): DatasetCore {
  for (const quad of [...(subject === undefined ? dataset : dataset.match(subject))]) {
    const predicate = chatTerm(quad.predicate.value);
    const object =
      (predicate === `${NS.RDF}type` || predicate === `${NS.SOLID}forClass`) &&
      quad.object.termType === "NamedNode"
        ? factory.namedNode(chatTerm(quad.object.value))
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
