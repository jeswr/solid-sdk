// AUTHORED-BY Codex GPT-6.1-Sol
import { type CanonicalUnit, canonicalUnit, convertUnit, type Measure } from "./conversion";
import { UnitError } from "./errors";

/** A scalar observation. The caller supplies the measure from its typed data model. */
export interface UnitObservation {
  readonly measure: Measure;
  readonly value: number;
  readonly unit: string;
}

export type NormalisedObservation<T extends UnitObservation> = Omit<T, "value" | "unit"> & {
  readonly value: number;
  readonly unit: CanonicalUnit<T["measure"]>;
};

/** Return a fresh record, preserving caller metadata without mutating the input. */
export function normaliseObservation<T extends UnitObservation>(
  observation: T,
): NormalisedObservation<T> {
  if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
    throw new UnitError("invalid-observation", "Expected a scalar observation record");
  }
  const unit = canonicalUnit<T["measure"]>(observation.measure);
  const value = convertUnit(observation.value, observation.unit, unit, observation.measure);
  return { ...observation, value, unit };
}
