import { type VerifiableCredential } from "@jeswr/solid-vc";
import type { MembershipVerificationResult, VerifyMembershipOptions } from "./types.js";
/**
 * VERIFY a signed membership credential against the verifier's trust anchors and
 * expectations. Returns a {@link MembershipVerificationResult} whose `verified` is
 * `true` IFF every gate passed; on failure `errors` lists every distinct reason.
 * Never throws on an invalid credential.
 */
export declare function verifyMembershipCredential(vc: VerifiableCredential, options: VerifyMembershipOptions): Promise<MembershipVerificationResult>;
//# sourceMappingURL=verify.d.ts.map