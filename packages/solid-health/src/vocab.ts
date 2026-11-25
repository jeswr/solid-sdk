// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
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
export const CODE_SCHEMES = { loinc: "http://loinc.org" } as const;
export const UNITS = {
  count: `${NS.UNIT}NUM`,
  metres: `${NS.UNIT}M`,
  seconds: `${NS.UNIT}SEC`,
  pulse: `${NS.UNIT}BEAT-PER-MIN`,
} as const;
