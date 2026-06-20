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
export {};
//# sourceMappingURL=matrix.js.map