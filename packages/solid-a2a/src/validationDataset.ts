// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Term } from "@rdfjs/types";
import { NamedGraphDataset, NamedNodeFrom, SetFrom, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { canonicalA2aIri } from "./vocab.js";

/** A disposable alias-equivalent view; NEVER use it when hashing or serializing a PD. */
export function validationDataset(dataset: DatasetCore): Store {
  const store = new Store();
  const term = (value: Term): Term =>
    value.termType === "NamedNode"
      ? NamedNodeFrom.string(canonicalA2aIri(value.value), DataFactory)
      : value;

  for (const quad of dataset) {
    const graph = new NamedGraphDataset(quad.graph, store, DataFactory);
    const node = new TermWrapper(term(quad.subject), graph, DataFactory);
    SetFrom.subjectPredicate(
      node,
      canonicalA2aIri(quad.predicate.value),
      (value) => TermFrom.instance(value, DataFactory),
      TermFrom.itself,
    ).add(term(quad.object));
  }
  return store;
}
