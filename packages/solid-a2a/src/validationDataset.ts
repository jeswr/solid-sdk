// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { canonicalA2aIri, RDF_TYPE } from "./vocab.js";

/**
 * A disposable view for parsing and SHACL, NEVER for hashing or serializing a PD.
 * Apply exactly the same renaming in every position of data and shapes: SHACL
 * expressions can mix vocabulary and resource values, so their roles cannot be
 * inferred safely. Reject data whose distinct identity terms would collapse.
 */
export function validationDataset(dataset: DatasetCore, checkIdentities = true): Store | undefined {
  const identities = new Map<string, string>();
  if (checkIdentities) {
    for (const quad of dataset) {
      for (const term of [
        quad.subject,
        ...(quad.predicate.value === RDF_TYPE ? [] : [quad.object]),
      ]) {
        if (term.termType !== "NamedNode") continue;
        const iri = canonicalA2aIri(term.value);
        const previous = identities.get(iri);
        if (previous !== undefined && previous !== term.value) return undefined;
        identities.set(iri, term.value);
      }
    }
  }

  function canonical(term: Quad["graph"]): Quad["graph"];
  function canonical(term: Term): Term;
  function canonical(term: Term): Term {
    if (term.termType === "NamedNode") {
      return DataFactory.namedNode(canonicalA2aIri(term.value));
    }
    if (term.termType === "Literal") {
      return DataFactory.literal(
        term.value,
        term.language || DataFactory.namedNode(canonicalA2aIri(term.datatype.value)),
      );
    }
    return term;
  }

  const store = new Store();
  for (const quad of dataset) {
    const node = new TermWrapper(
      canonical(quad.subject),
      new NamedGraphDataset(canonical(quad.graph), store, DataFactory),
      DataFactory,
    );
    SetFrom.subjectPredicate(
      node,
      canonicalA2aIri(quad.predicate.value),
      (value) => TermFrom.instance(value, DataFactory),
      TermFrom.itself,
    ).add(canonical(quad.object));
  }
  return store;
}
