// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public domain types for the M2 NL→RDF intent / SHACL Protocol Document /
// upgrade-handshake surface: the plain-object views the translator, the SHACL
// validator, the Protocol Document builder and the handshake codec exchange. The
// RDF itself is read/written through @rdfjs/wrapper typed accessors (never these
// objects directly) — these are the SDK's ergonomic surface.

import type { Quad } from "@rdfjs/types";
import type { AclMode, IntentAction } from "./vocab.js";

/**
 * A single typed parameter on an intent — a key/value pair (e.g. `{ key: "limit",
 * value: "10" }`). Values are strings on the wire; a consumer interprets them.
 */
export interface IntentParameter {
  /** The parameter name. */
  readonly key: string;
  /** The parameter value (lexical form). */
  readonly value: string;
}

/**
 * The structured "intent" an NL request is parsed into — an action (verb), a
 * target resource/type, and optional parameters / grant fields. This is the
 * machine-readable Linked Data the two agents negotiate over once they upgrade
 * off natural language. Grounded in standard vocabularies (schema.org Action,
 * ACL/WAC modes, LDP) plus the minimal minted `a2a:` glue.
 */
export interface Intent {
  /**
   * The intent node IRI (the subject of the intent graph). Defaults to a stable
   * IRI minted under the `baseIRI` when the translator builds one.
   */
  readonly id: string;
  /** The action kind (the verb), one of the closed {@link IntentAction} set. */
  readonly action: IntentAction;
  /**
   * The target: a resource IRI (a specific resource) OR an RDF class IRI (for
   * "all of type X" / "list a container"). Optional only for an action that needs
   * no target (rare) — the SHACL request shape requires it for most actions.
   */
  readonly target?: string;
  /** Optional typed key/value parameters. */
  readonly parameters?: readonly IntentParameter[];
  /**
   * For a `grant` intent: the recipient agent's WebID / IRI being granted access.
   */
  readonly recipient?: string;
  /**
   * For a `grant` intent: the ACL/WAC modes being granted (`Read`/`Write`/…).
   */
  readonly modes?: readonly AclMode[];
  /**
   * The requesting agent's WebID / IRI, where known (`schema:agent`). Optional.
   */
  readonly agent?: string;
}

/** Which path produced an {@link IntentResult}. */
export type IntentSource = "deterministic" | "translated";

/**
 * The result of {@link import("./translate.js").parseIntent} — the structured
 * intent (when resolved) + its RDF quads + which path produced it. Ordinary
 * "couldn't parse" is a `resolved: false` result, NOT a thrown error.
 */
export interface IntentResult {
  /** `true` when an intent was resolved (deterministically or via translate). */
  readonly resolved: boolean;
  /** Which path produced the intent. Absent when unresolved. */
  readonly source?: IntentSource;
  /** The structured intent. Absent when unresolved. */
  readonly intent?: Intent;
  /** The intent's RDF quads (built via the typed wrappers). Empty when unresolved. */
  readonly quads: readonly Quad[];
  /** The original natural-language input. */
  readonly nl: string;
  /**
   * A human-readable note when unresolved (e.g. "no verb matched; no translate
   * function supplied"). Absent when resolved.
   */
  readonly reason?: string;
}

/**
 * The structured draft an injected {@link TranslateFn} returns. A plain object
 * (the consumer's LLM emits this) that the package then LOWERS to RDF + validates.
 * It is the SAME shape as {@link Intent} minus the synthesised `id` — the package
 * mints the intent node IRI so the model never has to.
 */
export interface StructuredIntentDraft {
  /** The action kind. */
  readonly action: IntentAction;
  /** The target resource/class IRI. */
  readonly target?: string;
  /** Typed key/value parameters. */
  readonly parameters?: readonly IntentParameter[];
  /** Grant recipient. */
  readonly recipient?: string;
  /** Grant modes. */
  readonly modes?: readonly AclMode[];
  /** Requesting agent. */
  readonly agent?: string;
}

/**
 * The INJECTED translation seam. The consumer wires their OWN LLM here; this
 * package NEVER calls a model and makes NO network call of its own — the only
 * translator is the function you pass. Called by {@link import("./translate.js").parseIntent}
 * ONLY when the deterministic rule/template path fails to classify the input.
 *
 * The function receives the NL plus optional hints (a vocabulary hint, the SHACL
 * shape the result must conform to) and returns a {@link StructuredIntentDraft},
 * or `null`/`undefined` when it too cannot resolve the input (→ an unresolved
 * {@link IntentResult}, never a throw for an ordinary miss).
 */
export type TranslateFn = (input: {
  /** The natural-language request. */
  readonly nl: string;
  /** A free-form vocabulary hint the consumer may use to steer the model. */
  readonly vocabularyHint?: string;
  /** The SHACL shape (Turtle) the result must conform to, when one is in scope. */
  readonly shape?: string;
}) => Promise<StructuredIntentDraft | null | undefined>;

/** A single SHACL validation problem, projected to a plain object. */
export interface ValidationResultEntry {
  /** The validation message(s). */
  readonly message: string;
  /** The SHACL constraint component IRI that failed (e.g. `sh:MinCountConstraintComponent`). */
  readonly sourceConstraintComponent?: string;
  /** The focus node the failure is about. */
  readonly focusNode?: string;
  /** The property path the failure is about. */
  readonly path?: string;
  /** The offending value, where applicable. */
  readonly value?: string;
  /** The result severity IRI (`sh:Violation` / `sh:Warning` / `sh:Info`). */
  readonly severity?: string;
}

