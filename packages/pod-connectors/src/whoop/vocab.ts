// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
} from "@rdfjs/wrapper";
import { ActionThing } from "../core/vocab.js";

/** Existing Health app/sector terms; no WHOOP vocabulary is minted. */
export const HEALTH = {
  Record: `${NS.HEALTH}HealthRecord`,
  Observation: `${NS.HEALTH}Observation`,
  HeartRate: `${NS.HEALTH}HeartRateObservation`,
  VitalSign: `${NS.HEALTH}VitalSign`,
  Sleep: `${NS.HEALTH}SleepObservation`,
  Code: `${NS.HEALTH}CodeableConcept`,
  Person: `${NS.CORE}Person`,
  Instant: `${NS.TIME}Instant`,
  subject: `${NS.CORE}subject`,
  patient: `${NS.HEALTH}patient`,
  hasEntry: `${NS.HEALTH}hasEntry`,
  hasCode: `${NS.HEALTH}hasCode`,
  value: `${NS.HEALTH}value`,
  hasUnit: `${NS.HEALTH}hasUnit`,
  unitCode: `${NS.HEALTH}unitCode`,
  effectiveTime: `${NS.HEALTH}effectiveTime`,
  codeValue: `${NS.CORE}value`,
  inScheme: `${NS.CORE}inScheme`,
  at: `${NS.TIME}inXSDDateTimeStamp`,
  source: `${NS.DCT}source`,
  end: `${NS.SCHEMA}endTime`,
} as const;

/** Same typed-accessor representation as the Health app's Apple Health model. */
export class HealthNode extends ActionThing {
  get source(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH.source, LiteralAs.string);
  }
  set source(value: string | undefined) {
    OptionalAs.object(this, HEALTH.source, value, LiteralFrom.string);
  }
  get measuredValue(): number | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH.value, LiteralAs.number);
  }
  set measuredValue(value: number | undefined) {
    OptionalAs.object(this, HEALTH.value, value, LiteralFrom.double);
  }
  get dateTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH.at, LiteralAs.date);
  }
  set dateTime(value: Date | undefined) {
    OptionalAs.object(this, HEALTH.at, value, LiteralFrom.dateTime);
  }
  set endTime(value: Date | undefined) {
    OptionalAs.object(this, HEALTH.end, value, LiteralFrom.dateTime);
  }
  text(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  link(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  linked(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
}
