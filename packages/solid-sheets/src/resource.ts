// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import {
  DatasetWrapper,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { httpIri } from "./layout.js";
import { DCT, RDF, SCHEMA, SOLID } from "./vocab.js";
// Compatibility view for arbitrary predicates and blank-node Type Index registrations.
// The generator only exposes vocabulary-bound NamedNode subjects. Preserve this public
// view's original reads/writes; workbook and descriptor build/parse never use it.
/** Shared typed accessors, following PM's DataCollection / TypeRegistration patterns. */
export class SheetResource extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  text(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(
      this,
      predicate,
      (term) => LiteralAs.datatypeTuple(term)[1],
    );
  }
  setText(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  iri(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  setIri(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, httpIri(value), NamedNodeFrom.string);
  }
  links(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get position(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}position`, LiteralAs.number);
  }
  set position(value: number) {
    OptionalAs.object(this, `${SCHEMA}position`, value, LiteralFrom.integer);
  }
  get date(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}modified`, LiteralAs.date);
  }
  set date(value: Date) {
    OptionalAs.object(this, `${DCT}modified`, value, LiteralFrom.dateTime);
  }
}

// The generator exposes single-subject entities, not dataset-wide enumeration.
class RegistrationDataset extends DatasetWrapper {
  get registrations() {
    return this.instancesOf(`${SOLID}TypeRegistration`, SheetResource);
  }
}

export function sheetRegistrations(dataset: DatasetCore): Iterable<SheetResource> {
  return new RegistrationDataset(dataset, DataFactory).registrations;
}
