// AUTHORED-BY Claude Fable 5
//
// The structured error taxonomy for the composed four-phase chain verifier,
// per the Agent Authorization Credentials note's Verification section. Every deny
// carries exactly one code so a golden-master decision matrix can pin the precise
// failure, and a recorded decision is machine-comparable.
//
// Extracted verbatim (semantics unchanged) from
// `@jeswr/accountable-agent-runtime` `src/chain-verifier/errors.ts` @ 72ec20a.

/** Which phase of the four-phase verification a result was produced in. */
export type VerifierPhase =
  | "assembly" // extract policies + order the chain root-first (reject cycles/branches/gaps)
  | "A" // credential integrity + validity window (per-credential, one instant)
  | "B" // cross-binding (issuer ≡ subject ≡ assigner; authorizes ≡ next assigner; root ≡ trusted)
  | "C" // status ∪ revocation, fail-closed
  | "D" // the delegation-profile chain walk (evaluateDelegated)
  | "composition" // the D9 identity-composition rule (a second chain rooted at the leaf assignee)
  | "complete"; // authorized

/**
 * The verifier's deny codes. Phase-A codes mirror `@jeswr/solid-vc`'s
 * `VerificationErrorCode`; the rest are the composed layer's own (the note's
 * `CHAIN_MALFORMED` / `BINDING_MISMATCH` / `STATUS_RETRIEVAL_ERROR` /
 * `POLICY_DENIED`, plus the identity-composition and provisional-policy-integrity
 * codes this verifier pins).
 */
export type VerifierErrorCode =
  // assembly
  | "CHAIN_MALFORMED"
  // Phase A (from solid-vc verifyCredential)
  | "MALFORMED"
  | "NO_PROOF"
  | "UNKNOWN_CRYPTOSUITE"
  | "INVALID_SIGNATURE"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "ISSUER_MISMATCH"
  | "PROOF_PURPOSE_MISMATCH"
  | "UNTRUSTED_ISSUER"
  // Phase B
  | "BINDING_MISMATCH"
  // Phase B — the delegation-trust identity anchor: a credential's self-asserted
  // `credentialSubject.id` disagrees with its PROOF-VERIFIED `issuer`. Fail-closed:
  // `verifyCredential` proves the signature against `issuer` + key control but does
  // NOT constrain the subject id, so an attacker controlling their own valid issuer
  // could otherwise name a trusted party in `subject.id` and have the grant accepted
  // as that party's. The delegating principal is ALWAYS the proof-verified issuer.
  | "SUBJECT_ISSUER_MISMATCH"
  // Phase B — the policy-content binding gate (G1): the presented policy content's
  // canonical digest did not match the credential's signed `relatedResource`
  // digest (solid-vc `RELATED_RESOURCE_MISMATCH`), or the credential carries NO
  // digest for a presented policy (`RELATED_RESOURCE_MISSING`).
  | "POLICY_INTEGRITY"
  // Phase C — status ∪ revocation (the W3C Bitstring Status List gate runs
  // through solid-vc's `resolveStatus` seam, fail-closed; the `odrld:Revocation`
  // set is the delegation-profile's POLICY-level revocation input, a distinct
  // mechanism)
  | "STATUS_RETRIEVAL_ERROR"
  | "REVOKED"
  // the Bitstring `suspension` purpose mapping (a suspended credential is denied
  // like a revoked one, but the code preserves the distinct semantics)
  | "SUSPENDED"
  // Phase D
  | "POLICY_DENIED"
  // composition (D9)
  | "IDENTITY_COMPOSITION_FAILED";

/** The Phase-A codes that `@jeswr/solid-vc`'s `verifyCredential` can return. */
export const PHASE_A_CODES = new Set<VerifierErrorCode>([
  "MALFORMED",
  "NO_PROOF",
  "UNKNOWN_CRYPTOSUITE",
  "INVALID_SIGNATURE",
  "EXPIRED",
  "NOT_YET_VALID",
  "ISSUER_MISMATCH",
  "PROOF_PURPOSE_MISMATCH",
  "UNTRUSTED_ISSUER",
]);

/**
 * The `@jeswr/solid-vc` codes of the G1 policy-content digest gate (raised by the
 * `presentedResources` option of `verifyCredential`). The composed verifier maps
 * either to a `POLICY_INTEGRITY` deny — the credential↔policy-content binding broke.
 */
export const RELATED_RESOURCE_CODES: ReadonlySet<string> = new Set([
  "RELATED_RESOURCE_MISSING",
  "RELATED_RESOURCE_MISMATCH",
]);

/**
 * The `@jeswr/solid-vc` codes of the G2 Bitstring Status List gate (raised by the
 * `resolveStatus` option of `verifyCredential`). The composed verifier maps each to
 * its Phase-C deny: `STATUS_REVOKED` → `REVOKED`, `STATUS_SUSPENDED` → `SUSPENDED`,
 * `STATUS_UNREACHABLE` → `STATUS_RETRIEVAL_ERROR` (the note's "retrieval failure
 * must deny" fail-closed rule).
 */
export const STATUS_GATE_CODES: ReadonlySet<string> = new Set([
  "STATUS_REVOKED",
  "STATUS_SUSPENDED",
  "STATUS_UNREACHABLE",
]);
