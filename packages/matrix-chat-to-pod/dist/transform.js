// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The PURE Matrix→canonical transform — the heart of the package, and the only
 * place Matrix-event semantics are interpreted.
 *
 * `matrixEventToCanonical(event, ctx)` maps ONE untrusted Matrix CS-API event to a
 * {@link MatrixEventResult}: either a {@link CanonicalMessage} (for an
 * `m.room.message`), a tombstone instruction (for an `m.room.redaction`), or a
 * SKIP (for a non-message event, an edit/replace placeholder we fold into the
 * target, or an unmappable/hostile event). It does NO network and holds NO state,
 * so it is exhaustively fixture-testable.
 *
 * Field mapping (Matrix → canonical → the suite chat shapes via
 * `@jeswr/solid-chat-interop`):
 *  - `content.body` (plain text) → `content`; `content.formatted_body` (HTML) →
 *    carried as `formatted` + reflected in `mediaType` `text/html` when present, so
 *    a LongChat/AS2 reader gets the richer body. For an EDIT, the replacement body
 *    is read from `content['m.new_content']` (per the spec, the top-level body of an
 *    edit event is a fallback/notice, not the new content).
 *  - `sender` (`@user:server`) → `author`. A Matrix user id is NOT a WebID; we map
 *    it to a deterministic synthetic IRI ONLY when a {@link MatrixContext.webIdFor}
 *    resolver yields an http(s) WebID, else the author is left UNSET (the canonical
 *    model filters non-http(s) IRIs — a bare `@user:server` must never surface as a
 *    link). The raw Matrix id is preserved verbatim on the result as `matrixSender`
 *    for provenance/audit, never as an RDF IRI.
 *  - `origin_server_ts` (ms epoch) → `published` (ISO-8601).
 *  - `room_id` → `room`, via {@link MatrixContext.roomIriFor} (the synthetic room
 *    IRI inside the pod container); a bare `!room:server` is not an http(s) IRI so
 *    it is only set when the resolver yields one.
 *  - `content['m.relates_to']['m.in_reply_to'].event_id` → `inReplyTo`, via
 *    {@link MatrixContext.messageIriFor} (the in-pod resource for that event).
 *  - an `m.replace` edit → folded onto the TARGET message as `replacedBy` (a
 *    `dct:isReplacedBy` edge) by the importer; the transform returns the edit's new
 *    content as a `replace` instruction.
 *  - an `m.room.redaction` → `schema:dateDeleted` on the target (a `redaction`
 *    instruction); the transform also recognises an event the server already
 *    returned redacted (`unsigned.redacted_because`).
 *
 * Untrusted-input discipline: every field is read defensively; a missing or
 * wrong-typed field is DROPPED (never coerced, never thrown). Provenance carries
 * `prov:wasDerivedFrom` only when a real http(s) source IRI is supplied.
 */
import { isHttpIri } from "@jeswr/solid-chat-interop";
/** Read a string field defensively — returns the trimmed value or undefined. */
function str(v) {
    return typeof v === "string" && v.length > 0 ? v : undefined;
}
/** Read a finite-number field defensively. */
function finiteNum(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
/**
 * Convert a ms-epoch `origin_server_ts` to an ISO-8601 string, or `undefined` for
 * an absent / non-finite / out-of-range value. `new Date(ms).toISOString()` throws
 * (RangeError) for a value outside the representable range, so we guard it — a
 * hostile timestamp drops the field, never aborts the transform.
 */
function tsToIso(v) {
    const ms = finiteNum(v);
    if (ms === undefined)
        return undefined;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()))
        return undefined;
    try {
        return d.toISOString();
    }
    catch {
        return undefined;
    }
}
/** The relation block, when present and an object. */
function relatesTo(event) {
    const r = event.content?.["m.relates_to"];
    return r !== null && typeof r === "object" ? r : undefined;
}
/** The reply target event id, from `m.relates_to['m.in_reply_to'].event_id`. */
function replyTargetEventId(event) {
    const r = relatesTo(event);
    const inReplyTo = r?.["m.in_reply_to"];
    if (inReplyTo === null || typeof inReplyTo !== "object")
        return undefined;
    return str(inReplyTo.event_id);
}
/** The edit target event id, when this event is an `m.replace`. */
function replaceTargetEventId(event) {
    const r = relatesTo(event);
    if (str(r?.rel_type) !== "m.replace")
        return undefined;
    return str(r?.event_id);
}
/** True when the server already returned this event in redacted form. */
function isAlreadyRedacted(event) {
    const u = event.unsigned;
    return u !== null && typeof u === "object" && u.redacted_because !== undefined;
}
/**
 * The Matrix message msgtypes that carry IMPORTABLE TEXT in phase 1. Media
 * msgtypes (`m.image`/`m.file`/`m.audio`/`m.video`/`m.location`) carry a `body`
 * that is only a filename/caption + an `mxc://` URL — importing them as chat text
 * would be misleading, and media import is a deferred phase. We import the standard
 * text-bearing types and treat an UNKNOWN/missing msgtype permissively as text (a
 * future/custom text msgtype should not be silently dropped), while explicitly
 * skipping the known media types.
 */
