// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Term IRIs + constants for the W3C Verifiable Credentials 2.0 surface (M4-VC of
// the agentic-Solid roadmap). The single source of the string IRIs the typed
// wrappers, the credential builder, the serialiser/parser and the proof suites
// all key on.
//
// Vocabulary policy (LD/SW best practice — reuse standards verbatim; mint NOTHING
// where a standard term exists). This package uses the REAL W3C Verifiable
// Credentials Data Model 2.0 (W3C Recommendation, 15 May 2025) at its canonical
// namespace `https://www.w3.org/2018/credentials#` (the `vc` term namespace
// behind the `https://www.w3.org/ns/credentials/v2` JSON-LD context) and the
// W3C Data Integrity 1.0 namespace `https://w3id.org/security#`. The classes and
// properties below are all standard VC / Data Integrity / cryptosuite IRIs;
// nothing here is minted EXCEPT the deliberately-namespaced agent-authorization
// extension (see `SVC` below) — a single documented `@jeswr` extension term for
// the headline "WebID X authorizes agent Y" credential type, mirroring the
// roadmap's note that new agent surfaces live in the `@jeswr/` namespace and
// reference (not duplicate) the federation vocab.

/**
 * The canonical W3C VC term namespace (the IRI the `credentials/v2` `@context`
 * expands core VC terms to). VCDM 2.0 keeps `https://www.w3.org/2018/credentials#`
 * for `VerifiableCredential`, `issuer`, `credentialSubject`, etc.
 */
export const VC = "https://www.w3.org/2018/credentials#" as const;
/** The VC 2.0 JSON-LD context IRI (the `@context` every VC 2.0 document carries). */
export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2" as const;
/** W3C Data Integrity 1.0 / Security vocabulary namespace (proofs, cryptosuites). */
export const SEC = "https://w3id.org/security#" as const;
/** The W3C Data Integrity v2 JSON-LD context IRI (proof terms). */
export const DI_V2_CONTEXT = "https://w3id.org/security/data-integrity/v2" as const;
/** XSD namespace (typed literal datatypes — `dateTime` for issuance/expiry). */
export const XSD = "http://www.w3.org/2001/XMLSchema#" as const;
/** RDF namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;
/** RDFS namespace. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#" as const;
/** ACL / WAC namespace — the Solid grant modes an authorization action maps onto. */
export const ACL = "http://www.w3.org/ns/auth/acl#" as const;
/** Canonical W3C ODRL 2.2 namespace (the policy an agent-authz credential carries). */
export const ODRL = "http://www.w3.org/ns/odrl/2/" as const;
/** schema.org namespace (`agent`, used by the M1 agent pointer the VC references). */
export const SCHEMA = "https://schema.org/" as const;

/**
 * The `@jeswr` Solid-VC extension namespace — the ONLY minted namespace here. It
 * homes the agent-authorization credential type + its properties. Per the suite
 * namespace rule it is a `@jeswr`/`w3id.org/jeswr`-rooted IRI (NEVER `@solid/`),
 * and it references (does not duplicate) `@jeswr/solid-federation-vocab`. The IRI
 * resolves under the `w3id.org/jeswr` vocab home the federation vocab owns.
 */
export const SVC = "https://w3id.org/jeswr/solid-vc#" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

// --- VC 2.0 classes (standard) --------------------------------------------
/** `cred:VerifiableCredential` — the credential class. */
export const VC_CREDENTIAL = `${VC}VerifiableCredential` as const;
/** `cred:VerifiablePresentation` — the presentation class (wraps credentials). */
export const VC_PRESENTATION = `${VC}VerifiablePresentation` as const;

