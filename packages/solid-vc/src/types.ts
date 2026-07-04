// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The structured TypeScript data model for the W3C Verifiable Credentials 2.0
// surface. These are plain, serialisable shapes the credential builder lowers to
// RDF (via the typed wrappers) and the parser reads back — never the RDF terms
// themselves (those stay in src/wrappers.ts / src/vocab.ts).

/** A JSON value (for arbitrary `credentialSubject` claims that round-trip as RDF). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

/**
 * A structured W3C Verifiable Credential 2.0 (the UNSIGNED claim graph — the
 * `proof` is added by {@link issue} / a {@link ProofSuite}). Fields mirror VCDM
 * 2.0; `validFrom`/`validUntil` are the 2.0 names (not 1.1's
 * `issuanceDate`/`expirationDate`).
 */
export interface Credential {
  /** The credential IRI (`@id`). Defaults to a random `urn:uuid:` if omitted. */
  readonly id?: string;
  /**
   * Credential type(s) beyond `VerifiableCredential` (always implied). E.g.
   * `["AgentAuthorizationCredential"]`. Plain type names map through the inline
   * context; absolute IRIs are kept verbatim.
   */
  readonly type?: readonly string[];
  /** The issuing party — a WebID or DID IRI (required). */
  readonly issuer: string;
  /** Issuance / validity start, ISO-8601 dateTime. Defaults to now at issue time. */
  readonly validFrom?: string;
  /** Expiry, ISO-8601 dateTime. Absent = no expiry. */
  readonly validUntil?: string;
  /** The credential subject(s) — the claims being asserted. */
  readonly credentialSubject: CredentialSubject | readonly CredentialSubject[];
  /**
   * Resources whose CONTENT the credential cryptographically binds (VCDM 2.0
   * §5.3 "Integrity of Related Resources"). Part of the SIGNED claim graph —
   * tampering an entry (id or digest) invalidates the proof. The G1
   * policy-content binding lists the ODRL policy here with its
   * `digestMultibase`; {@link verifyRelatedResources} / the
   * `presentedResources` verify option recompute + compare fail-closed.
   */
  readonly relatedResource?: readonly RelatedResource[];
  /**
   * The credential's status entry/entries (VCDM 2.0 `credentialStatus`) — how a
   * verifier discovers whether the credential has been REVOKED or SUSPENDED
   * after issuance. This package implements the W3C Bitstring Status List
   * v1.0 mechanism ({@link BitstringStatusListEntry}); part of the SIGNED claim
   * graph, so an attacker cannot strip or repoint the status entry without
   * invalidating the proof. Absent = the issuer provides NO revocation
   * mechanism (verification proceeds without a status gate); PRESENT entries
   * are checked FAIL-CLOSED by the status resolver (see
   * `resolveBitstringStatus` / the `resolveStatus` verify option).
   */
  readonly credentialStatus?: BitstringStatusListEntry | readonly BitstringStatusListEntry[];
}

/**
 * One W3C Bitstring Status List v1.0 `credentialStatus` entry: "my status is
 * bit `statusListIndex` of the list hosted by the credential at
 * `statusListCredential`, and a set bit means `statusPurpose`".
 */
export interface BitstringStatusListEntry {
  /** The entry IRI (optional — spec allows an anonymous entry node). */
  readonly id?: string;
  /** Always `"BitstringStatusListEntry"`. */
  readonly type: "BitstringStatusListEntry";
  /**
   * What a SET bit means: `"revocation"` (permanent) or `"suspension"`
   * (temporary). MUST match the hosted list's own `statusPurpose`.
   */
  readonly statusPurpose: string;
  /** The credential's bit position in the list — a string non-negative integer (per spec). */
  readonly statusListIndex: string;
  /** The URL of the `BitstringStatusListCredential` hosting the status list. */
  readonly statusListCredential: string;
}

/**
 * One VCDM 2.0 `relatedResource` entry: the resource IRI plus the cryptographic
 * digest of its content. This package emits + checks `digestMultibase` (a
 * multibase/base58btc-encoded sha2-256 MULTIHASH over the resource's RDFC-1.0
 * canonical N-Quads — see {@link digestRdfContent}); an entry WITHOUT a digest
 * binds nothing and is rejected by the verifier when its resource is presented.
 */
export interface RelatedResource {
  /** The related resource IRI (e.g. the bound ODRL policy IRI). Required. */
  readonly id: string;
  /** Multibase(base58btc) sha2-256 multihash of the resource's canonical content. */
  readonly digestMultibase?: string;
  /** The media type the digest was computed for (e.g. `text/turtle`). */
  readonly mediaType?: string;
}

