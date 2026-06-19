import { type VerifiableCredential } from "@jeswr/solid-vc";
import type { MembershipVerificationResult, VerifyMembershipOptions } from "./types.js";
/**
 * VERIFY a signed membership credential against the verifier's trust anchors and
 * expectations. Returns a {@link MembershipVerificationResult} whose `verified` is
 * `true` IFF every gate passed; on failure `errors` lists every distinct reason.
 * Never throws on an invalid credential.
 *
 * The gates run in order; each appends its distinct failure reason(s) so the result
 * reports EVERY way the credential failed, never just the first:
 *   0. trust anchors present                    → NO_TRUST_ANCHOR (early return)
 *   1. well-formed VC + MembershipCredential     → MALFORMED
 *   2. {@link readMembershipClaim}               → MISSING_CLAIM / UNKNOWN_STATUS / ASSERTED_BY_MISMATCH
 *   3. {@link establishTrust}                    → BROKEN_CHAIN / UNTRUSTED_AUTHORITY
 *   4. signature (solid-vc, against the trusted key only)
 *   5/6. {@link checkClaimExpectations}          → STATUS_NOT_TRUSTED / FEDERATION_MISMATCH / APP_MISMATCH
 */
export declare function verifyMembershipCredential(vc: VerifiableCredential, options: VerifyMembershipOptions): Promise<MembershipVerificationResult>;
//# sourceMappingURL=verify.d.ts.map