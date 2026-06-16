/**
 * The canonical W3C VC term namespace (the IRI the `credentials/v2` `@context`
 * expands core VC terms to). VCDM 2.0 keeps `https://www.w3.org/2018/credentials#`
 * for `VerifiableCredential`, `issuer`, `credentialSubject`, etc.
 */
export declare const VC: "https://www.w3.org/2018/credentials#";
/** The VC 2.0 JSON-LD context IRI (the `@context` every VC 2.0 document carries). */
export declare const VC_V2_CONTEXT: "https://www.w3.org/ns/credentials/v2";
/** W3C Data Integrity 1.0 / Security vocabulary namespace (proofs, cryptosuites). */
export declare const SEC: "https://w3id.org/security#";
/** The W3C Data Integrity v2 JSON-LD context IRI (proof terms). */
export declare const DI_V2_CONTEXT: "https://w3id.org/security/data-integrity/v2";
/** XSD namespace (typed literal datatypes — `dateTime` for issuance/expiry). */
export declare const XSD: "http://www.w3.org/2001/XMLSchema#";
/** RDF namespace. */
export declare const RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDFS namespace. */
export declare const RDFS: "http://www.w3.org/2000/01/rdf-schema#";
/** ACL / WAC namespace — the Solid grant modes an authorization action maps onto. */
export declare const ACL: "http://www.w3.org/ns/auth/acl#";
/** Canonical W3C ODRL 2.2 namespace (the policy an agent-authz credential carries). */
export declare const ODRL: "http://www.w3.org/ns/odrl/2/";
/** schema.org namespace (`agent`, used by the M1 agent pointer the VC references). */
export declare const SCHEMA: "https://schema.org/";
/**
 * The `@jeswr` Solid-VC extension namespace — the ONLY minted namespace here. It
 * homes the agent-authorization credential type + its properties. Per the suite
 * namespace rule it is a `@jeswr`/`w3id.org/jeswr`-rooted IRI (NEVER `@solid/`),
 * and it references (does not duplicate) `@jeswr/solid-federation-vocab`. The IRI
 * resolves under the `w3id.org/jeswr` vocab home the federation vocab owns.
 */
export declare const SVC: "https://w3id.org/jeswr/solid-vc#";
/** `rdf:type`. */
export declare const RDF_TYPE: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** `cred:VerifiableCredential` — the credential class. */
export declare const VC_CREDENTIAL: "https://www.w3.org/2018/credentials#VerifiableCredential";
/** `cred:VerifiablePresentation` — the presentation class (wraps credentials). */
export declare const VC_PRESENTATION: "https://www.w3.org/2018/credentials#VerifiablePresentation";
/** `cred:issuer` — Credential → the issuing party (a WebID / DID). */
export declare const VC_ISSUER: "https://www.w3.org/2018/credentials#issuer";
/** `cred:credentialSubject` — Credential → the subject node(s). */
export declare const VC_CREDENTIAL_SUBJECT: "https://www.w3.org/2018/credentials#credentialSubject";
/** `cred:validFrom` — VC 2.0 issuance/validity start (replaces 1.1 `issuanceDate`). */
export declare const VC_VALID_FROM: "https://www.w3.org/2018/credentials#validFrom";
/** `cred:validUntil` — VC 2.0 expiry (replaces 1.1 `expirationDate`). */
export declare const VC_VALID_UNTIL: "https://www.w3.org/2018/credentials#validUntil";
/** `cred:credentialStatus` — Credential → a status entry (e.g. revocation list). */
export declare const VC_CREDENTIAL_STATUS: "https://www.w3.org/2018/credentials#credentialStatus";
/** `cred:verifiableCredential` — Presentation → an embedded credential. */
export declare const VC_VERIFIABLE_CREDENTIAL: "https://www.w3.org/2018/credentials#verifiableCredential";
/** `cred:holder` — Presentation → the presenting party. */
export declare const VC_HOLDER: "https://www.w3.org/2018/credentials#holder";
/** `sec:proof` — the embedded Data Integrity proof node. */
export declare const SEC_PROOF: "https://w3id.org/security#proof";
/** `sec:DataIntegrityProof` — the W3C Data Integrity proof type. */
export declare const SEC_DATA_INTEGRITY_PROOF: "https://w3id.org/security#DataIntegrityProof";
/** `sec:cryptosuite` — the named cryptosuite (e.g. `eddsa-rdfc-2022`). */
export declare const SEC_CRYPTOSUITE: "https://w3id.org/security#cryptosuite";
/** `sec:proofValue` — the multibase-encoded signature octets. */
export declare const SEC_PROOF_VALUE: "https://w3id.org/security#proofValue";
/** `sec:verificationMethod` — the key the proof is verified against. */
export declare const SEC_VERIFICATION_METHOD: "https://w3id.org/security#verificationMethod";
/** `sec:proofPurpose` — why the proof was created (`assertionMethod`, …). */
export declare const SEC_PROOF_PURPOSE: "https://w3id.org/security#proofPurpose";
/** The dateTime the proof was created (Data Integrity uses `dc:created`). */
export declare const DC_CREATED: "http://purl.org/dc/terms/created";
/**
 * `svc:AgentAuthorizationCredential` — the headline credential type: a signed
 * assertion that a principal (a WebID) authorizes an agent (a WebID / agent-card
 * IRI) to perform an action over a target, optionally bound to an ODRL policy.
 * This is the M4 "WebID X authorizes agent Y for action Z under policy P".
 */
export declare const SVC_AGENT_AUTHORIZATION: "https://w3id.org/jeswr/solid-vc#AgentAuthorizationCredential";
/** `svc:authorizes` — the authorized agent (a WebID or `@jeswr/solid-agent-card` IRI). */
export declare const SVC_AUTHORIZES: "https://w3id.org/jeswr/solid-vc#authorizes";
/** `svc:action` — the authorized action IRI (an `acl:` mode or an ODRL action). */
export declare const SVC_ACTION: "https://w3id.org/jeswr/solid-vc#action";
/** `svc:target` — the resource / asset the authorization governs. */
export declare const SVC_TARGET: "https://w3id.org/jeswr/solid-vc#target";
/** `svc:policy` — link to the governing `@jeswr/solid-odrl` ODRL policy graph. */
export declare const SVC_POLICY: "https://w3id.org/jeswr/solid-vc#policy";
/**
 * The pinned inline JSON-LD `@context` emitted for a Solid-VC CLAIM document (the
 * unsigned credential graph). It layers the standard VC 2.0 context (by IRI) with
 * the local agent-authz extension terms, so the emitted JSON-LD expands to the
 * SAME RDF as the Turtle (kept in lock-step) AND remains valid, dereferenceable
 * VC 2.0 for industry tooling.
 *
 * It deliberately does NOT layer the Data Integrity context here: the unsigned
 * claim graph carries no `proof`, and layering `data-integrity/v2` on top of the
 * VC 2.0 context re-protects already-protected security terms (which the strict
 * `jsonld-context-parser` rejects as a protected-term redefinition). The DI
 * context is added only when serialising a SIGNED VC — see {@link SVC_SIGNED_CONTEXT}.
 */
export declare const SVC_INLINE_CONTEXT: ReadonlyArray<string | Record<string, unknown>>;
/**
 * The `@context` for a SIGNED Solid-VC document — the claim context plus the Data
 * Integrity v2 context (which defines the `proof` / `DataIntegrityProof` terms).
 * Used when a signed VC's `proof` is serialised to JSON-LD.
 */
export declare const SVC_SIGNED_CONTEXT: ReadonlyArray<string | Record<string, unknown>>;
//# sourceMappingURL=vocab.d.ts.map