/**
 * `@jeswr/solid-a2a` — the NL→RDF intent translator + SHACL-bodied AGORA Protocol
 * Document + upgrade-handshake codec (M2 of the agentic-Solid roadmap: "the NL→RDF
 * upgrade — an AGORA protocol document, made RDF/SHACL-native").
 *
 * Two agents talk natural language first (maximum reach); when both understand it
 * they UPGRADE to a structured RDF representation grounded in standard
 * vocabularies, negotiating over machine-readable Linked Data rather than opaque
 * text, and a request maps onto a pod's actual SHACL shapes/affordances (advertised
 * via M1's `AgentDescriptor.protocolSources`).
 *
 * - {@link parseIntent} — NL → a structured RDF intent graph. Tries a DETERMINISTIC
 *   rule/template path first (the common verbs, no model); falls back to an INJECTED
 *   `translate` seam (your own LLM) only when that fails. The package NEVER calls a
 *   model and makes NO network call of its own.
 * - {@link intentToTurtle} / {@link intentToJsonLd} / {@link parseIntentGraph} /
 *   {@link intentFromRdf} — serialise + round-trip the intent (lossless on the
 *   intent fields).
 * - {@link buildShapeForIntent} / {@link buildResponseShape} — prebuilt SHACL
 *   request/response shapes for the core intents.
 * - {@link validateIntent} — SHACL-validate an intent against a shape / Protocol
 *   Document (structured report; never throws on non-conformance).
 * - {@link buildProtocolDocument} / {@link verifyProtocolDocument} / {@link hashQuads}
 *   — build a SHACL-bodied, content-addressed (sha256 hash-pinned) Protocol
 *   Document, and verify a fetched body matches its pinned hash.
 * - {@link encodeUpgradeOffer} / {@link decodeUpgradeOffer} /
 *   {@link encodeUpgradeResponse} / {@link decodeUpgradeResponse} /
 *   {@link mayDowngradeToNl} + the RDF forms — the transport-agnostic
 *   upgrade-handshake codec, with the no-silent-downgrade rule for a `required`
 *   (security-bearing) protocol. NO networking — the runtime carrier is a separate
 *   `@jeswr/solid-agent` package.
 *
 * RDF discipline: parse via `@jeswr/fetch-rdf`, read/write terms via
 * `@rdfjs/wrapper` typed accessors, serialise via `n3.Writer`, SHACL-validate via
 * `rdf-validate-shacl`. Never a bespoke parser; never a hand-built triple.
 *
 * Vocabulary: standard terms where one fits (schema.org Action, ACL/WAC modes, LDP,
 * SHACL); a MINIMAL minted `a2a:` extension (`https://w3id.org/jeswr/a2a#`, never
 * `@solid/`) only for the intent-glue terms standards lack.
 *
 * Composes with M1 (`@jeswr/solid-agent-card`): a Protocol Document's hash/URL is
 * what goes into an `AgentDescriptor.protocolSources`.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */
export { canonicalNQuads } from "./canonical.js";
export { decodeUpgradeOffer, decodeUpgradeResponse, encodeUpgradeOffer, encodeUpgradeResponse, handshakeFromRdf, handshakeToRdf, handshakeToTurtle, mayDowngradeToNl, } from "./handshake.js";
export { intentFromRdf, intentToJsonLd, intentToRdf, intentToTurtle, parseIntentGraph, } from "./intent.js";
export { buildProtocolDocument, hashQuads, verifyProtocolDocument } from "./protocol.js";
export { serialize } from "./serialize.js";
export { buildResponseShape, buildShapeForIntent, defaultShapeId, shapeToTurtle, } from "./shape.js";
export type { ParseIntentOptions } from "./translate.js";
export { classifyDeterministic, parseIntent } from "./translate.js";
export type { HandshakeMessage, Intent, IntentParameter, IntentResult, IntentSource, ProtocolDocument, ProtocolDocumentInput, ProtocolMeta, StructuredIntentDraft, TranslateFn, UpgradeOffer, UpgradeResponse, ValidationReport, ValidationResultEntry, } from "./types.js";
export type { IntentInput, ShapeInput } from "./validate.js";
export { validateIntent } from "./validate.js";
export { A2A, A2A_INLINE_CONTEXT, ACL, ACL_MODE_IRI, ACL_MODES, ACTION_TYPE_IRI, type AclMode, INTENT_ACTIONS, type IntentAction, IRI_TO_ACTION, LDP, PROTOCOL_HASH_ALGORITHM, PROTOCOL_HASH_PREFIX, SCHEMA, SH, VALID_ACL_MODE_IRIS, VALID_INTENT_ACTIONS, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map