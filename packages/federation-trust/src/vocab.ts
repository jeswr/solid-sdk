// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs + constants for the federation TRUST layer — the signed membership
// challenge that sits ABOVE the registry's `fedreg:assertedBy`. A signed
// membership credential is a W3C Verifiable Credential 2.0 whose claim graph IS a
// `fedreg:Membership`: the authority signs "app X is a member of federation F with
// status S, asserted by A". So this layer mints almost NOTHING — it reuses:
//
//   - the W3C VC 2.0 + Data Integrity vocab, via `@jeswr/solid-vc` (the proof and
//     credential machinery — `cred:`, `sec:`);
//   - the federation registry vocab `fedreg:` (`fedreg:app`, `fedreg:status`,
//     `fedreg:assertedBy`, the four `MembershipStatus` values), via
//     `@jeswr/federation-registry` — the SAME terms a `fedreg:Membership` already
//     uses, so a signed credential's subject is a *bona fide* `fedreg:Membership`
//     graph, not a parallel re-modelling of it (LD/SW reuse rule).
//
// The ONLY minted terms are the credential TYPE and the federation pointer, homed
// under the `@jeswr` federation-trust extension namespace (NEVER `@solid/`), which
// resolves under the `w3id.org/jeswr` vocab home `@jeswr/solid-federation-vocab`
// owns. They reference (do not duplicate) `fedreg:`.

import { FEDREG } from "@jeswr/federation-registry";

/**
 * The `@jeswr` federation-trust extension namespace — the only namespace this
 * package mints into. It homes the signed-membership credential type and the
 * `federation` pointer. Per the suite namespace rule it is a `w3id.org/jeswr`
 * IRI; it references (does not duplicate) `@jeswr/solid-federation-vocab`'s
 * `fedreg:`.
 */
export const FEDTRUST = "https://w3id.org/jeswr/fedtrust#" as const;

/** Re-export the registry namespace so callers key on one source. */
export { FEDREG } from "@jeswr/federation-registry";

/**
 * `fedtrust:MembershipCredential` — the VC type of a SIGNED membership challenge:
 * a Verifiable Credential whose `credentialSubject` is a `fedreg:Membership`
 * graph, signed by the asserting authority. This is the cryptographic layer above
 * the registry's bare `fedreg:assertedBy` triple — a verifiable signature binds
 * the assertion to the authority's key, not just an asserted triple.
 */
export const FEDTRUST_MEMBERSHIP_CREDENTIAL = `${FEDTRUST}MembershipCredential` as const;

/**
 * `fedtrust:federation` — the federation IRI a membership is FOR. A
 * `fedreg:Membership` on its own does not name the federation (the registry
 * document it lives in implies it); a *detached, signed* membership credential
 * MUST name it explicitly, else a credential minted for federation F could be
 * replayed as evidence of membership in federation G. So `federation` is a
 * required, signed claim of a `fedtrust:MembershipCredential`.
 */
export const FEDTRUST_FEDERATION = `${FEDTRUST}federation` as const;

/** `fedreg:app` — the membership's app `client_id` IRI (reused, not minted). */
export const FEDREG_APP = `${FEDREG}app` as const;
/** `fedreg:status` — the membership lifecycle status IRI (reused). */
export const FEDREG_STATUS = `${FEDREG}status` as const;
/** `fedreg:assertedBy` — the asserting authority IRI (reused). */
export const FEDREG_ASSERTED_BY = `${FEDREG}assertedBy` as const;

/**
 * The pinned inline JSON-LD `@context` for a `fedtrust:MembershipCredential`
 * document. It layers the standard VC 2.0 + Data Integrity contexts (emitted by
 * `@jeswr/solid-vc`) with the federation-trust + `fedreg:` terms, so the JSON-LD
 * expands to the SAME RDF as the Turtle and remains valid VC 2.0 for tooling.
 *
 * NOTE this context is documentary — `@jeswr/solid-vc` owns the actual
 * serialisation and pins its own VC 2.0 context; this records the additional term
 * mappings a federation-trust credential introduces.
 */
export const FEDTRUST_CONTEXT_TERMS: Readonly<Record<string, unknown>> = {
  fedtrust: FEDTRUST,
  fedreg: FEDREG,
  MembershipCredential: FEDTRUST_MEMBERSHIP_CREDENTIAL,
  federation: { "@id": FEDTRUST_FEDERATION, "@type": "@id" },
  app: { "@id": FEDREG_APP, "@type": "@id" },
  status: { "@id": FEDREG_STATUS, "@type": "@id" },
  assertedBy: { "@id": FEDREG_ASSERTED_BY, "@type": "@id" },
};
