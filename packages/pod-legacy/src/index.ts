// AUTHORED-BY Codex GPT-6.1-Sol
export { buildPlan, entities, parsePlan, serializePlan } from "./model.js";
export type { LegacyContact, LegacyPlan, PlanEvaluation, ProposedGrant } from "./plan.js";
export {
  dueDate,
  evaluatePlan,
  isWebId,
  planPolicy,
  proposedGrants,
  recordActivity,
  validPlan,
} from "./plan.js";
export type { LegacySnapshot } from "./storage.js";
export { createLegacyStore, LegacyPrivacyError } from "./storage.js";
