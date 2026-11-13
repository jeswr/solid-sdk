// AUTHORED-BY Codex GPT-6.1-Sol
import { SOSA, SOSA_OBSERVATION } from "@jeswr/solid-environment";
import { createVocabMap } from "../core/vocab-map.js";
/** Environment builders already emit the canonical sector vocabulary. */
export const vocabMap = createVocabMap({});

/** Class IRIs shared by the adapter's Type Index registrations. */
export const ENVIRONMENT_CLASSES = Object.freeze({
  Sensor: `${SOSA}Sensor`,
  FeatureOfInterest: `${SOSA}FeatureOfInterest`,
  Observation: SOSA_OBSERVATION,
});