/**
 * The structured result of {@link import("./validate.js").validateIntent}. Never
 * thrown — non-conformance is `conforms: false` with a populated `results`.
 */
export interface ValidationReport {
  /** `true` when the data graph conforms to the shape. */
  readonly conforms: boolean;
  /** The individual validation problems (empty iff `conforms`). */
  readonly results: readonly ValidationResultEntry[];
}

/** Metadata for a {@link ProtocolDocument}. */
export interface ProtocolMeta {
  /** The protocol's IRI (its stable id / where it is pod-hosted). */
  readonly id: string;
  /** Human-readable protocol name. */
  readonly name?: string;
  /** What the protocol does (NL). */
  readonly description?: string;
  /** A version string (e.g. `"1"` / `"2026-06-16"`). */
  readonly version?: string;
}

/**
 * The inputs to {@link import("./protocol.js").buildProtocolDocument} — the SHACL
 * request shape, an optional response shape, and the metadata. Each shape is
 * supplied as RDF quads (built via {@link import("./shape.js").buildShapeForIntent}
 * or the consumer's own typed-wrapper construction — never hand-built triples).
 */
export interface ProtocolDocumentInput {
  /** The SHACL request shape (quads): what a conforming request RDF graph must satisfy. */
  readonly requestShape: readonly Quad[];
  /** The SHACL response shape (quads). Optional. */
  readonly responseShape?: readonly Quad[];
  /** Protocol metadata. */
  readonly meta: ProtocolMeta;
}

/**
 * A built Protocol Document: the SHACL-bodied, content-addressed (hash-pinned)
 * protocol both agents agree on. The {@link ProtocolDocument.hash} is a hash of
 * the document's canonical serialisation, so an upgrading peer can verify a
 * fetched document matches the pinned hash before trusting it.
 */
export interface ProtocolDocument {
  /** The protocol metadata. */
  readonly meta: ProtocolMeta;
  /** The document's full RDF quads (metadata + the request/response shapes). */
  readonly quads: readonly Quad[];
  /**
   * JUST the request-shape quads (the SHACL a request RDF graph is validated
   * against). Exposed so a validator uses ONLY the request side — a response
   * shape that happens to target a class also present in a request graph must
   * not make a valid request fail. See {@link import("./validate.js").validateIntent}.
   */
  readonly requestShapeQuads: readonly Quad[];
  /**
   * The content hash (`sha256:<hex>`) of the document's CANONICAL serialisation.
   * Deterministic + stable across runs for the same logical document. This is the
   * value that goes into an M1 `AgentDescriptor.protocolSources` pin.
   */
  readonly hash: string;
  /** Serialise the document to Turtle (default) or another n3 format. */
  toTurtle(format?: string): Promise<string>;
  /** A JSON-LD document object (the quads with the pinned inline `@context`). */
  toJsonLd(): Promise<Record<string, unknown>>;
}

// --- the upgrade-handshake codec ----------------------------------------

/**
 * An offer to UPGRADE from natural language to the RDF/SHACL protocol identified
 * by {@link UpgradeOffer.protocolHash}. Carried (transport-agnostic) over A2A as a
 * DataPart — this package provides ONLY the codec + the data shapes, never a live
 * transport (the runtime carrier is a separate `@jeswr/solid-agent` package).
 */
export interface UpgradeOffer {
  /** Discriminant for the codec. */
  readonly kind: "upgrade-offer";
  /** The hash-pin of the Protocol Document being offered (`sha256:<hex>`). */
  readonly protocolHash: string;
  /**
   * Where to FETCH the Protocol Document (the URL that goes into / comes from an
   * M1 `AgentDescriptor.protocolSources`). The peer fetches it and verifies the
   * fetched body hashes to {@link UpgradeOffer.protocolHash} before trusting it.
   */
  readonly protocolSource: string;
  /**
   * When `true`, the upgrade is REQUIRED for this (security-bearing) exchange — the
   * peer must NOT silently fall back to unsigned NL; a refusal to upgrade is a
   * refusal of the exchange (the no-silent-downgrade rule). Defaults to `false`
   * (an optional, capability-only upgrade where NL fallback is acceptable).
   */
  readonly required?: boolean;
  /**
   * The human-readable protocol name, for an audit log / a decline reason. Optional.
   */
  readonly protocolName?: string;
}

/** A peer's response to an {@link UpgradeOffer}. */
export interface UpgradeResponse {
  /** Discriminant for the codec. */
  readonly kind: "upgrade-response";
  /** The hash of the protocol the response is about (echoes the offer). */
  readonly protocolHash: string;
  /**
   * `true` ⇒ the peer accepts and will speak the RDF/SHACL protocol; `false` ⇒ it
   * declines. Declining a `required` offer means the exchange cannot proceed (the
   * caller must NOT downgrade to NL — see {@link UpgradeOffer.required}).
   */
  readonly accept: boolean;
  /** A human-readable reason when declining. Optional. */
  readonly reason?: string;
}

/** Either handshake message. */
export type HandshakeMessage = UpgradeOffer | UpgradeResponse;
