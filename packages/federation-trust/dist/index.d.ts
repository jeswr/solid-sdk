/**
 * `@jeswr/federation-trust` — the cryptographic TRUST layer above the Solid
 * Federation registry's `fedreg:assertedBy`.
 *
 * `@jeswr/federation-registry` is deliberately the *discovery* axis: a
 * `fedreg:Membership` is a registry-ASSERTED membership (it names a
 * `fedreg:assertedBy` authority) but carries NO signature — `verifyMembership()`
 * there checks only that a record is well-formed, never that the assertion is
 * cryptographically bound to the authority. That binding is THIS package: a
 * **signed membership challenge** — a W3C Verifiable Credential 2.0 in which an
 * authority A signs "app X is a member of federation F with status S, asserted by
 * A". A consumer can now trust a membership because a *verifiable signature* binds
 * it to A's key, not because a triple says so.
 *
 * It composes — does not duplicate:
 *
 * - `@jeswr/solid-vc` supplies the credential data model + the Data Integrity
 *   proof suite (EdDSA / ECDSA over RDFC-1.0 via `jose`/WebCrypto) + the
 *   fail-closed verify pipeline. The membership credential IS a solid-vc
 *   {@link VerifiableCredential}, so it shares the agentic proof-suite seam — a
 *   BBS / JWT / SPARQ-ZK proof plugs in there, NOT here.
 * - `@jeswr/federation-registry` supplies the `fedreg:` membership vocabulary
 *   (`fedreg:app` / `fedreg:status` / `fedreg:assertedBy`, the four
 *   `MembershipStatus` values, `statusName`, `TRUSTED_STATUS`). The signed
 *   credential's subject is a bona fide `fedreg:Membership` graph.
 *
 * The ONLY minted term is the `fedtrust:MembershipCredential` type (+ the
 * `fedtrust:federation` pointer and a `fedtrust:DelegationCredential` for chains),
 * homed under `https://w3id.org/jeswr/fedtrust#`.
 *
 * Two surfaces:
 * - {@link issueMembershipCredential} — an authority signs a membership claim.
 * - {@link verifyMembershipCredential} — given the credential + the verifier's
 *   trust anchors (and optionally a delegation chain), verify FAIL-CLOSED:
 *   signature, expiry, issuer-binding, `assertedBy == issuer`, status ∈ accepted,
 *   expected federation/app, and the chain to a trusted anchor. A tampered graph,
 *   a wrong key, an expiry, a revoked status, or a broken chain all reject.
 *
 * CLIENT-SIDE only — zero prod-solid-server core risk. Server-side ENFORCEMENT of
 * membership (e.g. a resource server gating writes on a verified membership) is a
 * CORE-PSS decision flagged for maintainer approval, NOT built here.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */
export { MEMBERSHIP_STATUS, statusName, TRUSTED_STATUS } from "@jeswr/federation-registry";
export { cryptosuiteForKeyType, exportPublicJwk, generateKeyPairForSuite, importKeyPair, importPublicKey, type SuiteKeyType, } from "@jeswr/solid-vc";
export { buildMembershipCredential, issueDelegation, issueMembershipCredential, } from "./issue.js";
export type { DelegationLink, IssueDelegationInput, IssueMembershipInput, KeyPair, KeyResolution, MembershipClaim, MembershipStatusName, MembershipVerificationResult, TrustAnchor, TrustError, TrustErrorCode, VerifiableCredential, VerifyMembershipOptions, } from "./types.js";
export { verifyMembershipCredential } from "./verify.js";
export { FEDREG, FEDREG_APP, FEDREG_ASSERTED_BY, FEDREG_STATUS, FEDTRUST, FEDTRUST_CONTEXT_TERMS, FEDTRUST_DELEGATE, FEDTRUST_DELEGATE_KEY, FEDTRUST_DELEGATION_CREDENTIAL, FEDTRUST_FEDERATION, FEDTRUST_MEMBERSHIP_CREDENTIAL, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map