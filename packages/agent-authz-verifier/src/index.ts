// AUTHORED-BY Claude Fable 5
//
// @jeswr/agent-authz-verifier — the composed four-phase agent-authorization
// chain verifier, extracted from @jeswr/accountable-agent-runtime (its D2
// extraction target). Pure + injectable: zero I/O, zero RDF parsing; all
// network enters through the resolveKey / isControlledBy / resolveStatus seams.

// Convenience re-exports of the seam types appearing in the public signatures,
// so a consumer can type a chain / request / seam without importing the exact
// pinned dependency versions itself.
export type {
  ActiveDuty,
  DelegatedEvaluationResult,
  OdrlPolicy,
  RequestContext,
} from "@jeswr/solid-odrl";
export type {
  CredentialStatusCheck,
  PresentedResourceContent,
  VerifiableCredential,
  VerifyCredentialOptions,
} from "@jeswr/solid-vc";
export type { VerifierErrorCode, VerifierPhase } from "./errors.js";
export { PHASE_A_CODES, RELATED_RESOURCE_CODES, STATUS_GATE_CODES } from "./errors.js";
export type {
  BoundAuthorization,
  PresentedChain,
  VerifyAuthorityOptions,
  VerifyAuthorityResult,
} from "./verifier.js";
export { readBoundAuthorization, verifyAgentAuthority } from "./verifier.js";
