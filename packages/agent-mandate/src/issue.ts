// AUTHORED-BY Codex GPT-6.1-Sol
/** Browser-safe mandate creation entry point for owner applications. */
export { mandateToTurtle } from "./document.js";
export {
  defaultMandate,
  issueMandate,
  limitConstraint,
  mandateCredential,
} from "./mandate.js";
export { type RemovePermissionOptions, reissueMandate, removePermission } from "./reduce.js";
