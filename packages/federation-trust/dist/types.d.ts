import type { MembershipStatusName } from "@jeswr/federation-registry";
import type { KeyPair, VerifiableCredential } from "@jeswr/solid-vc";
export type { KeyPair, MembershipStatusName, VerifiableCredential };
/**
 * The membership a signed credential ASSERTS — "app X is a member of federation F
 * with lifecycle status S, asserted by authority A". This is the same shape a
 * `fedreg:Membership` carries (app / status / assertedBy), PLUS the explicit
 * `federation` IRI a detached, signed credential must name (so it cannot be
 * replayed against another federation — see {@link MembershipClaim.federation}).
 */
export interface MembershipClaim {
    /**
     * The federation this membership is FOR — a required, signed claim. A
     * `fedreg:Membership` inside a registry document implies its federation from
     * the document; a *detached* signed credential MUST state it, else a credential
     * minted for federation F could be presented as evidence of membership in
     * federation G.
     */
    readonly federation: string;
    /** The app this membership concerns — its `client_id` IRI (`fedreg:app`). */
    readonly app: string;
    /** The lifecycle status short name (`fedreg:status`). */
    readonly status: MembershipStatusName;
    /**
     * The authority asserting (and signing) this membership — a WebID / key IRI.
     * This is the credential ISSUER: the signature binds the assertion to this
     * authority's key, which is precisely what makes the credential stronger than a
     * bare `fedreg:assertedBy` triple.
     */
    readonly assertedBy: string;
    /** The membership record's IRI (`@id`). A random `urn:uuid:` if omitted. */
    readonly id?: string;
    /** Validity start, ISO-8601 dateTime (defaults to now at issue time). */
    readonly validFrom?: string;
    /** Expiry, ISO-8601 dateTime. Absent = no expiry. */
    readonly validUntil?: string;
}
/**
 * Inputs to {@link issueMembershipCredential}. The signing key is a
 * `@jeswr/solid-vc` {@link KeyPair} (the authority's asymmetric key); its
 * `verificationMethod` IRI MUST be controlled by `claim.assertedBy` (the issuer) —
 * the standard VC issuer-binding rule, enforced again at verify time.
 */
export interface IssueMembershipInput {
    /** The membership to assert + sign. */
    readonly claim: MembershipClaim;
    /** The asserting authority's signing key (a solid-vc {@link KeyPair}). */
    readonly key: KeyPair;
    /** Override the proof `created` timestamp (default now). Injectable for tests. */
    readonly created?: Date;
}
/**
 * A trust anchor: an authority IRI (the credential issuer) paired with the public
 * key its `verificationMethod` resolves to. Verification keys against the anchors:
 * a credential whose issuer is not an anchor (and not reachable by a delegation
 * chain to one) fails closed. The public key is a WebCrypto `CryptoKey` (the
 * bundled solid-vc suite's key model) so no key resolution is left to the network
 * by default — a caller supplies exactly the keys it trusts.
 */
export interface TrustAnchor {
    /** The authority IRI (must equal the credential `issuer`). */
    readonly authority: string;
    /**
     * The `verificationMethod` IRI the authority's proofs are signed with (defaults
     * to {@link TrustAnchor.authority} when the authority signs with its own IRI as
     * the key id). Used to match `proof.verificationMethod`.
     */
    readonly verificationMethod?: string;
    /** The public verification key (WebCrypto), used to check the signature. */
    readonly publicKey: CryptoKey;
}
/**
 * One link in a DELEGATION CHAIN: a signed authorization in which `delegator`
 * (whose key signs this link) authorizes `authority` to assert federation
 * memberships. The chain lets a sub-authority's membership credential be trusted
 * because a *root* trust anchor delegated to it. Each link is itself a signed VC
 * (a `fedtrust:DelegationCredential`), so the whole chain is cryptographically
 * verifiable end-to-end; a single broken/expired/wrong-key link fails the chain
 * closed.
 */
