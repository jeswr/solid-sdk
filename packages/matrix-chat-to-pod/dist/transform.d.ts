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
 *  - `content.body` (plain text) → `content`, written ALWAYS as `text/plain`. The
 *    untrusted `content.formatted_body` (HTML) is NEVER written into the pod (it
 *    would be a stored-XSS vector for an HTML-rendering LongChat reader); it is only
 *    surfaced on the transform RESULT as `formatted` (clearly untrusted) for a
 *    caller that sanitizes + renders it itself. For an EDIT, the replacement body is
 *    read from `content['m.new_content']` (per the spec, the top-level body of an
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
import type { CanonicalMessage } from "@jeswr/solid-chat-interop";
import type { MatrixEvent } from "./matrix.js";
/**
 * Context the transform needs to mint IN-POD IRIs and (optionally) resolve a
 * Matrix sender to a real WebID. All resolvers are PURE functions the caller
 * supplies; the transform itself mints nothing and does no I/O.
 */
export interface MatrixContext {
    /**
     * Map a Matrix `event_id` (`$...`) to the in-pod resource IRI the imported
     * message lives at. Used both for the message's own `id` and to resolve a
     * reply/edit/redaction target to its in-pod resource. MUST be a stable,
     * deterministic, collision-free function of the event id (so re-sync overwrites
     * the same resource and edits/redactions land on the right one).
     */
    readonly messageIriFor: (eventId: string) => string;
    /** Map a Matrix `room_id` (`!room:server`) to the in-pod room/container IRI. */
    readonly roomIriFor?: (roomId: string) => string | undefined;
    /**
     * Resolve a Matrix sender (`@user:server`) to a real http(s) WebID, or
     * `undefined` when none is known. NEVER fabricate a WebID from the Matrix id —
     * returning `undefined` is correct and leaves the author unset (honest absence
     * beats a fake link). A non-http(s) return is filtered by the canonical model.
     */
    readonly webIdFor?: (matrixUserId: string) => string | undefined;
    /**
     * An http(s) source IRI to record as `prov:wasDerivedFrom` on every imported
     * message (e.g. a homeserver/event permalink base, or the bridge id). Optional;
     * dropped if not http(s).
     */
    readonly derivedFrom?: string;
}
/** A canonical message produced from an `m.room.message`. */
export interface MessageResult {
    readonly kind: "message";
    /** The Matrix event id this message came from (always present here). */
    readonly eventId: string;
    /** The raw Matrix sender id (`@user:server`), preserved for audit — NOT an RDF IRI. */
    readonly matrixSender?: string;
    /** The canonical message ready to write via `@jeswr/solid-chat-interop`. */
    readonly message: CanonicalMessage;
    /** The richer (e.g. HTML) body, when the event carried a `formatted_body`. */
    readonly formatted?: string;
}
/** An EDIT (`m.replace`): apply the new content + a `dct:isReplacedBy` edge to the target. */
export interface ReplaceResult {
    readonly kind: "replace";
    /** The Matrix event id of the EDIT event itself. */
    readonly eventId: string;
    /** The Matrix event id of the ORIGINAL message being replaced. */
    readonly targetEventId: string;
    /** The replacement canonical message (its `m.new_content` body, new stamps). */
    readonly message: CanonicalMessage;
    readonly matrixSender?: string;
    readonly formatted?: string;
}
/** A REDACTION (`m.room.redaction`): tombstone the target with `schema:dateDeleted`. */
export interface RedactionResult {
    readonly kind: "redaction";
    /** The Matrix event id of the redaction event. */
    readonly eventId: string;
    /** The Matrix event id being redacted. */
    readonly targetEventId: string;
    /** The redaction timestamp (ISO-8601), when known. */
    readonly deletedAt?: string;
}
/** A SKIP — a non-message, unmappable, or hostile event the importer ignores. */
export interface SkipResult {
    readonly kind: "skip";
    /** Why it was skipped (for logging/diagnostics; never throws). */
    readonly reason: string;
    /** The Matrix event id, when one was present. */
    readonly eventId?: string;
}
/** The result of mapping one Matrix event. */
export type MatrixEventResult = MessageResult | ReplaceResult | RedactionResult | SkipResult;
/**
 * Map ONE untrusted Matrix event to a {@link MatrixEventResult}.
 *
 * Pure + total: it NEVER throws on hostile/malformed input — a bad field is
 * dropped and, if nothing mappable remains, a {@link SkipResult} is returned.
 *
 * @param event - a single Matrix CS-API room event (untrusted).
 * @param ctx   - IRI resolvers + import options (see {@link MatrixContext}).
 */
export declare function matrixEventToCanonical(event: MatrixEvent, ctx: MatrixContext): MatrixEventResult;
//# sourceMappingURL=transform.d.ts.map