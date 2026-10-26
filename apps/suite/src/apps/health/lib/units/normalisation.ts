// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type CanonicalUnit, canonicalUnit, convertUnit, type Measure } from "./conversion";
import { UnitError } from "./errors";

/** A scalar observation. The caller supplies the measure from its typed data model. */
export interface UnitObservation {
  readonly measure: Measure;
  readonly value: number;
  readonly unit: string;
}

/** Only required fields are guaranteed; metadata ownership/enumerability is not typed. */
export type NormalisedObservation<T extends UnitObservation> = {
  readonly measure: T["measure"];
  readonly value: number;
  readonly unit: CanonicalUnit<T["measure"]>;
};

/** Return a fresh record, shallow-copying only own enumerable metadata properties. */
export function normaliseObservation<T extends UnitObservation>(
  observation: T,
): NormalisedObservation<T> {
  if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
    throw new UnitError("invalid-observation", "Expected a scalar observation record");
  }
  const { measure, value: inputValue, unit: inputUnit } = observation;
  const unit = canonicalUnit<T["measure"]>(measure);
  const value = convertUnit(inputValue, inputUnit, unit, measure);
  return { ...observation, measure, value, unit };
}
