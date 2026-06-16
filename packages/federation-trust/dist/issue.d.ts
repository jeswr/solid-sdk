import { type Credential, type VerifiableCredential } from "@jeswr/solid-vc";
import type { IssueDelegationInput, IssueMembershipInput } from "./types.js";
/**
 * Build the UNSIGNED membership credential (the claim graph). Exposed so a caller
 * can inspect / serialise the claim graph before signing, or sign it with a
 * pluggable proof suite via `@jeswr/solid-vc`'s {@link issue} directly.
 *
 * The subject `id` is the membership record IRI (the thing the credential is
 * ABOUT); its claims are the `fedreg:` membership facts + the federation pointer.
 * The issuer is the asserting authority.
 */
export declare function buildMembershipCredential(input: IssueMembershipInput): Credential;
/**
 * ISSUE (sign) a membership credential. An authority A signs the membership claim
 * with its asymmetric key; the resulting {@link VerifiableCredential} is a
 * `fedtrust:MembershipCredential` whose Data Integrity proof binds the membership
 * to A's key. Verify it with {@link verifyMembershipCredential}.
 *
 * The signing key's `verificationMethod` SHOULD be controlled by `claim.assertedBy`
 * (the issuer) — `verifyMembershipCredential` re-checks this issuer binding and
 * fails closed if not.
 */
export declare function issueMembershipCredential(input: IssueMembershipInput): Promise<VerifiableCredential>;
/**
 * ISSUE (sign) a DELEGATION credential — one link in a trust chain. `delegator`
 * (signing with `key`) authorizes `authority` to assert federation memberships for
 * `federation`. A chain of these links lets a sub-authority's membership credential
 * be trusted because a root trust anchor delegated (transitively) to it.
 *
 * The subject is the delegated authority; the issuer is the delegator. The
 * `verificationMethod` must be controlled by `delegator`.
 */
export declare function issueDelegation(input: IssueDelegationInput): Promise<VerifiableCredential>;
//# sourceMappingURL=issue.d.ts.map