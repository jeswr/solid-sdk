// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ISSUE a signed membership credential — the authority's path. An authority A
// signs "app X is a member of federation F with status S, asserted by A" as a W3C
// Verifiable Credential 2.0 of type `fedtrust:MembershipCredential`. The signature
// is produced by `@jeswr/solid-vc`'s Data Integrity proof suite (EdDSA / ECDSA over
// RDFC-1.0) over the credential's canonical claim graph — so any later tamper to
// the app, federation, status, assertedBy, validity window, or issuer invalidates
// the signature. We mint NO crypto here: the keypair, the proof and the
// canonicalisation are all solid-vc's.
//
// The credential SUBJECT is the membership record (its `id`), whose claims are the
// `fedreg:` membership facts (app / status / assertedBy) reused verbatim from
// `@jeswr/federation-registry`, PLUS the explicit `fedtrust:federation` IRI. The
// ISSUER is the asserting authority — so `proof.verificationMethod` must be
// controlled by `assertedBy`, the standard VC issuer-binding rule.

import { MEMBERSHIP_STATUS, type MembershipStatusName } from "@jeswr/federation-registry";
import {
  type Credential,
  type CredentialSubject,
  DataIntegritySuite,
  issue,
  type KeyPair,
  type ProofSuite,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { exportJWK } from "jose";
import type { IssueDelegationInput, IssueMembershipInput } from "./types.js";
import {
  FEDREG_APP,
  FEDREG_ASSERTED_BY,
  FEDREG_STATUS,
  FEDTRUST_DELEGATE,
  FEDTRUST_DELEGATE_KEY,
  FEDTRUST_DELEGATION_CREDENTIAL,
  FEDTRUST_FEDERATION,
  FEDTRUST_MEMBERSHIP_CREDENTIAL,
} from "./vocab.js";

/**
 * Pick the Data Integrity proof suite matching a {@link KeyPair}'s algorithm so we
 * sign Ed25519 keys with `eddsa-rdfc-2022` and P-256 keys with `ecdsa-rdfc-2019`.
 * solid-vc's `issue()` defaults to the EdDSA suite, which cannot sign a P-256 key —
 * so we MUST select the suite from the key, not rely on the default. A key whose
 * algorithm is neither falls back to the EdDSA suite (solid-vc then raises a clear
 * sign error rather than silently mis-signing).
 */
function suiteForKey(key: KeyPair): ProofSuite {
  const alg = key.privateKey?.algorithm;
  const name =
    typeof alg === "object" && alg !== null ? (alg as { name?: string }).name : undefined;
  if (name === "ECDSA") {
    return new DataIntegritySuite("ecdsa-rdfc-2019");
  }
  // Ed25519 (and anything else) → the EdDSA suite (the suite default).
  return new DataIntegritySuite("eddsa-rdfc-2022");
}

/** Resolve a status short name to its `fedreg:` status IRI (fail closed on bad name). */
function statusIri(status: MembershipStatusName): string {
  const iri = MEMBERSHIP_STATUS[status];
  if (iri === undefined) {
    // A caller passing a status outside the typed union is a programming error;
    // refuse to mint a credential with an unknown/absent status (it would never
    // verify and would be a silently-broken assertion).
    throw new Error(`issueMembershipCredential: unknown membership status "${status}"`);
  }
  return iri;
}

/**
 * Build the UNSIGNED membership credential (the claim graph). Exposed so a caller
 * can inspect / serialise the claim graph before signing, or sign it with a
 * pluggable proof suite via `@jeswr/solid-vc`'s {@link issue} directly.
 *
 * The subject `id` is the membership record IRI (the thing the credential is
 * ABOUT); its claims are the `fedreg:` membership facts + the federation pointer.
 * The issuer is the asserting authority.
 */
export function buildMembershipCredential(input: IssueMembershipInput): Credential {
  const { claim } = input;
  // The subject node is the membership record. Its `id` is the membership IRI; the
  // `assertedBy` claim is NOT written into the subject (it is the issuer — writing
  // it twice risks divergence) — instead `assertedBy` IS the issuer, and we ALSO
  // record it as an explicit signed claim so a reader sees the authority without
  // having to know the VC issuer convention.
  const subject: CredentialSubject = {
    id: claim.app, // the membership is ABOUT the app (its client_id)
    [FEDTRUST_FEDERATION]: claim.federation,
    [FEDREG_STATUS]: statusIri(claim.status),
    [FEDREG_ASSERTED_BY]: claim.assertedBy,
    // Echo the app as an explicit fedreg:app claim too, so the membership graph is
    // a bona fide fedreg:Membership-shaped subject (app is both the subject id and
    // an explicit fedreg:app value, matching the registry's record shape).
    [FEDREG_APP]: claim.app,
  };
  const credential: Credential = {
    issuer: claim.assertedBy,
    type: ["MembershipCredential"],
    credentialSubject: subject,
    ...(claim.id !== undefined ? { id: claim.id } : {}),
    ...(claim.validFrom !== undefined ? { validFrom: claim.validFrom } : {}),
    ...(claim.validUntil !== undefined ? { validUntil: claim.validUntil } : {}),
  };
  return credential;
}

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
export async function issueMembershipCredential(
  input: IssueMembershipInput,
): Promise<VerifiableCredential> {
  // Map the FEDTRUST credential type to its absolute IRI by passing it as an
  // absolute IRI in `type` so solid-vc keeps it verbatim (its bare-name homing
  // would route an unqualified `MembershipCredential` under the solid-vc namespace,
  // not fedtrust — so we qualify it explicitly).
  const credential = buildMembershipCredential(input);
  const qualified: Credential = {
    ...credential,
    type: [FEDTRUST_MEMBERSHIP_CREDENTIAL],
  };
  return issue({
    credential: qualified,
    key: input.key,
    suite: suiteForKey(input.key),
    ...(input.created !== undefined ? { options: { created: input.created } } : {}),
  });
}

/**
 * ISSUE (sign) a DELEGATION credential — one link in a trust chain. `delegator`
 * (signing with `key`) authorizes `authority` to assert federation memberships for
 * `federation`. A chain of these links lets a sub-authority's membership credential
 * be trusted because a root trust anchor delegated (transitively) to it.
 *
 * The subject is the delegated authority; the issuer is the delegator. The
 * `verificationMethod` must be controlled by `delegator`.
 */
export async function issueDelegation(input: IssueDelegationInput): Promise<VerifiableCredential> {
  // Embed the delegate's PUBLIC key as a signed JWK string so the chain is
  // self-certifying (a verifier checks the next link / the membership with this
  // key — the delegator's signature covers it, so it cannot be swapped). We export
  // the WebCrypto public key to a JWK via jose (never hand-encode a key).
  const delegateJwk = JSON.stringify(await exportJWK(input.delegateKey));
  const subject: CredentialSubject = {
    id: input.authority,
    [FEDTRUST_DELEGATE]: input.authority,
    [FEDTRUST_FEDERATION]: input.federation,
    // A plain string literal (not an IRI) so the parser reads it back as the JWK.
    [FEDTRUST_DELEGATE_KEY]: delegateJwk,
  };
  const credential: Credential = {
    issuer: input.delegator,
    type: [FEDTRUST_DELEGATION_CREDENTIAL],
    credentialSubject: subject,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
  };
  return issue({
    credential,
    key: input.key,
    suite: suiteForKey(input.key),
    ...(input.created !== undefined ? { options: { created: input.created } } : {}),
  });
}