const TEXT_MSGTYPES = new Set(["m.text", "m.notice", "m.emote"]);
const MEDIA_MSGTYPES = new Set(["m.image", "m.file", "m.audio", "m.video", "m.location"]);
/** True when this msgtype's `body` is importable text in phase 1. */
function isTextMsgtype(msgtype) {
    if (msgtype === undefined)
        return true; // permissive: unknown/missing → treat as text
    if (MEDIA_MSGTYPES.has(msgtype))
        return false; // explicit media → skip in phase 1
    return TEXT_MSGTYPES.has(msgtype) || !msgtype.startsWith("m."); // m.* unknown → skip; custom → keep
}
/**
 * Read the body + formatted body from a message content object, BUT only for a
 * text-bearing msgtype (media msgtypes are skipped in phase 1 — see
 * {@link isTextMsgtype}). For an edit the caller passes `content['m.new_content']`;
 * otherwise the event's own `content`.
 */
function readBody(content) {
    if (content === null || typeof content !== "object")
        return undefined;
    if (!isTextMsgtype(str(content.msgtype)))
        return undefined;
    const body = str(content.body);
    if (body === undefined)
        return undefined;
    const result = { body };
    // Only treat formatted_body as HTML when the format is the conventional HTML one
    // (org.matrix.custom.html); an unknown format is ignored (we keep plain text).
    const fmt = str(content.format);
    const formatted = str(content.formatted_body);
    if (formatted !== undefined && fmt === "org.matrix.custom.html") {
        result.formatted = formatted;
    }
    return result;
}
/** Build the canonical message common to a plain message and an edit's new content. */
function buildCanonical(event, body, ctx, eventId) {
    // SECURITY: a Matrix message body is UNTRUSTED remote content, so it is written
    // as `text/plain` UNCONDITIONALLY — there is deliberately NO caller-supplied
    // media-type override. Labelling untrusted Matrix text as `text/html` (or any
    // HTML-rendered type) would re-open the stored-XSS path for a LongChat reader
    // that renders by media type, so the type is hard-coded here, not configurable.
    // The untrusted `formatted_body` HTML is NEVER written into the pod; it is only
    // surfaced on the RESULT object as `formatted` (clearly untrusted) for a caller
    // that sanitizes + renders it itself.
    const msg = {
        id: ctx.messageIriFor(eventId),
        content: body.body,
        mediaType: "text/plain",
    };
    // Author: only a real http(s) WebID resolved from the Matrix sender; never the
    // bare @user:server (the canonical model filters non-http(s) IRIs).
    const sender = str(event.sender);
    if (sender !== undefined && ctx.webIdFor) {
        const webId = ctx.webIdFor(sender);
        if (isHttpIri(webId))
            msg.author = webId;
    }
    const published = tsToIso(event.origin_server_ts);
    if (published !== undefined)
        msg.published = published;
    // Room IRI (in-pod), only when the resolver yields an http(s) IRI.
    const roomId = str(event.room_id);
    if (roomId !== undefined && ctx.roomIriFor) {
        const roomIri = ctx.roomIriFor(roomId);
        if (isHttpIri(roomIri))
            msg.room = roomIri;
    }
    // Reply edge → the in-pod resource of the replied-to event.
    const replyTo = replyTargetEventId(event);
    if (replyTo !== undefined) {
        const inReplyToIri = ctx.messageIriFor(replyTo);
        if (isHttpIri(inReplyToIri))
            msg.inReplyTo = inReplyToIri;
    }
    // Provenance: record the source IRI honestly when supplied + http(s).
    if (isHttpIri(ctx.derivedFrom)) {
        msg.provenance = { derivedFrom: ctx.derivedFrom };
    }
    return msg;
}
/**
 * Map ONE untrusted Matrix event to a {@link MatrixEventResult}.
 *
 * Pure + total: it NEVER throws on hostile/malformed input — a bad field is
 * dropped and, if nothing mappable remains, a {@link SkipResult} is returned.
 *
 * @param event - a single Matrix CS-API room event (untrusted).
 * @param ctx   - IRI resolvers + import options (see {@link MatrixContext}).
 */
