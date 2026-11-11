// AUTHORED-BY Codex GPT-6.1-Sol
import type { Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import {
  DCT_TYPE,
  FOAF_ACCOUNT_NAME,
  PROV_GENERATED_AT_TIME,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_GENERATED_BY,
  RDF_TYPE,
  XSD,
} from "./vocab.js";

function plainString(term: TermWrapper): string {
  if (term.termType !== "Literal" || term.datatype.value !== `${XSD}string`)
    throw new Error("Invalid conversation provenance literal");
  return LiteralAs.string(term);
}

function dateTime(term: TermWrapper): Date {
  if (
    term.termType !== "Literal" ||
    term.datatype.value !== `${XSD}dateTime` ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(term.value)
  )
    throw new Error("Invalid conversation provenance timestamp");
  const date = LiteralAs.date(term);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid conversation provenance timestamp");
  return date;
}

/** Typed views of conversation, account and capture subjects in one metadata document. */
export class ConversationProvenanceDoc extends TermWrapper {
  private optional<T>(predicate: string, mapper: (term: TermWrapper) => T): T | undefined {
    // OptionalFrom returns the first value; ambiguous provenance must fail closed.
    if (this.dataset.match(this as Term, this.factory.namedNode(predicate)).size > 1)
      throw new Error("Ambiguous conversation provenance");
    return OptionalFrom.subjectPredicate(this, predicate, mapper);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get attributedTo(): string | undefined {
    return this.optional(PROV_WAS_ATTRIBUTED_TO, NamedNodeAs.string);
  }
  set attributedTo(value: string | undefined) {
    OptionalAs.object(this, PROV_WAS_ATTRIBUTED_TO, value, NamedNodeFrom.string);
  }
  get generatedBy(): string | undefined {
    return this.optional(PROV_WAS_GENERATED_BY, NamedNodeAs.string);
  }
  set generatedBy(value: string | undefined) {
    OptionalAs.object(this, PROV_WAS_GENERATED_BY, value, NamedNodeFrom.string);
  }
  get generatedAt(): Date | undefined {
    return this.optional(PROV_GENERATED_AT_TIME, dateTime);
  }
  set generatedAt(value: Date | undefined) {
    OptionalAs.object(this, PROV_GENERATED_AT_TIME, value, LiteralFrom.dateTime);
  }
  get accountName(): string | undefined {
    return this.optional(FOAF_ACCOUNT_NAME, plainString);
  }
  set accountName(value: string | undefined) {
    OptionalAs.object(this, FOAF_ACCOUNT_NAME, value, LiteralFrom.string);
  }
  get channel(): string | undefined {
    return this.optional(DCT_TYPE, plainString);
  }
  set channel(value: string | undefined) {
    OptionalAs.object(this, DCT_TYPE, value, LiteralFrom.string);
  }
}
