// AUTHORED-BY Codex GPT-6.1-Sol
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { PodThing, safeIri } from "./vocab.js";

export const PROV = "http://www.w3.org/ns/prov#";
/** Typed PROV accessors shared by the runners and shape tests. */
export class Provenance extends PodThing {
  get derivedFrom(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${PROV}wasDerivedFrom`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get generatedBy(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${PROV}wasGeneratedBy`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get used(): Set<string> {
    return SetFrom.subjectPredicate(this, `${PROV}used`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get associatedWith(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}wasAssociatedWith`, NamedNodeAs.string);
  }
  set associatedWith(value: string | undefined) {
    OptionalAs.object(this, `${PROV}wasAssociatedWith`, safeIri(value), NamedNodeFrom.string);
  }
  get startedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}startedAtTime`, LiteralAs.date);
  }
  set startedAt(value: Date | undefined) {
    OptionalAs.object(this, `${PROV}startedAtTime`, value, LiteralFrom.dateTime);
  }
  get endedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${PROV}endedAtTime`, LiteralAs.date);
  }
  set endedAt(value: Date | undefined) {
    OptionalAs.object(this, `${PROV}endedAtTime`, value, LiteralFrom.dateTime);
  }
}
