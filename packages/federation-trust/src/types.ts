// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public domain types for the federation TRUST layer: the plain-object views the
// issue/verify surface exchanges. The RDF + crypto themselves go through
// `@jeswr/solid-vc` (VC data model + Data Integrity proof) and the `fedreg:` terms
// from `@jeswr/federation-registry` — these are this package's ergonomic surface,
// never the RDF terms directly.

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
  /**
   * The signed delegation credential (delegator → delegate). It carries, as a
   * SIGNED claim, the delegate's public key (`fedtrust:delegateKey`, a JWK) — so
   * the chain is SELF-CERTIFYING: link[i+1]'s signature is verified with the key
   * that link[i] signed over, never with a caller-supplied key. The verifier holds
   * only the trust-anchor's pinned key; every other key in the chain is proven by
   * the link above it.
   */
  readonly credential: VerifiableCredential;
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
   * the FIRST link's `delegator` must be a trust anchor (its signature is verified
   * with the ANCHOR'S PINNED key — never a caller-supplied one) and the final
   * link's `delegate` must be the credential issuer. Each link carries the
   * delegate's public key as a signed claim, so the chain is self-certifying: a
   * presenter cannot forge a link by supplying their own key. The leaf's signed
   * delegate key is the issuer's key, which then verifies the membership — so NO
   * separate issuer key is needed. When the issuer is itself a trust anchor, no
   * chain is needed. A broken / forged / wrong-key / expired / out-of-order /
   * mis-scoped chain fails closed (`BROKEN_CHAIN`).
   */
  readonly chain?: readonly DelegationLink[];
  /** The instant to evaluate validity against (default `new Date()`). Injectable for tests. */
  readonly now?: Date;
}

/** Inputs to {@link issueDelegation}: delegator authorizes a sub-authority. */
export interface IssueDelegationInput {
  /** The delegating authority IRI (the issuer of this link; signs with `key`). */
  readonly delegator: string;
  /** The authority being authorized to assert memberships (the delegate). */
  readonly authority: string;
  /**
   * The delegate's PUBLIC key — embedded as a SIGNED `fedtrust:delegateKey` claim
   * (a JWK) so the chain is self-certifying: a verifier checks the NEXT link (or
   * the membership) with this key, which the delegator signed over. WebCrypto
   * `CryptoKey` (it is exported to a public JWK). Pass the delegate's
   * {@link KeyResolution} public key, NOT its private key.
   */
  readonly delegateKey: CryptoKey;
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
export type TrustErrorCode =
  // --- relayed from the underlying VC verification (signature / structure) ---
  | "MALFORMED" // not a well-formed VC / not a MembershipCredential
  | "NO_PROOF" // no proof present
  | "UNKNOWN_CRYPTOSUITE" // no registered suite for proof.cryptosuite
  | "INVALID_SIGNATURE" // signature did not verify over the canonical bytes
  | "EXPIRED" // validUntil is in the past
  | "NOT_YET_VALID" // validFrom is in the future
  | "ISSUER_MISMATCH" // proof.verificationMethod is not controlled by the issuer
  | "PROOF_PURPOSE_MISMATCH" // proofPurpose is not assertionMethod
  // --- federation-trust-specific gates ---
  | "NO_TRUST_ANCHOR" // no trust anchors supplied (verifier trusts nobody)
  | "UNTRUSTED_AUTHORITY" // issuer is neither an anchor nor chained to one
  | "MISSING_CLAIM" // a required membership claim (app/status/federation/assertedBy) is absent
  | "ASSERTED_BY_MISMATCH" // the signed assertedBy != the credential issuer
  | "FEDERATION_MISMATCH" // the membership is for a different federation than expected
  | "APP_MISMATCH" // the membership concerns a different app than expected
  | "STATUS_NOT_TRUSTED" // the membership status is not in the accepted set (e.g. Revoked)
  | "UNKNOWN_STATUS" // the status IRI is not a recognised fedreg MembershipStatus
  | "BROKEN_CHAIN"; // the delegation chain is broken / wrong-key / out-of-order / mis-scoped

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
