// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";

/** Resolve money vocabulary only; resource identifiers and literals stay intact. */
function moneyTerm(iri: string): string {
  const resolved = canonicalize(iri);
  return [NS.FINANCE, NS.CORE, NS.POD_MONEY].some((base) => resolved.startsWith(base))
    ? resolved
    : iri;
}

export function categoryClass(iri: string): string {
  const resolved = moneyTerm(iri);
  return resolved === `${NS.POD_MONEY}Category` ? `${NS.FINANCE}BudgetCategory` : resolved;
}

/**
 * Migrate vocabulary in memory through typed accessors, retaining graph names,
 * resource identities and literal contents. Persistence waits for the next save.
 */
export function canonicalizeMoneyDataset(
  dataset: DatasetCore,
  factory: DataFactory,
  subject?: Term,
): DatasetCore {
  for (const quad of [...(subject === undefined ? dataset : dataset.match(subject))]) {
    let predicate = moneyTerm(quad.predicate.value);
    if (predicate === `${NS.POD_MONEY}parent`) predicate = `${NS.SKOS}broader`;
    const object =
      (predicate === `${NS.RDF}type` || predicate === `${NS.SOLID}forClass`) &&
      quad.object.termType === "NamedNode"
        ? factory.namedNode(categoryClass(quad.object.value))
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

/** Standalone entity wrappers accept the same read aliases as whole documents. */
export class MoneyTerm extends TermWrapper {
  constructor(term: string | Term, dataset: DatasetCore, factory: DataFactory) {
    const subject = typeof term === "string" ? factory.namedNode(term) : term;
    super(subject, canonicalizeMoneyDataset(dataset, factory, subject), factory);
  }
}
