// AUTHORED-BY Codex GPT-6.1-Sol
/** Signed mandate and approval APIs. The optional Node binary adapter is exported at ./sparq. */
export {
  type Approval,
  type ApprovalResult,
  issueApproval,
  readApprovalClaims,
  verifyApproval,
} from "./approval.js";
export {
  type ControlStatementClaims,
  type ControlStatementResult,
  issueControlStatement,
  readControlClaims,
  readControlVerificationMethod,
  verifyControlStatement,
} from "./control.js";
export { mandateToTurtle, parseMandateCredential } from "./document.js";
export { createLegacyMandateVerifier, type LegacyPinnedKey } from "./legacy.js";
export {
  createVcMandateVerifier,
  defaultMandate,
  issueMandate,
  limitConstraint,
  mandateCredential,
  type VcMandateOptions,
} from "./mandate.js";
export { createPodMandateVerifier, type PodMandateOptions } from "./pod.js";
export { evaluateIntent, solidOdrlEngine } from "./policy.js";
export { type RemovePermissionOptions, reissueMandate, removePermission } from "./reduce.js";
export { autonomousTargets } from "./scope.js";
export {
  AGENT,
  type Constraint,
  type Decision,
  type Effect,
  type Intent,
  LIMIT_OPERANDS,
  type Limit,
  type Mandate,
  type MandateVerifier,
  ODRL,
  type Policy,
  type PolicyEngine,
  type Rule,
} from "./types.js";
