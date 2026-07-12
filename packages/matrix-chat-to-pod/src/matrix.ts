// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Matrix Client-Server API event SHAPES — the untrusted wire types this package
 * reads.
 *
 * These mirror the Matrix CS API (spec.matrix.org) room-event JSON exactly enough
 * to map a message into the canonical chat model. Every field is OPTIONAL and
 * `unknown`-leaning on purpose: a homeserver (or a bridged event from
 * mautrix/Beeper) is UNTRUSTED input, so the transform never assumes a field is
 * present or well-typed — it reads defensively and DROPS anything malformed rather
 * than throwing (see {@link ./transform.matrixEventToCanonical}).
 *
 * Reference: Matrix CS API v1.11 — `m.room.message` (msgtypes m.text/m.notice/
 * m.emote/m.image/m.file/…), `m.relates_to` (rel_type `m.replace` for an edit;
 * `m.in_reply_to` for a reply), and `m.room.redaction` (a redacted event carries a
 * top-level `redacts` in room versions 1–10, or `content.redacts` in v11+, and
 * arrives with `unsigned.redacted_because`).
 */

/** The `m.relates_to.m.in_reply_to` object on a reply event. */
export interface MatrixInReplyTo {
  readonly event_id?: unknown;
  readonly [k: string]: unknown;
}

/** The `content['m.relates_to']` object — carries reply + edit (m.replace) relations. */
export interface MatrixRelatesTo {
  /** `m.replace` for an edit; other rel types are ignored by this package. */
  readonly rel_type?: unknown;
  /** The target event id of a relation (e.g. the edited/replaced event). */
  readonly event_id?: unknown;
  /** The reply relation, nested under the literal `m.in_reply_to` key. */
  readonly "m.in_reply_to"?: MatrixInReplyTo;
  readonly [k: string]: unknown;
}

/** The `content` of an `m.room.message` (and, for an edit, its `m.new_content`). */
export interface MatrixMessageContent {
  /** e.g. `m.text`, `m.notice`, `m.emote`, `m.image`, `m.file`, `m.audio`, `m.video`. */
  readonly msgtype?: unknown;
  /** The plain-text body. */
  readonly body?: unknown;
  /** A formatting type, conventionally `org.matrix.custom.html`. */
  readonly format?: unknown;
  /** The formatted (e.g. HTML) body, when `format` is set. */
  readonly formatted_body?: unknown;
  /** The relation block (reply / edit). */
  readonly "m.relates_to"?: MatrixRelatesTo;
  /** For an edit event, the replacement content. */
  readonly "m.new_content"?: MatrixMessageContent;
  readonly [k: string]: unknown;
}

/** The `unsigned` block; relevant here for a redacted event's tombstone. */
export interface MatrixUnsigned {
  /** Present on an event the server returned in redacted form. */
  readonly redacted_because?: MatrixEvent;
  readonly [k: string]: unknown;
}

/**
 * A single Matrix room event as returned by `/sync` or `/rooms/{id}/messages`.
 * UNTRUSTED — read every field defensively.
 */
export interface MatrixEvent {
  /** The event type, e.g. `m.room.message`, `m.room.redaction`, `m.room.member`. */
  readonly type?: unknown;
  /** The globally-unique event id (`$...`). */
  readonly event_id?: unknown;
  /** The full Matrix user id of the author (`@user:server`). */
  readonly sender?: unknown;
  /** The room this event belongs to (`!room:server`). May be omitted by `/messages`. */
  readonly room_id?: unknown;
  /** Origin server send time, milliseconds since the Unix epoch. */
  readonly origin_server_ts?: unknown;
  /** The event content. */
  readonly content?: MatrixMessageContent;
  /** For an `m.room.redaction`, the event id being redacted (room versions 1–10). */
  readonly redacts?: unknown;
  /** Server-computed metadata; carries `redacted_because` for a redacted event. */
  readonly unsigned?: MatrixUnsigned;
  readonly [k: string]: unknown;
}

/** The JSON body of `GET /_matrix/client/v3/rooms/{roomId}/messages`. */
export interface MatrixMessagesResponse {
  /** The events, newest-first when paging backwards (`dir=b`). */
  readonly chunk?: readonly MatrixEvent[];
  /** A pagination token for the start of the returned chunk. */
  readonly start?: unknown;
  /**
   * A pagination token for the end of the returned chunk; pass it as the next
   * `from`. ABSENT (or unchanged) ⇒ no more events in that direction.
   */
  readonly end?: unknown;
  /** Room state relevant to the returned events. */
  readonly state?: readonly MatrixEvent[];
  readonly [k: string]: unknown;
}
