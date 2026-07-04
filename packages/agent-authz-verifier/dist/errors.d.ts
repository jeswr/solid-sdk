/** Which phase of the four-phase verification a result was produced in. */
export type VerifierPhase = "assembly" | "A" | "B" | "C" | "D" | "composition" | "complete";
/**
 * The verifier's deny codes. Phase-A codes mirror `@jeswr/solid-vc`'s
 * `VerificationErrorCode`; the rest are the composed layer's own (the note's
 * `CHAIN_MALFORMED` / `BINDING_MISMATCH` / `STATUS_RETRIEVAL_ERROR` /
 * `POLICY_DENIED`, plus the identity-composition and provisional-policy-integrity
 * codes this verifier pins).
 */
export type VerifierErrorCode = "CHAIN_MALFORMED" | "MALFORMED" | "NO_PROOF" | "UNKNOWN_CRYPTOSUITE" | "INVALID_SIGNATURE" | "EXPIRED" | "NOT_YET_VALID" | "ISSUER_MISMATCH" | "PROOF_PURPOSE_MISMATCH" | "UNTRUSTED_ISSUER" | "BINDING_MISMATCH" | "SUBJECT_ISSUER_MISMATCH" | "POLICY_INTEGRITY" | "STATUS_RETRIEVAL_ERROR" | "REVOKED" | "SUSPENDED" | "POLICY_DENIED" | "IDENTITY_COMPOSITION_FAILED";
/** The Phase-A codes that `@jeswr/solid-vc`'s `verifyCredential` can return. */
export declare const PHASE_A_CODES: Set<VerifierErrorCode>;
/**
 * The `@jeswr/solid-vc` codes of the G1 policy-content digest gate (raised by the
 * `presentedResources` option of `verifyCredential`). The composed verifier maps
 * either to a `POLICY_INTEGRITY` deny — the credential↔policy-content binding broke.
 */
export declare const RELATED_RESOURCE_CODES: ReadonlySet<string>;
/**
 * The `@jeswr/solid-vc` codes of the G2 Bitstring Status List gate (raised by the
 * `resolveStatus` option of `verifyCredential`). The composed verifier maps each to
 * its Phase-C deny: `STATUS_REVOKED` → `REVOKED`, `STATUS_SUSPENDED` → `SUSPENDED`,
 * `STATUS_UNREACHABLE` → `STATUS_RETRIEVAL_ERROR` (the note's "retrieval failure
 * must deny" fail-closed rule).
 */
export declare const STATUS_GATE_CODES: ReadonlySet<string>;
//# sourceMappingURL=errors.d.ts.map