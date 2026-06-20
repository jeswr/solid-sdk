// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Real-shaped Matrix CS-API event fixtures for the pure-transform tests. These are
 * authored to match the spec wire JSON (spec.matrix.org v1.11) — a plain message, a
 * reply, an edit (`m.replace`), a redaction event, an already-redacted message, an
 * `m.image`, a non-message (`m.room.member`) event, and a hostile/malformed event.
 *
 * They are TYPED as {@link MatrixEvent} so the typecheck covers them; the transform
 * reads them defensively (the hostile fixture deliberately violates field types,
 * via an `as` cast, to prove the transform drops fields rather than throwing).
 */

import type { MatrixEvent } from "../../src/matrix.js";

/** A plain text message. */
export const plainMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$plain1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_000_000,
  content: {
    msgtype: "m.text",
    body: "Hello, world!",
  },
};

/** A message with an HTML formatted body. */
export const htmlMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$html1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_001_000,
  content: {
    msgtype: "m.text",
    body: "Bold text",
    format: "org.matrix.custom.html",
    formatted_body: "<strong>Bold text</strong>",
  },
};

/** A reply to {@link plainMessage}. */
export const replyMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$reply1:example.org",
  sender: "@bob:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_002_000,
  content: {
    msgtype: "m.text",
    body: "> Hello, world!\n\nHi Alice!",
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: "$plain1:example.org",
      },
    },
  },
};

/** An edit (m.replace) of {@link plainMessage}. */
export const editMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$edit1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_003_000,
  content: {
    msgtype: "m.text",
    // The top-level body of an edit event is the "* edited" fallback per the spec.
    body: "* Hello, world (edited)!",
    "m.new_content": {
      msgtype: "m.text",
      body: "Hello, world (edited)!",
    },
    "m.relates_to": {
      rel_type: "m.replace",
      event_id: "$plain1:example.org",
    },
  },
};

/** An explicit redaction event targeting {@link plainMessage} (room v1–10 shape). */
export const redactionEvent: MatrixEvent = {
  type: "m.room.redaction",
  event_id: "$redact1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_004_000,
  redacts: "$plain1:example.org",
  content: {
    reason: "spam",
  } as MatrixEvent["content"],
};

/** A redaction event using the room-v11 `content.redacts` placement. */
export const redactionEventV11: MatrixEvent = {
  type: "m.room.redaction",
  event_id: "$redact2:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_005_000,
  content: {
    redacts: "$reply1:example.org",
  } as MatrixEvent["content"],
};

/** A message the server already returned redacted (carries unsigned.redacted_because). */
export const alreadyRedactedMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$wasredacted:example.org",
  sender: "@carol:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_006_000,
  content: {},
  unsigned: {
    redacted_because: {
      type: "m.room.redaction",
      event_id: "$redact3:example.org",
      sender: "@carol:example.org",
      origin_server_ts: 1_700_000_006_500,
      redacts: "$wasredacted:example.org",
    },
  },
};

/** An image message (no usable text body in phase 1 → skipped). */
export const imageMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$image1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_007_000,
  content: {
    msgtype: "m.image",
    body: "screenshot.png",
    url: "mxc://example.org/abc123",
  } as MatrixEvent["content"],
};

/** A non-message state event (membership) → must be skipped. */
export const memberEvent: MatrixEvent = {
  type: "m.room.member",
  event_id: "$member1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_008_000,
  content: {
    membership: "join",
    displayname: "Alice",
  } as MatrixEvent["content"],
};

/**
 * A HOSTILE / malformed event: wrong-typed fields everywhere (numeric body, object
 * sender, string ts, a `javascript:` would-be IRI in a reply target, a non-object
 * relates_to). The transform must DROP every bad field — never throw. Cast through
 * `unknown` because it deliberately violates the {@link MatrixEvent} field types.
 */
export const hostileEvent: MatrixEvent = {
  type: "m.room.message",
  event_id: "$hostile1:example.org",
  sender: { not: "a string" },
  room_id: 12345,
  origin_server_ts: "not-a-number",
  content: {
    msgtype: 99,
    body: { evil: true },
    format: "org.matrix.custom.html",
    formatted_body: ["array", "body"],
    "m.relates_to": "i am not an object",
  },
} as unknown as MatrixEvent;

/** A hostile event whose body IS a string but whose reply target is garbage. */
export const hostileReply: MatrixEvent = {
  type: "m.room.message",
  event_id: "$hostile2:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_009_000,
  content: {
    msgtype: "m.text",
    body: "real body, garbage reply target",
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: { not: "a string" },
      },
    },
  } as unknown as MatrixEvent["content"],
};

/** An out-of-range timestamp that would make new Date().toISOString() throw. */
export const insaneTimestampMessage: MatrixEvent = {
  type: "m.room.message",
  event_id: "$ts1:example.org",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1e30,
  content: {
    msgtype: "m.text",
    body: "timestamp from the far future",
  },
};

/** A message missing an event_id → cannot be written to a stable resource → skip. */
export const noIdMessage: MatrixEvent = {
  type: "m.room.message",
  sender: "@alice:example.org",
  room_id: "!room:example.org",
  origin_server_ts: 1_700_000_010_000,
  content: {
    msgtype: "m.text",
    body: "no id here",
  },
};
