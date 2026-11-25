// AUTHORED-BY Codex (GPT-6.1 Sol)
/** Lexical RDF identity policy missing from the runtime's normalising HTTP guard. */
import type { Term } from "@rdfjs/types";
import {
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  type TermWrapper,
} from "@rdfjs/wrapper";
import { safeHttpIri, tryRead } from "./iri.js";
import {
  AS_ATTRIBUTED_TO,
  AS_CONTEXT,
  AS_IN_REPLY_TO,
  DCT_IS_REPLACED_BY,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  WF_ASSIGNEE,
} from "./vocab.js";

const predicates = {
  author: AS_ATTRIBUTED_TO,
  room: AS_CONTEXT,
  inReplyTo: AS_IN_REPLY_TO,
  replacedBy: DCT_IS_REPLACED_BY,
  provAttributedTo: PROV_WAS_ATTRIBUTED_TO,
  provGeneratedBy: PROV_WAS_GENERATED_BY,
  provDerivedFrom: PROV_WAS_DERIVED_FROM,
  assignee: WF_ASSIGNEE,
} as const;
type Iris = Partial<Record<keyof typeof predicates, string>>;

/** Retain singleton cardinality, then escape/filter without changing URL identity. */
export function readMessageIris(doc: TermWrapper): Iris {
  const result: Iris = {};
  for (const key of Object.keys(predicates) as (keyof Iris)[]) {
    const predicate = predicates[key];
    let term: Term | undefined;
    let ambiguous = false;
    for (const quad of doc.dataset.match(
      doc.factory.namedNode(doc.value),
      doc.factory.namedNode(predicate),
    )) {
      if (term !== undefined && !term.equals(quad.object)) {
        ambiguous = true;
        break;
      }
      term = quad.object;
    }
    if (term === undefined || ambiguous) continue;
    const value = safeHttpIri(
      tryRead(() => OptionalFrom.subjectPredicate(doc, predicate, NamedNodeAs.string)),
    );
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** The generated core builds the record; restore guarded lexical object identities. */
export function writeMessageIris(doc: TermWrapper, values: Iris): void {
  for (const key of Object.keys(predicates) as (keyof Iris)[]) {
    OptionalAs.object(doc, predicates[key], safeHttpIri(values[key]), NamedNodeFrom.string);
  }
}
