import type { DatasetCore, Quad } from "@rdfjs/types";
import type { AgentAuthorization, Credential } from "./types.js";
import { type CredentialNode } from "./wrappers.js";
/**
 * Lower a structured {@link Credential} (the UNSIGNED claim graph — no proof) to
 * RDF quads via the typed write path. The credential gets an `@id` (a random
 * `urn:uuid:` when omitted) so it is an addressable named node the proof can bind
 * to. `validFrom` defaults to now ONLY at the {@link issue} step, not here — this
 * is a pure projection of exactly what the caller supplied.
 */
export declare function credentialToRdf(credential: Credential): Quad[];
/** Serialise a credential's claim graph to Turtle (default) or another n3 format. */
export declare function credentialToTurtle(credential: Credential, format?: string): Promise<string>;
/**
 * Build the VC 2.0 JSON-LD document for a credential's claim graph (no proof): a
 * deterministic projection kept in lock-step with the RDF quads, with the pinned
 * inline `@context`. A consumer can parse it back via `@jeswr/fetch-rdf`.
 */
export declare function credentialToJsonLd(credential: Credential): Record<string, unknown>;
/**
 * Read the credential METADATA (issuer / validity / types / id) back from a
 * parsed credential node. The full `credentialSubject` claim graph is intentionally
 * NOT projected back to a structured object here (it is arbitrary RDF); verification
 * works over the quads directly. Callers that need typed claims use the M-specific
 * helpers (e.g. {@link agentAuthorizationFromRdf}).
 */
export declare function credentialMetaFromNode(node: CredentialNode): {
    id: string;
    issuer: string | undefined;
    validFrom: string | undefined;
    validUntil: string | undefined;
    types: string[];
};
/** Parse a credential graph (Turtle/JSON-LD string) into an RDF dataset. */
export declare function parseCredentialRdf(body: string, contentType?: string): Promise<DatasetCore>;
/** Find the first credential node in a parsed dataset, or `undefined`. */
export declare function credentialFromRdf(dataset: DatasetCore): CredentialNode | undefined;
/**
 * Build the structured {@link Credential} for the headline M4 case — "principal
 * authorizes agent for action(s) over target under ODRL policy" — as an
 * `AgentAuthorizationCredential`. The issuer IS the principal (a WebID signs that
 * it delegates to the agent). Compose with `@jeswr/solid-agent-card` (the `agent`
 * IRI) and `@jeswr/solid-odrl` (the `policy` IRI).
 */
export declare function buildAgentAuthorizationCredential(auth: AgentAuthorization): Credential;
/**
 * Read the agent-authorization claim back from a parsed credential node — the
 * typed inverse of {@link buildAgentAuthorizationCredential}. Returns `undefined`
 * if the node is not an `AgentAuthorizationCredential` with the required terms.
 */
export declare function agentAuthorizationFromRdf(node: CredentialNode): Pick<AgentAuthorization, "principal" | "agent" | "action" | "target" | "policy"> | undefined;
//# sourceMappingURL=credential.d.ts.map