// --- VC 2.0 properties (standard) -----------------------------------------
/** `cred:issuer` — Credential → the issuing party (a WebID / DID). */
export const VC_ISSUER = `${VC}issuer` as const;
/** `cred:credentialSubject` — Credential → the subject node(s). */
export const VC_CREDENTIAL_SUBJECT = `${VC}credentialSubject` as const;
/** `cred:validFrom` — VC 2.0 issuance/validity start (replaces 1.1 `issuanceDate`). */
export const VC_VALID_FROM = `${VC}validFrom` as const;
/** `cred:validUntil` — VC 2.0 expiry (replaces 1.1 `expirationDate`). */
export const VC_VALID_UNTIL = `${VC}validUntil` as const;
/** `cred:credentialStatus` — Credential → a status entry (e.g. revocation list). */
export const VC_CREDENTIAL_STATUS = `${VC}credentialStatus` as const;
/** `cred:verifiableCredential` — Presentation → an embedded credential. */
export const VC_VERIFIABLE_CREDENTIAL = `${VC}verifiableCredential` as const;
/** `cred:holder` — Presentation → the presenting party. */
export const VC_HOLDER = `${VC}holder` as const;

// --- Data Integrity / Security properties (standard) ----------------------
/** `sec:proof` — the embedded Data Integrity proof node. */
export const SEC_PROOF = `${SEC}proof` as const;
/** `sec:DataIntegrityProof` — the W3C Data Integrity proof type. */
export const SEC_DATA_INTEGRITY_PROOF = `${SEC}DataIntegrityProof` as const;
/** `sec:cryptosuite` — the named cryptosuite (e.g. `eddsa-rdfc-2022`). */
export const SEC_CRYPTOSUITE = `${SEC}cryptosuite` as const;
/** `sec:proofValue` — the multibase-encoded signature octets. */
export const SEC_PROOF_VALUE = `${SEC}proofValue` as const;
/** `sec:verificationMethod` — the key the proof is verified against. */
export const SEC_VERIFICATION_METHOD = `${SEC}verificationMethod` as const;
/** `sec:proofPurpose` — why the proof was created (`assertionMethod`, …). */
export const SEC_PROOF_PURPOSE = `${SEC}proofPurpose` as const;
/** The dateTime the proof was created (Data Integrity uses `dc:created`). */
export const DC_CREATED = "http://purl.org/dc/terms/created" as const;

// --- The @jeswr agent-authorization extension (minted, documented) --------
/**
 * `svc:AgentAuthorizationCredential` — the headline credential type: a signed
 * assertion that a principal (a WebID) authorizes an agent (a WebID / agent-card
 * IRI) to perform an action over a target, optionally bound to an ODRL policy.
 * This is the M4 "WebID X authorizes agent Y for action Z under policy P".
 */
export const SVC_AGENT_AUTHORIZATION = `${SVC}AgentAuthorizationCredential` as const;
/** `svc:authorizes` — the authorized agent (a WebID or `@jeswr/solid-agent-card` IRI). */
export const SVC_AUTHORIZES = `${SVC}authorizes` as const;
/** `svc:action` — the authorized action IRI (an `acl:` mode or an ODRL action). */
export const SVC_ACTION = `${SVC}action` as const;
/** `svc:target` — the resource / asset the authorization governs. */
export const SVC_TARGET = `${SVC}target` as const;
/** `svc:policy` — link to the governing `@jeswr/solid-odrl` ODRL policy graph. */
export const SVC_POLICY = `${SVC}policy` as const;

/** The local agent-authz `@context` term block (the only minted terms). */
const SVC_TERMS: Record<string, unknown> = {
  svc: SVC,
  acl: ACL,
  odrl: ODRL,
  schema: SCHEMA,
  AgentAuthorizationCredential: SVC_AGENT_AUTHORIZATION,
  authorizes: { "@id": SVC_AUTHORIZES, "@type": "@id" },
  action: { "@id": SVC_ACTION, "@type": "@id" },
  target: { "@id": SVC_TARGET, "@type": "@id" },
  policy: { "@id": SVC_POLICY, "@type": "@id" },
};

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
export const SVC_INLINE_CONTEXT: ReadonlyArray<string | Record<string, unknown>> = [
  VC_V2_CONTEXT,
  SVC_TERMS,
];

/**
 * The `@context` for a SIGNED Solid-VC document — the claim context plus the Data
 * Integrity v2 context (which defines the `proof` / `DataIntegrityProof` terms).
 * Used when a signed VC's `proof` is serialised to JSON-LD.
 */
export const SVC_SIGNED_CONTEXT: ReadonlyArray<string | Record<string, unknown>> = [
  VC_V2_CONTEXT,
  DI_V2_CONTEXT,
  SVC_TERMS,
];
