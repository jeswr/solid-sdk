/** Message triage: deterministic-first suggestions with an optional hosted classifier. */
export { type ClassifierAnswer, ClassifierError, type TriageClassifier } from "./classifier.js";
export { type LabelledSample, SYNTHETIC_CORPUS } from "./corpus.js";
export { baselineTriage } from "./deterministic.js";
export { type EvaluationReport, evaluate } from "./evaluate.js";
export * from "./taxonomy.js";
export { type HostedRequest, isAgentProtocolMessage, triageSample } from "./triage.js";
export {
  DEFAULT_TYPESAFE_MODEL,
  isPinnedModel,
  TYPESAFE_ENDPOINT,
  TypeSafeClassifier,
  typeSafeFromEnv,
} from "./typesafe.js";
