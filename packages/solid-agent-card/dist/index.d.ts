/**
 * `@jeswr/solid-agent-card` — the Solid pod / WebID → agent pointer (M1 of the
 * agentic-Solid roadmap: "the README points to an agent").
 *
 * Given a pod or WebID, this package **emits** and **consumes** a machine-readable
 * "how an agent should interact with me" descriptor, anchored on the WebID:
 *
 * - {@link describeAgent} — build the TWO co-located descriptors an agent serves:
 *   an **A2A Agent Card** (plain JSON, industry reach) and an **ANP-aligned Agent
 *   Description** (JSON-LD / Turtle RDF, RDF reach) — projected from one source so
 *   they cannot drift.
 * - {@link buildAgentPointer} — build the person→agent pointer triple to publish
 *   in a WebID profile (`interop:hasAuthorizationAgent` / `schema:agent`).
 * - {@link discoverAgent} — given a WebID, read the agent pointer, then resolve +
 *   verify the agent's Agent Description.
 * - {@link verifyDescriptor} — validate an Agent Description document.
 * - {@link agentDescriptionsUrl} / {@link agentCardUrl} — the ANP / A2A well-known
 *   discovery URLs for an origin.
 *
 * RDF discipline: parse via `@jeswr/fetch-rdf`, extract via `@rdfjs/wrapper`,
 * serialise via `n3.Writer`. Never a bespoke parser; never a hand-built triple.
 *
 * Standard vocabularies only (no bespoke `@jeswr/…` agent vocab is minted): ANP
 * Agent Description, A2A Agent Card, schema.org, Solid Interop (SAI).
 *
 * Scope note (roadmap M1): this is the SEPARATE-CODEBASE entry point, with ZERO
 * prod-solid-server core risk for the common case — the pod serves the descriptor
 * documents as ordinary resources. Delegation (`act`-chain tokens), server-side
 * ODRL enforcement and Access-Grant scope-down are LATER, gated CORE-PSS
 * milestones (M5) and are deliberately NOT part of this package.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */
export { describeAgent } from "./describe.js";
export type { DiscoverOptions } from "./discover.js";
export { agentCardUrl, agentDescriptionsUrl, discoverAgent } from "./discover.js";
export type { AgentPointerDocument, AgentPointerOptions, PointerPredicate } from "./pointer.js";
export { buildAgentPointer } from "./pointer.js";
export { serialize } from "./serialize.js";
export type { AgentCard, AgentCardSecurityScheme, AgentDescriptionDocument, AgentDescriptor, AgentDescriptorDocuments, AgentDiscovery, AgentPointer, AgentSkill, SecurityScheme, VerificationIssue, VerificationIssueCode, VerificationResult, } from "./types.js";
export type { VerifyDatasetOptions, VerifyOptions } from "./verify.js";
export { verifyDataset, verifyDescriptor } from "./verify.js";
export { A2A_PROTOCOL_VERSION, AGENT_POINTER_PREDICATES, ANP_AD, ANP_CONTEXT_URL, ANP_INLINE_CONTEXT, HAS_AUTHORIZATION_AGENT, SCHEMA_AGENT, SECURITY_SCHEME_TYPES, type SecuritySchemeType, VALID_SECURITY_SCHEME_TYPES, WELL_KNOWN_AGENT_CARD, WELL_KNOWN_AGENT_DESCRIPTIONS, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map