/** A credential subject: an optional `id` (the subject IRI) plus arbitrary claims. */
export interface CredentialSubject {
  /** The subject IRI (`@id`). Optional — a bearer/anonymous subject has none. */
  readonly id?: string;
  /** Arbitrary RDF-mappable claims about the subject. */
  readonly [claim: string]: JsonValue | undefined;
}

/**
 * The structured agent-authorization claim — the headline M4 use case lowered to
 * a {@link Credential} of type `AgentAuthorizationCredential` by
 * {@link buildAgentAuthorizationCredential}: "principal `issuer` authorizes agent
 * `authorizes` to `action` over `target` under ODRL `policy`".
 */
export interface AgentAuthorization {
  /** The principal granting the authorization — a WebID (becomes the VC issuer). */
  readonly principal: string;
  /** The authorized agent — a WebID or `@jeswr/solid-agent-card` agent IRI. */
  readonly agent: string;
  /** The authorized action IRI(s) — an `acl:` mode or an ODRL action IRI. */
  readonly action: string | readonly string[];
  /** The resource / asset the authorization governs (optional). */
  readonly target?: string;
  /** Link to the governing `@jeswr/solid-odrl` ODRL policy graph (optional). */
  readonly policy?: string;
  /**
   * The EXACT content of the `policy` document (RDF source — Turtle by default,
   * see `policyContentType`), for the G1 policy-content binding. When present
   * (requires `policy`), {@link buildBoundAgentAuthorizationCredential} /
   * {@link issueAgentAuthorization} compute its canonical digest and emit a
   * `relatedResource` entry binding the policy CONTENT into the signed graph —
   * closing the policy-substitution hole a bare `svc:policy` IRI leaves open.
   */
  readonly policyContent?: string;
  /** Content type of `policyContent` (default `text/turtle`). */
  readonly policyContentType?: string;
  /** Credential IRI (optional — random `urn:uuid:` if omitted). */
  readonly id?: string;
  /** Validity start (optional — now at issue time). */
  readonly validFrom?: string;
  /** Expiry (optional). */
  readonly validUntil?: string;
  /**
   * The credential's revocation/suspension status entry (optional — the G2
   * issue-side param): build it with `bitstringStatusListEntry(…)` and the
   * signed credential becomes revocable via the referenced hosted status list.
   */
  readonly credentialStatus?: BitstringStatusListEntry | readonly BitstringStatusListEntry[];
}

/**
 * An embedded W3C Data Integrity proof (one `proof` node on a signed credential /
 * presentation). The `proofValue` is multibase-`z` (base58btc) encoded signature
 * octets, per Data Integrity.
 */
export interface DataIntegrityProof {
  /** Always `"DataIntegrityProof"`. */
  readonly type: "DataIntegrityProof";
  /** The named cryptosuite (e.g. `eddsa-rdfc-2022`, `ecdsa-rdfc-2019`). */
  readonly cryptosuite: string;
  /** The verification method IRI — the key id the proof is checked against. */
  readonly verificationMethod: string;
  /** Why the proof was created (default `assertionMethod`). */
  readonly proofPurpose: string;
  /** When the proof was created (ISO-8601 dateTime). */
  readonly created?: string;
  /** The multibase-encoded signature octets. */
  readonly proofValue: string;
}

/** A verifiable (signed) credential = a {@link Credential} with one or more proofs. */
export interface VerifiableCredential extends Credential {
  /** One proof, or an array of proofs (a credential may carry several). */
  readonly proof: DataIntegrityProof | readonly DataIntegrityProof[];
}

/** A W3C Verifiable Presentation 2.0 (the unsigned form). */
export interface Presentation {
  /** The presentation IRI (`@id`). Optional. */
  readonly id?: string;
  /** Presentation type(s) beyond `VerifiablePresentation`. */
  readonly type?: readonly string[];
  /** The presenting party — a WebID/DID (optional for a holder-less presentation). */
  readonly holder?: string;
  /** The credentials being presented. */
  readonly verifiableCredential: readonly VerifiableCredential[];
}

/** A verifiable (signed) presentation = a {@link Presentation} with proof(s). */
export interface VerifiablePresentation extends Presentation {
  readonly proof: DataIntegrityProof | readonly DataIntegrityProof[];
}

/**
 * A verification key pair (a `verificationMethod` IRI bound to a key). The key
 * material is a WebCrypto `CryptoKey` — the only key type the concrete suite signs
 * with (jose-generated / JWK-imported). A pluggable suite may use a different key
 * model; this is the shape the bundled Data Integrity suites expect.
 */
export interface KeyPair {
  /** The verification method IRI (becomes `proof.verificationMethod`). */
  readonly verificationMethod: string;
  /** The private signing key (WebCrypto). */
  readonly privateKey: CryptoKey;
  /** The public verification key (WebCrypto). */
  readonly publicKey: CryptoKey;
}

