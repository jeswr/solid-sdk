/**
 * The `@jeswr` federation-trust extension namespace — the only namespace this
 * package mints into. It homes the signed-membership credential type and the
 * `federation` pointer. Per the suite namespace rule it is a `w3id.org/jeswr`
 * IRI; it references (does not duplicate) `@jeswr/solid-federation-vocab`'s
 * `fedreg:`.
 */
export declare const FEDTRUST: "https://w3id.org/jeswr/fedtrust#";
/** Re-export the registry namespace so callers key on one source. */
export { FEDREG } from "@jeswr/federation-registry";
/**
 * `fedtrust:MembershipCredential` — the VC type of a SIGNED membership challenge:
 * a Verifiable Credential whose `credentialSubject` is a `fedreg:Membership`
 * graph, signed by the asserting authority. This is the cryptographic layer above
 * the registry's bare `fedreg:assertedBy` triple — a verifiable signature binds
 * the assertion to the authority's key, not just an asserted triple.
 */
export declare const FEDTRUST_MEMBERSHIP_CREDENTIAL: "https://w3id.org/jeswr/fedtrust#MembershipCredential";
/**
 * `fedtrust:federation` — the federation IRI a membership is FOR. A
 * `fedreg:Membership` on its own does not name the federation (the registry
 * document it lives in implies it); a *detached, signed* membership credential
 * MUST name it explicitly, else a credential minted for federation F could be
 * replayed as evidence of membership in federation G. So `federation` is a
 * required, signed claim of a `fedtrust:MembershipCredential`.
 */
export declare const FEDTRUST_FEDERATION: "https://w3id.org/jeswr/fedtrust#federation";
/** `fedreg:app` — the membership's app `client_id` IRI (reused, not minted). */
export declare const FEDREG_APP: "https://w3id.org/jeswr/fedreg#app";
/** `fedreg:status` — the membership lifecycle status IRI (reused). */
export declare const FEDREG_STATUS: "https://w3id.org/jeswr/fedreg#status";
/** `fedreg:assertedBy` — the asserting authority IRI (reused). */
export declare const FEDREG_ASSERTED_BY: "https://w3id.org/jeswr/fedreg#assertedBy";
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
export declare const FEDTRUST_CONTEXT_TERMS: Readonly<Record<string, unknown>>;
//# sourceMappingURL=vocab.d.ts.map