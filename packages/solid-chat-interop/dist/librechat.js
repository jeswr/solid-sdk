// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { httpIriOrUndefined, safeHttpIri } from "./iri.js";
/** Default model→IRI resolver: a stable non-http URN (dropped by the IRI guard on write). */
function defaultResolveModelIri(model, endpoint) {
    const m = (model ?? "").trim();
    const e = (endpoint ?? "").trim();
    if (!m && !e)
        return undefined;
    const label = [e, m].filter(Boolean).join(":");
    return `urn:librechat:model:${encodeURIComponent(label)}`;
}
/** Normalise a LibreChat `createdAt` (ISO string or epoch ms) to an ISO-8601 string. */
function toIso(createdAt) {
    if (createdAt === undefined || createdAt === null)
        return undefined;
    const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
/**
 * Resolve a LibreChat id-shaped value (`conversationId` / `parentMessageId`) to an
 * absolute http(s) IRI, or `undefined`. An already-absolute http(s) value is used
 * as-is; otherwise it is resolved against `roomBaseIri` (when configured) and the
 * RESULT must itself be http(s). Anything else is dropped (never coerced).
 */
function resolveId(value, baseIri) {
    const v = value?.trim();
    if (!v)
        return undefined;
    // An already-absolute http(s) id is used as-is — but CANONICALISED (never the raw
    // value), so an id like `http://e/a>b` cannot carry an IRI-injection character
    // into the canonical model and thence into `n3.Writer`.
    const direct = safeHttpIri(v);
    if (direct !== undefined)
        return direct;
    if (!baseIri)
        return undefined;
    try {
        const resolved = new URL(encodeURIComponent(v), baseIri).toString();
        return httpIriOrUndefined(resolved);
    }
    catch {
        return undefined;
    }
}
/**
 * Decide whether a LibreChat message is human-authored. Prefers the explicit
 * `isCreatedByUser` flag; falls back to `sender === "User"` / `role === "user"`.
 * Defaults to AI (false) when nothing indicates a human — the safe default for
 * attribution (never silently claim a human authored an unlabelled message).
 */
function isHuman(m) {
    if (typeof m.isCreatedByUser === "boolean")
        return m.isCreatedByUser;
    if (typeof m.sender === "string" && m.sender.trim().toLowerCase() === "user")
        return true;
    if (typeof m.role === "string" && m.role.trim().toLowerCase() === "user")
        return true;
    return false;
}
/**
 * The LibreChat → canonical adapter. Construct with the IRIs LibreChat lacks
 * ({@link LibreChatAdapterOptions}); call {@link toCanonical} per message.
 */
export class LibreChatAdapter {
    opts;
    resolveModelIri;
    constructor(opts = {}) {
        this.opts = opts;
        this.resolveModelIri = opts.resolveModelIri ?? defaultResolveModelIri;
    }
    /**
     * Map one LibreChat message onto the canonical model. Reads ONLY the public
     * fields in {@link LibreChatMessage}; LibreChat internals never reach the result.
     */
    toCanonical(externalMessage) {
        const m = externalMessage;
        const msg = {
            content: typeof m.text === "string" ? m.text : "",
            mediaType: "text/plain",
        };
        const published = toIso(m.createdAt);
        if (published !== undefined)
            msg.published = published;
        const room = resolveId(m.conversationId, this.opts.roomBaseIri);
        if (room !== undefined)
            msg.room = room;
        const inReplyTo = resolveId(m.parentMessageId, this.opts.roomBaseIri);
        if (inReplyTo !== undefined)
            msg.inReplyTo = inReplyTo;
        if (isHuman(m)) {
            // Human message: attribute to the configured human WebID (omit if none —
            // never fabricate). No provenance.
            const author = httpIriOrUndefined(this.opts.humanWebId);
            if (author !== undefined)
                msg.author = author;
        }
        else {
            // AI/assistant message: honest PROV-O attribution, NO human author.
            const provenance = {};
            const attributedTo = httpIriOrUndefined(this.opts.agentWebId);
            if (attributedTo !== undefined)
                provenance.attributedTo = attributedTo;
            const generatedBy = httpIriOrUndefined(this.resolveModelIri(m.model, m.endpoint));
            if (generatedBy !== undefined)
                provenance.generatedBy = generatedBy;
            if (provenance.attributedTo !== undefined ||
                provenance.generatedBy !== undefined ||
                provenance.derivedFrom !== undefined) {
                msg.provenance = provenance;
            }
        }
        return msg;
    }
}
//# sourceMappingURL=librechat.js.map