export function matrixEventToCanonical(event, ctx) {
    // Defensive: a non-object event is a hostile/garbage input — skip, never throw.
    if (event === null || typeof event !== "object") {
        return { kind: "skip", reason: "event is not an object" };
    }
    const eventId = str(event.event_id);
    const type = str(event.type);
    // --- Redactions (an explicit m.room.redaction event) ---
    if (type === "m.room.redaction") {
        // The redacted event id is top-level `redacts` (room v1–10) or
        // `content.redacts` (v11+). Read both defensively.
        const target = str(event.redacts) ?? str(event.content?.redacts);
        if (target === undefined) {
            return { kind: "skip", reason: "redaction without a target event id", eventId };
        }
        const result = {
            kind: "redaction",
            eventId: eventId ?? "",
            targetEventId: target,
        };
        const deletedAt = tsToIso(event.origin_server_ts);
        if (deletedAt !== undefined) {
            return { ...result, deletedAt };
        }
        return result;
    }
    // Only m.room.message events become canonical messages. Everything else
    // (m.room.member, m.reaction, state events, …) is skipped.
    if (type !== "m.room.message") {
        return { kind: "skip", reason: `non-message event type: ${type ?? "<missing>"}`, eventId };
    }
    // A message we cannot identify cannot be written to a stable resource — skip.
    if (eventId === undefined) {
        return { kind: "skip", reason: "m.room.message without an event id" };
    }
    // An event the server already returned redacted carries no usable body; we
    // surface it as a redaction tombstone on its own resource (right-to-be-forgotten
    // on re-sync), not as a message.
    if (isAlreadyRedacted(event)) {
        const result = {
            kind: "redaction",
            eventId,
            targetEventId: eventId,
        };
        const deletedAt = tsToIso(event.unsigned?.redacted_because?.origin_server_ts);
        return deletedAt !== undefined ? { ...result, deletedAt } : result;
    }
    // --- Edits (m.replace) — fold the new content onto the target ---
    const editTarget = replaceTargetEventId(event);
    if (editTarget !== undefined) {
        // The replacement body lives in m.new_content; fall back to the event's own
        // body if m.new_content is absent/malformed (a permissive edit). If neither
        // yields a body, skip rather than write an empty edit.
        const body = readBody(event.content?.["m.new_content"]) ?? readBody(event.content);
        if (body === undefined) {
            return { kind: "skip", reason: "edit (m.replace) without a usable new body", eventId };
        }
        const message = buildCanonical(event, body, ctx, editTarget);
        // The edit's own resource id is the edit event; but the message it represents
        // is the NEW state of the target, so its `id` is the target resource.
        const result = {
            kind: "replace",
            eventId,
            targetEventId: editTarget,
            message,
        };
        const sender = str(event.sender);
        return {
            ...result,
            ...(sender !== undefined ? { matrixSender: sender } : {}),
            ...(body.formatted !== undefined ? { formatted: body.formatted } : {}),
        };
    }
    // --- A plain message ---
    const body = readBody(event.content);
    if (body === undefined) {
        // No usable body — e.g. an m.image/m.file with no body text, or a malformed
        // content. Phase 1 is text import; skip non-text payloads (a follow-up can map
        // media to attachment metadata).
        return { kind: "skip", reason: "message without a usable text body", eventId };
    }
    const message = buildCanonical(event, body, ctx, eventId);
    const result = { kind: "message", eventId, message };
    const sender = str(event.sender);
    return {
        ...result,
        ...(sender !== undefined ? { matrixSender: sender } : {}),
        ...(body.formatted !== undefined ? { formatted: body.formatted } : {}),
    };
}
//# sourceMappingURL=transform.js.map