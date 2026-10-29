// AUTHORED-BY Codex GPT-6.1-Sol
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
import { RDF, SCHEMA } from "./vocab.js";
/** Metadata for extracted MIME parts. The subject is the stored binary URL. */
export class Attachment extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, value, LiteralFrom.string);
  }
  get contentType(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}encodingFormat`, LiteralAs.string);
  }
  set contentType(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}encodingFormat`, value, LiteralFrom.string);
  }
}
