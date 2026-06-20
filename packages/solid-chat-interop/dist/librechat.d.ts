/**
 * `LibreChatAdapter` — ONE concrete {@link ChatAdapter} as proof of the seam.
 *
 * LibreChat (~28k★) stores conversations in MongoDB with NO storage SPI, so the
 * naive path dumps opaque, LibreChat-private, non-RDF documents into a pod. This
 * adapter instead maps LibreChat's public message shape onto the canonical model
 * per the solid-oss-integration-targets report (§3 LibreChat field map):
 *
 *   text            → content
 *   createdAt       → published
 *   conversationId  → room (under an optional `roomBaseIri`)
 *   parentMessageId → inReplyTo (under an optional `roomBaseIri`)
 *   sender / user   → (HUMAN) author = the configured human WebID
 *   model / endpoint → (AI) provenance.generatedBy + provenance.attributedTo = the
 *                       configured agent WebID
 *
 * **Human vs AI.** A user message (`isCreatedByUser === true`, or
 * `sender`/`role` naming the user) maps its author to the configured `humanWebId`
 * and carries NO provenance. An assistant/model message maps to honest PROV-O
 * attribution — `provenance.attributedTo` the agent WebID + `provenance.generatedBy`
 * the model/endpoint IRI — and carries NO `author` (it is not a human). This is the
 * "AI history lands as the SAME shape, with honest attribution" rule.
 *
 * **No fabricated IRIs.** WebIDs/agent IRIs are supplied by the caller via
 * {@link LibreChatAdapterOptions}; when none is configured the field is OMITTED
 * rather than invented. Everything that becomes an IRI is filtered http(s)-only.
 *
 * **No private fields leak.** Only the canonical fields above are read; LibreChat
 * internals (`_id`, `__v`, `tokenCount`, `error`, `unfinished`, `files`,
 * `finish_reason`, raw endpoint internals, …) are never copied into the canonical
 * model.
 */
import type { ChatAdapter } from "./adapter.js";
import type { CanonicalMessage } from "./canonical.js";
/**
 * The PUBLIC subset of a LibreChat message this adapter reads — the documented
 * export shape. Anything not listed here (LibreChat internals) is intentionally
 * absent: even if present on a runtime object, it is never copied into the
 * canonical model.
 */
export interface LibreChatMessage {
    /** The message body — `text`. */
    text?: string;
    /** Creation timestamp — `createdAt` (ISO-8601 string or epoch ms). */
    createdAt?: string | number;
    /** The conversation this message belongs to — `conversationId`. */
    conversationId?: string;
    /** The message this one replies to — `parentMessageId`. */
    parentMessageId?: string;
    /**
     * Whether the user (a human) authored this message. The PRIMARY human/AI
     * discriminator — `true` ⇒ human, `false` ⇒ assistant/model.
     */
    isCreatedByUser?: boolean;
    /**
     * The sender label — e.g. `"User"` for a human, or a model/assistant name.
     * A SECONDARY discriminator used only when `isCreatedByUser` is absent.
     */
    sender?: string;
    /** Chat role — `"user"` (human) or `"assistant"`/`"system"` (AI). Tertiary discriminator. */
    role?: string;
    /** The model that generated an AI message — `model`. */
    model?: string;
    /** The endpoint/provider that generated an AI message — `endpoint`. */
    endpoint?: string;
}
/** Configuration for {@link LibreChatAdapter} — supplies the IRIs LibreChat lacks. */
export interface LibreChatAdapterOptions {
    /**
     * The WebID to attribute HUMAN messages to (`author`). If omitted, a human
     * message's `author` is OMITTED rather than fabricated.
     */
    humanWebId?: string;
    /**
     * The agent WebID to attribute AI messages to (`provenance.attributedTo`). If
     * omitted, an AI message carries `provenance.generatedBy` (the model) only.
     */
    agentWebId?: string;
    /**
     * Base IRI under which `conversationId` → `room` and `parentMessageId` →
     * `inReplyTo` are resolved (e.g. `https://alice.example/chat/librechat/`). If
     * omitted, those id-shaped values are only used when they are ALREADY absolute
     * http(s) IRIs; otherwise they are dropped (never coerced into a NamedNode).
     */
    roomBaseIri?: string;
    /**
     * Resolves a LibreChat `model`/`endpoint` to an IRI for
     * `provenance.generatedBy`. If omitted, a default resolver mints a stable
     * `urn:librechat:model:<model>` URN, which is intentionally NOT an http(s) IRI
     * (so it is dropped by the IRI guard on write) — supply this to surface the model
     * as a real dereferenceable IRI.
     */
    resolveModelIri?: (model: string | undefined, endpoint: string | undefined) => string | undefined;
}
/**
 * The LibreChat → canonical adapter. Construct with the IRIs LibreChat lacks
 * ({@link LibreChatAdapterOptions}); call {@link toCanonical} per message.
 */
export declare class LibreChatAdapter implements ChatAdapter<LibreChatMessage> {
    private readonly opts;
    private readonly resolveModelIri;
    constructor(opts?: LibreChatAdapterOptions);
    /**
     * Map one LibreChat message onto the canonical model. Reads ONLY the public
     * fields in {@link LibreChatMessage}; LibreChat internals never reach the result.
     */
    toCanonical(externalMessage: LibreChatMessage): CanonicalMessage;
}
//# sourceMappingURL=librechat.d.ts.map