// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import type { Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { HealthTerm } from "./canonical-vocab.js";
import { Details, validDate } from "./metrics.js";
import type { HealthDocument } from "./model.js";

export type RecordKind = "conditions" | "medications" | "immunisations" | "records";
export interface RecordInput {
  iri: string;
  kind: RecordKind;
  patient: string;
  name: string;
  reference: string;
  note?: string;
  reminders: readonly { iri: string; at: Date }[];
}
export class Reminder extends HealthTerm {
  get at(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEDULING}triggerTime`, LiteralAs.date);
  }
  set at(value: Date | undefined) {
    OptionalAs.object(this, `${NS.SCHEDULING}triggerTime`, value, LiteralFrom.dateTime);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.RDF}type`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
export class RecordDetails extends Details {
  get reminders(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.SCHEDULING}hasReminder`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
export function addRecord(document: HealthDocument, input: RecordInput): void {
  for (const iri of [
    input.iri,
    input.patient,
    input.reference,
    ...input.reminders.map((reminder) => reminder.iri),
  ]) {
    if (safeHttpIri(iri) !== iri) throw new TypeError("Invalid record IRI");
  }
  if (!input.name.trim()) throw new TypeError("Record needs a name");
  for (const reminder of input.reminders) validDate(reminder.at);
  if (input.kind === "records") {
    const record = document.mintHealthRecord(input.iri);
    record.patientSubject = input.patient;
    record.entries.clear();
    record.entries.add(input.reference);
  } else if (input.kind === "conditions") {
    const condition = document.mintCondition(input.iri);
    condition.patient = input.patient;
    condition.code = input.reference;
  } else if (input.kind === "medications") {
    const medication = document.mintMedicationStatement(input.iri);
    medication.patient = input.patient;
    medication.medication = input.reference;
  } else {
    const immunization = document.mintImmunization(input.iri);
    immunization.patient = input.patient;
    immunization.vaccine = input.reference;
  }
  const details = new RecordDetails(input.iri, document, DataFactory);
  details.name = input.name;
  details.note = input.note;
  details.reminders.clear();
  for (const entry of input.reminders) {
    const reminder = new Reminder(entry.iri, document, DataFactory);
    reminder.types.add(`${NS.SCHEDULING}Reminder`);
    reminder.at = entry.at;
    details.reminders.add(entry.iri);
  }
}
export function records(document: HealthDocument, kind: RecordKind): RecordDetails[] {
  const groups = {
    records: document.records,
    conditions: document.conditions,
    medications: document.medicationStatements,
    immunisations: document.immunizations,
  };
  return [...groups[kind]].map((entry) => new RecordDetails(entry as Term, document, DataFactory));
}