export interface DelegationLink {
    /** The signed delegation credential (delegator → authority). */
    readonly credential: VerifiableCredential;
    /** The public key + verificationMethod for the DELEGATOR (the link's signer). */
    readonly delegatorKey: KeyResolution;
}
/** A resolved verification key for one authority/method. */
export interface KeyResolution {
    /** The `verificationMethod` IRI this key answers to. */
    readonly verificationMethod: string;
    /** The public verification key (WebCrypto). */
    readonly publicKey: CryptoKey;
}
/** Options for {@link verifyMembershipCredential}. */
export interface VerifyMembershipOptions {
    /**
     * The trust anchors — the root authorities (issuer IRI → public key) the
     * verifier accepts directly. A credential issued by an anchor verifies against
     * that anchor's key. REQUIRED and non-empty: a verifier with no trust anchors
     * trusts nobody and every credential fails closed (`NO_TRUST_ANCHOR`).
     */
    readonly trustAnchors: readonly TrustAnchor[];
    /**
     * The federation the verifier expects the membership to be FOR. When set, a
     * credential whose `federation` claim differs fails with
     * `FEDERATION_MISMATCH` (anti-replay across federations). Strongly recommended.
     */
    readonly expectedFederation?: string;
    /**
     * The app the verifier expects the membership to concern. When set, a
     * credential for a different app fails with `APP_MISMATCH`.
     */
    readonly expectedApp?: string;
    /**
     * The membership statuses the verifier treats as a live membership. Defaults to
     * `["Active"]` (the registry's `TRUSTED_STATUS`). A `Proposed` / `Suspended` /
     * `Revoked` credential fails with `STATUS_NOT_TRUSTED` unless its status is in
     * this set.
     */
    readonly acceptStatuses?: readonly MembershipStatusName[];
    /**
     * An OPTIONAL delegation chain from a trust anchor down to the credential's
     * issuer. Each link delegates from `delegator` to the next link's `delegate`;
     * the first link's `delegator` must be a trust anchor and the final link's
     * `delegate` must be the credential issuer. When the issuer is itself a trust
     * anchor, no chain is needed. A broken / wrong-key / expired / out-of-order /
     * mis-scoped chain fails closed (`BROKEN_CHAIN`).
     */
    readonly chain?: readonly DelegationLink[];
    /**
     * The membership ISSUER's own public verification key — REQUIRED when trust is
     * established via a delegation {@link VerifyMembershipOptions.chain} (the chain
     * proves the anchor authorized the issuer, but the issuer signs the membership
     * with its OWN key, which the verifier must hold to check the membership
     * signature). When the issuer is a direct trust anchor this is ignored (the
     * anchor's own key is used). Supplying a key here NEVER bypasses the chain: the
     * chain must still prove authorization before this key is trusted.
     */
    readonly issuerKey?: KeyResolution;
    /** The instant to evaluate validity against (default `new Date()`). Injectable for tests. */
    readonly now?: Date;
}
/** Inputs to {@link issueDelegation}: delegator authorizes a sub-authority. */
export interface IssueDelegationInput {
    /** The delegating authority IRI (the issuer of this link; signs with `key`). */
    readonly delegator: string;
    /** The authority being authorized to assert memberships (the delegate). */
    readonly authority: string;
    /** The federation the delegation is scoped to (signed; checked on chain walk). */
    readonly federation: string;
    /** The delegator's signing key (a solid-vc {@link KeyPair}). */
    readonly key: KeyPair;
    /** Validity start (default now at issue). */
    readonly validFrom?: string;
    /** Expiry (optional). */
    readonly validUntil?: string;
    /** Credential IRI (random `urn:uuid:` if omitted). */
    readonly id?: string;
    /** Override the proof `created` timestamp (default now). */
    readonly created?: Date;
}
/** The closed set of federation-trust verification failure categories. */
export type TrustErrorCode = "MALFORMED" | "NO_PROOF" | "UNKNOWN_CRYPTOSUITE" | "INVALID_SIGNATURE" | "EXPIRED" | "NOT_YET_VALID" | "ISSUER_MISMATCH" | "PROOF_PURPOSE_MISMATCH" | "NO_TRUST_ANCHOR" | "UNTRUSTED_AUTHORITY" | "MISSING_CLAIM" | "ASSERTED_BY_MISMATCH" | "FEDERATION_MISMATCH" | "APP_MISMATCH" | "STATUS_NOT_TRUSTED" | "UNKNOWN_STATUS" | "BROKEN_CHAIN";
/** A structured, machine-actionable verification failure. */
export interface TrustError {
    /** The failure category (so a caller can branch on it). */
    readonly code: TrustErrorCode;
    /** A human-readable explanation. */
    readonly message: string;
}
/**
 * The result of verifying a signed membership credential. `verified` is the single
 * source of truth; on failure `errors` lists EVERY distinct reason (a security
 * surface must never collapse all failures into a generic "false").
 */
export interface MembershipVerificationResult {
    /** `true` IFF every gate passed. */
    readonly verified: boolean;
    /** Distinct failure reasons (empty IFF `verified`). */
    readonly errors: readonly TrustError[];
    /** The verified membership claim, when one was parsed (even if a gate failed). */
    readonly claim?: MembershipClaim;
}
//# sourceMappingURL=types.d.ts.map