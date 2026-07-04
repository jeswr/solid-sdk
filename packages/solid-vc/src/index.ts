// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/solid-vc` — W3C Verifiable Credentials 2.0 data model + sign/verify with
 * a PLUGGABLE proof-suite seam, for agentic Solid (M4-VC of the agentic-Solid
 * roadmap: "VC / ZKP credential exchange — signed VCs are the default").
 *
 * It does four things, all standards-grade and CLIENT-SIDE (zero prod-solid-server
 * core risk):
 *
 * 1. **Data model** — build VC 2.0 credentials + presentations as queryable
 *    JSON-LD / RDF using the REAL W3C vocab (`https://www.w3.org/ns/credentials/v2`)
 *    through the suite RDF libs (`@jeswr/fetch-rdf` to parse, typed `@rdfjs/wrapper`
 *    accessors + `n3.Writer` to build/serialise — never a hand-built triple).
 *    {@link credentialToRdf} / {@link credentialToTurtle} / {@link credentialToJsonLd}
 *    + {@link parseCredentialRdf} / {@link credentialFromRdf}.
 * 2. **Sign / verify** — {@link issue} signs a credential; {@link verifyCredential}
 *    verifies it through a conjunction of independent, fail-closed gates (signature,
 *    expiry, not-yet-valid, issuer-binding, proof-purpose, trusted-issuer).
 * 3. **A pluggable proof-suite seam** — {@link ProofSuite} + {@link SuiteRegistry}.
 *    The sign/verify pipeline dispatches on `proof.cryptosuite` through the registry,
 *    so a JWT proof, a BBS Data Integrity suite, or — later — a **SPARQ ZK-over-SPARQL
 *    proof** plugs in WITHOUT touching the data model or the pipeline. The bundled
 *    concrete suite ({@link DataIntegritySuite}) implements `eddsa-rdfc-2022`
 *    (EdDSA / Ed25519) and `ecdsa-rdfc-2019` (ECDSA / P-256) over RDFC-1.0 via
 *    `jose`/WebCrypto + the vetted `rdf-canonize`. The ZK CRYPTOGRAPHY itself stays
 *    in `@jeswr/sparq` (the SPARQ agent's domain) — this package owns only the
 *    verification seam it plugs into.
 * 4. **The headline agent use case** — {@link buildAgentAuthorizationCredential} /
 *    {@link issueAgentAuthorization}: a signed `AgentAuthorizationCredential`
 *    ("WebID X authorizes agent Y for action Z under ODRL policy P"), composing with
 *    `@jeswr/solid-agent-card` (M1 — the `agent` IRI) and `@jeswr/solid-odrl` (M3 —
 *    the `policy` IRI).
 *
 * Relationship to the user's prior VC line (cite, don't green-field): this is the
 * standards-grade, RDF-native consolidation the roadmap calls `@jeswr/solid-vc`,
 * SUPERSEDING `@jeswr/vc-cli` (issue/verify across BBS/ECDSA-SD/Ed25519) and
 * `@jeswr/vc-queries` (SPARQL over VCs) into one Data-Integrity backbone. BBS lands
 * here next (the interop floor before the ZK-SPARQL slice — `@jeswr/agent-zk-sparql`).
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */

export { canonicalNQuads, dataIntegrityHash } from "./canonicalize.js";
// --- data model + RDF ------------------------------------------------------
export {
  agentAuthorizationFromRdf,
  buildAgentAuthorizationCredential,
  buildBoundAgentAuthorizationCredential,
  credentialFromRdf,
  credentialMetaFromNode,
  credentialToJsonLd,
  credentialToRdf,
  credentialToTurtle,
  parseCredentialRdf,
  relatedResourcesFromNode,
} from "./credential.js";
// --- the G1 policy-content digest (RDFC-1.0 → sha2-256 → digestMultibase) ---
export { digestQuads, digestRdfContent } from "./digest.js";
// --- sign / verify ---------------------------------------------------------
export { type IssueInput, issue, issueAgentAuthorization } from "./issue.js";
// --- keys ------------------------------------------------------------------
export {
  cryptosuiteForKeyType,
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPairForSuite,
  importKeyPair,
  importPublicKey,
  type SuiteKeyType,
} from "./keys.js";
export { base58btcDecode, base58btcEncode } from "./multibase.js";
// --- the pluggable proof-suite seam ----------------------------------------
export {
  DataIntegritySuite,
  defaultSuiteRegistry,
  type ProofSignOptions,
  type ProofSuite,
  type ProofVerifyOptions,
  proofOptionsQuads,
  SuiteRegistry,
} from "./proof.js";
export { serialize } from "./serialize.js";
// --- types -----------------------------------------------------------------
export type {
  AgentAuthorization,
  Credential,
  CredentialSubject,
  DataIntegrityProof,
  IssueOptions,
  JsonValue,
  KeyPair,
  Presentation,
  PresentedResourceContent,
  RelatedResource,
  VerifiableCredential,
  VerifiablePresentation,
  VerificationError,
  VerificationErrorCode,
  VerificationResult,
  VerifyOptions,
} from "./types.js";
export {
  type VerifyCredentialOptions,
  verifyCredential,
  verifyRelatedResources,
} from "./verify.js";
// --- vocab (the standard + the one documented @jeswr extension) ------------
export {
  SEC_DIGEST_MULTIBASE,
  SVC,
  SVC_AGENT_AUTHORIZATION,
  VC,
  VC_RELATED_RESOURCE,
  VC_V2_CONTEXT,
} from "./vocab.js";
// --- typed wrappers (for callers extending the read path) ------------------
export {
  CredentialNode,
  PresentationNode,
  ProofNode,
  VcDataset,
  wrapVc,
} from "./wrappers.js";
