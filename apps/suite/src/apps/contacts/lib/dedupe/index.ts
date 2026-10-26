// AUTHORED-BY Codex GPT-6.1-Sol
export { clusterContacts } from "./cluster";
export { DedupeError, type DedupeErrorCode } from "./errors";
export { planMerges } from "./merge";
export { normaliseEmail, normaliseName, normalisePhone } from "./normalise";
export type {
  ContactCluster,
  DedupeContact,
  DedupeOptions,
  FieldConflict,
  FieldValue,
  MergePlan,
} from "./types";
