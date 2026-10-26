// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Term } from "@rdfjs/types";
import { NamedGraphDataset, NamedNodeFrom, SetFrom, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { canonicalA2aIri, RDF_TYPE, SH } from "./vocab.js";

// These SHACL objects denote vocabulary terms, rather than instance/shape nodes.
const VOCABULARY_OBJECT_PREDICATES = new Set([
  RDF_TYPE,
  `${SH}path`,
  `${SH}targetClass`,
  `${SH}class`,
  `${SH}targetSubjectsOf`,
  `${SH}targetObjectsOf`,
  `${SH}inversePath`,
  `${SH}zeroOrMorePath`,
  `${SH}oneOrMorePath`,
  `${SH}zeroOrOnePath`,
]);

const SH_PATH = NamedNodeFrom.string(`${SH}path`, DataFactory);
const TYPE = NamedNodeFrom.string(RDF_TYPE, DataFactory);

/** A disposable alias-equivalent view; NEVER use it when hashing or serializing a PD. */
export function validationDataset(dataset: DatasetCore): Store {
  const store = new Store();

  for (const quad of dataset) {
    const graph = new NamedGraphDataset(quad.graph, store, DataFactory);
    // Subjects, graph names and resource references retain their exact identity.
    // In particular, legacy/canonical action node IRIs MUST NOT collapse: the
    // parser follows those original links and reads fields on that exact node.
    const node = new TermWrapper(quad.subject, graph, DataFactory);
    const predicate = canonicalA2aIri(quad.predicate.value);
    const vocabularyObject =
      VOCABULARY_OBJECT_PREDICATES.has(predicate) ||
      // A hasValue on rdf:type denotes a class. Other hasValue constraints may
      // name resources, including resources whose IRIs start with the A2A base.
      (predicate === `${SH}hasValue` &&
        dataset.match(quad.subject, SH_PATH, TYPE, quad.graph).size > 0);
    const object: Term =
      vocabularyObject && quad.object.termType === "NamedNode"
        ? NamedNodeFrom.string(canonicalA2aIri(quad.object.value), DataFactory)
        : quad.object;
    SetFrom.subjectPredicate(
      node,
      predicate,
      (value) => TermFrom.instance(value, DataFactory),
      TermFrom.itself,
    ).add(object);
  }
  return store;
}