/**
 * The result of a verification. `verified` is the single source of truth; on
 * failure `errors` lists every distinct reason (signature, expiry,
 * issuer-binding, structural) so a caller can act on the specific failure — a
 * security surface must never collapse all failures into a generic "false".
 */
export interface VerificationResult {
  /** `true` IFF every proof verified AND every validity/binding check passed. */
  readonly verified: boolean;
  /** Distinct failure reasons (empty IFF `verified`). */
  readonly errors: readonly VerificationError[];
  /** The verified issuer IRI (when a single issuer was bound), for convenience. */
  readonly issuer?: string;
}

/** A structured, machine-actionable verification failure. */
export interface VerificationError {
  /** The failure category (so a caller can branch on it). */
  readonly code: VerificationErrorCode;
  /** A human-readable explanation. */
  readonly message: string;
}

/** The closed set of verification failure categories. */
export type VerificationErrorCode =
  | "MALFORMED" // the document is not a well-formed VC/VP
  | "NO_PROOF" // no proof present
  | "UNKNOWN_CRYPTOSUITE" // no registered suite for proof.cryptosuite
  | "INVALID_SIGNATURE" // the signature did not verify over the canonical bytes
  | "EXPIRED" // validUntil is in the past
  | "NOT_YET_VALID" // validFrom is in the future
  | "ISSUER_MISMATCH" // proof.verificationMethod is not controlled by the issuer
  | "PROOF_PURPOSE_MISMATCH" // proof.proofPurpose is not the expected purpose
  | "UNTRUSTED_ISSUER" // the issuer is not in the caller's trusted set
  | "RELATED_RESOURCE_MISSING" // a presented resource has no signed digest to check against
  | "RELATED_RESOURCE_MISMATCH" // a presented resource's recomputed digest != the signed digest
  | "STATUS_REVOKED" // the status list bit is SET for purpose "revocation"
  | "STATUS_SUSPENDED" // the status list bit is SET for purpose "suspension"
  | "STATUS_UNREACHABLE"; // a PRESENT status entry could not be fetched/verified/decoded — fail-closed

/**
 * The outcome of resolving a credential's status (the Phase-C seam):
 *
 *  - `absent` — the credential carries NO `credentialStatus`: the issuer
 *    provides no revocation mechanism, so verification PROCEEDS (this is the
 *    one non-failure "nothing to check" outcome);
 *  - `valid` — every status entry resolved and every bit is CLEAR;
 *  - `revoked` / `suspended` — a bit is SET for that purpose (definitive);
 *  - `unreachable` — a PRESENT entry could not be confirmed (fetch failed,
 *    the list credential's own signature/shape/purpose was invalid, the
 *    bitstring would not decode, the index was out of range, …). FAIL-CLOSED:
 *    a credential whose status cannot be confirmed must NOT verify as valid —
 *    `unreachable` is a distinct verification FAILURE, never a silent pass.
 */
export type CredentialStatusCheck =
  | { readonly status: "absent" }
  | { readonly status: "valid" }
  | { readonly status: "revoked"; readonly reason: string }
  | { readonly status: "suspended"; readonly reason: string }
  | { readonly status: "unreachable"; readonly reason: string };

/**
 * The PRESENTED content of a related resource (the policy document the verifier
 * was actually handed), keyed by resource IRI in the `presentedResources`
 * verify option. The digest is recomputed over THIS content's canonical form
 * and compared fail-closed against the credential's signed `digestMultibase`.
 */
export interface PresentedResourceContent {
  /** The resource content as RDF source text. */
  readonly content: string;
  /** Content type of `content` (default `text/turtle`). */
  readonly contentType?: string;
}

/** Options shared by the verification entrypoints. */
export interface VerifyOptions {
  /** The instant to evaluate validity against (default `new Date()`). Injectable for tests. */
  readonly now?: Date;
  /**
   * If set, the issuer IRI MUST be in this allowlist or verification fails with
   * `UNTRUSTED_ISSUER` — the trusted-issuer model PSS's verifier also uses. When
   * omitted, issuer trust is the caller's concern (signature is still checked).
   */
  readonly trustedIssuers?: readonly string[];
  /** The expected `proofPurpose` (default `assertionMethod`). */
  readonly expectedProofPurpose?: string;
}

/** Options for issuing/signing. */
export interface IssueOptions {
  /** Override the proof's `created` timestamp (default now). Injectable for tests. */
  readonly created?: Date;
  /** The `proofPurpose` (default `assertionMethod`). */
  readonly proofPurpose?: string;
}
