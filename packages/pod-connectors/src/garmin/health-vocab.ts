// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Existing health sector / Health app measurement terms; no Garmin-specific IRIs. */
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
} from "@rdfjs/wrapper";
import { PodThing } from "../core/vocab.js";

export const HEALTH = {
  Record: `${NS.HEALTH}HealthRecord`,
  ClinicalEntry: `${NS.HEALTH}ClinicalEntry`,
  Observation: `${NS.HEALTH}Observation`,
  HeartRate: `${NS.HEALTH}HeartRateObservation`,
  VitalSign: `${NS.HEALTH}VitalSign`,
  Steps: `${NS.HEALTH}StepCountObservation`,
  Sleep: `${NS.HEALTH}SleepObservation`,
  Code: `${NS.HEALTH}CodeableConcept`,
  Person: `${NS.CORE}Person`,
  Instant: `${NS.TIME}Instant`,
  TemporalEntity: `${NS.TIME}TemporalEntity`,
} as const;

const PROP = {
  value: `${NS.HEALTH}value`,
  unit: `${NS.HEALTH}hasUnit`,
  unitCode: `${NS.HEALTH}unitCode`,
  code: `${NS.HEALTH}hasCode`,
  patient: `${NS.HEALTH}patient`,
  time: `${NS.HEALTH}effectiveTime`,
  codeValue: `${NS.CORE}value`,
  scheme: `${NS.CORE}inScheme`,
  source: `${NS.DCT}source`,
  timestamp: `${NS.TIME}inXSDDateTimeStamp`,
} as const;

/** Codes and units agree with Health's Apple importer for steps, pulse and sleep.
 * Other measurements use source field codes without asserting a concept scheme;
 * UCUM strings suffice where no verified QUDT unit is available locally.
 */
export const METRICS = {
  steps: [HEALTH.Steps, "55423-8", "1", `${NS.UNIT}NUM`],
  "resting-heart-rate": [HEALTH.HeartRate, "restingHeartRate", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  "minimum-heart-rate": [HEALTH.HeartRate, "minHeartRate", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  "maximum-heart-rate": [HEALTH.HeartRate, "maxHeartRate", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  "heart-rate": [HEALTH.HeartRate, "8867-4", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  distance: [HEALTH.Observation, "totalDistanceMeters", "m", `${NS.UNIT}M`],
  "active-energy": [HEALTH.Observation, "activeKilocalories", "kcal", undefined],
  floors: [HEALTH.Observation, "floorsAscended", "1", `${NS.UNIT}NUM`],
  sleep: [HEALTH.Sleep, "93832-4", "s", `${NS.UNIT}SEC`],
  hrv: [HEALTH.Observation, "lastNightAvg", "ms", undefined],
  "vo2max-running": [HEALTH.Observation, "running.vo2MaxValue", "mL/(kg.min)", undefined],
  "vo2max-cycling": [HEALTH.Observation, "cycling.vo2MaxValue", "mL/(kg.min)", undefined],
} as const;
export type Metric = keyof typeof METRICS;
export const CODE_SCHEMES = { loinc: "http://loinc.org" };

export class HealthObservation extends PodThing {
  get measuredValue(): number | undefined {
    return OptionalFrom.subjectPredicate(this, PROP.value, LiteralAs.number);
  }
  set measuredValue(value: number | undefined) {
    OptionalAs.object(this, PROP.value, value, LiteralFrom.double);
  }
  set unit(value: string | undefined) {
    OptionalAs.object(this, PROP.unit, value, NamedNodeFrom.string);
  }
  get unit(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROP.unit, NamedNodeAs.string);
  }
  set unitCode(value: string) {
    OptionalAs.object(this, PROP.unitCode, value, LiteralFrom.string);
  }
  get unitCode(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROP.unitCode, LiteralAs.string);
  }
  set code(value: string) {
    OptionalAs.object(this, PROP.code, value, NamedNodeFrom.string);
  }
  set patient(value: string) {
    OptionalAs.object(this, PROP.patient, value, NamedNodeFrom.string);
  }
  set time(value: string) {
    OptionalAs.object(this, PROP.time, value, NamedNodeFrom.string);
  }
  set source(value: string) {
    OptionalAs.object(this, PROP.source, value, LiteralFrom.string);
  }
}

export class HealthCode extends PodThing {
  set code(value: string) {
    OptionalAs.object(this, PROP.codeValue, value, LiteralFrom.string);
  }
  set scheme(value: string) {
    OptionalAs.object(this, PROP.scheme, value, NamedNodeFrom.string);
  }
}
export class HealthInstant extends PodThing {
  set dateTime(value: Date) {
    OptionalAs.object(this, PROP.timestamp, value, LiteralFrom.dateTime);
  }
}
