// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Exhaustive fixture tests for the PURE Matrix→canonical transform — the heart of
 * the package. Every Matrix shape the importer must handle is covered: a plain
 * message, an HTML message, a reply, an edit (m.replace), a redaction (both v1–10
 * and v11 placement), an already-redacted message, an m.image (skip), a non-message
 * (skip), and hostile/malformed events (drop fields, never throw).
 */

import { describe, expect, it } from "vitest";
import {
  alreadyRedactedMessage,
  editMessage,
  hostileEvent,
  hostileReply,
  htmlMessage,
  imageMessage,
  insaneTimestampMessage,
  memberEvent,
  noIdMessage,
  plainMessage,
  redactionEvent,
  redactionEventV11,
  replyMessage,
} from "../test/fixtures/events.js";
import type { MatrixEvent } from "./matrix.js";
import { type MatrixContext, matrixEventToCanonical } from "./transform.js";

const POD = "https://alice.pod.example/chat/matrix/";

/** A deterministic in-pod IRI for an event id. */
const messageIriFor = (eventId: string) =>
  `${POD}m-${eventId.replace(/[^A-Za-z0-9._-]/g, "_")}.ttl#it`;

/** Resolve known Matrix users to WebIDs; everyone else is unknown. */
const WEBIDS: Record<string, string> = {
  "@alice:example.org": "https://alice.pod.example/profile/card#me",
  "@bob:example.org": "https://bob.pod.example/profile/card#me",
};
const webIdFor = (matrixUserId: string) => WEBIDS[matrixUserId];

const ctx: MatrixContext = {
  messageIriFor,
  webIdFor,
  roomIriFor: () => POD,
  derivedFrom: "https://matrix.example.org",
};

describe("matrixEventToCanonical — plain message", () => {
  it("maps body, sender→WebID, ts→published, room, and provenance", () => {
    const r = matrixEventToCanonical(plainMessage, ctx);
    expect(r.kind).toBe("message");
    if (r.kind !== "message") return;
    expect(r.eventId).toBe("$plain1:example.org");
    expect(r.matrixSender).toBe("@alice:example.org");
    expect(r.message.content).toBe("Hello, world!");
    expect(r.message.mediaType).toBe("text/plain");
    expect(r.message.author).toBe("https://alice.pod.example/profile/card#me");
    expect(r.message.published).toBe(new Date(1_700_000_000_000).toISOString());
    expect(r.message.room).toBe(POD);
    expect(r.message.id).toBe(messageIriFor("$plain1:example.org"));
    expect(r.message.provenance?.derivedFrom).toBe("https://matrix.example.org");
  });

  it("leaves author UNSET for an unknown sender (never fabricates a WebID)", () => {
    const r = matrixEventToCanonical({ ...plainMessage, sender: "@stranger:example.org" }, ctx);
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.author).toBeUndefined();
    // the raw matrix id is preserved for audit, but never as an RDF IRI
    expect(r.matrixSender).toBe("@stranger:example.org");
  });

  it("leaves author UNSET when no webIdFor resolver is supplied", () => {
    const r = matrixEventToCanonical(plainMessage, { messageIriFor });
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.author).toBeUndefined();
  });

  it("drops a non-http(s) WebID returned by the resolver", () => {
    const r = matrixEventToCanonical(plainMessage, {
      messageIriFor,
      webIdFor: () => "mailto:alice@example.org",
    });
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.author).toBeUndefined();
  });
});

describe("matrixEventToCanonical — HTML message", () => {
  it("uses formatted_body + text/html when format is org.matrix.custom.html", () => {
    const r = matrixEventToCanonical(htmlMessage, ctx);
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.content).toBe("<strong>Bold text</strong>");
    expect(r.message.mediaType).toBe("text/html");
    expect(r.formatted).toBe("<strong>Bold text</strong>");
  });

  it("ignores formatted_body when the format is unknown (keeps plain text)", () => {
    const r = matrixEventToCanonical(
      { ...htmlMessage, content: { ...htmlMessage.content, format: "text/markdown" } },
      ctx,
    );
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.content).toBe("Bold text");
    expect(r.message.mediaType).toBe("text/plain");
    expect(r.formatted).toBeUndefined();
  });
});

describe("matrixEventToCanonical — reply", () => {
  it("maps m.in_reply_to.event_id to inReplyTo (the in-pod resource)", () => {
    const r = matrixEventToCanonical(replyMessage, ctx);
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.inReplyTo).toBe(messageIriFor("$plain1:example.org"));
    expect(r.message.author).toBe("https://bob.pod.example/profile/card#me");
  });
});

describe("matrixEventToCanonical — edit (m.replace)", () => {
  it("returns a replace result with the new content and the target id", () => {
    const r = matrixEventToCanonical(editMessage, ctx);
    expect(r.kind).toBe("replace");
    if (r.kind !== "replace") return;
    expect(r.eventId).toBe("$edit1:example.org");
    expect(r.targetEventId).toBe("$plain1:example.org");
    // the NEW content (m.new_content), NOT the "* edited" fallback body
    expect(r.message.content).toBe("Hello, world (edited)!");
    // the canonical id is the TARGET resource (the message being replaced)
    expect(r.message.id).toBe(messageIriFor("$plain1:example.org"));
  });

  it("falls back to the event body when m.new_content is absent", () => {
    const noNewContent: MatrixEvent = {
      ...editMessage,
      content: {
        msgtype: "m.text",
        body: "fallback body",
        "m.relates_to": { rel_type: "m.replace", event_id: "$plain1:example.org" },
      },
    };
    const r = matrixEventToCanonical(noNewContent, ctx);
    if (r.kind !== "replace") throw new Error("expected replace");
    expect(r.message.content).toBe("fallback body");
  });

  it("skips an edit with no usable body anywhere", () => {
    const empty: MatrixEvent = {
      ...editMessage,
      content: { "m.relates_to": { rel_type: "m.replace", event_id: "$plain1:example.org" } },
    };
    const r = matrixEventToCanonical(empty, ctx);
    expect(r.kind).toBe("skip");
  });
});

describe("matrixEventToCanonical — redaction", () => {
  it("maps m.room.redaction (top-level redacts) to a redaction tombstone", () => {
    const r = matrixEventToCanonical(redactionEvent, ctx);
    expect(r.kind).toBe("redaction");
    if (r.kind !== "redaction") return;
    expect(r.targetEventId).toBe("$plain1:example.org");
    expect(r.deletedAt).toBe(new Date(1_700_000_004_000).toISOString());
  });

  it("maps the room-v11 content.redacts placement", () => {
    const r = matrixEventToCanonical(redactionEventV11, ctx);
    if (r.kind !== "redaction") throw new Error("expected redaction");
    expect(r.targetEventId).toBe("$reply1:example.org");
  });

  it("skips a redaction with no target", () => {
    const r = matrixEventToCanonical({ type: "m.room.redaction", event_id: "$r:example.org" }, ctx);
    expect(r.kind).toBe("skip");
  });

  it("treats an already-redacted message as a self-tombstone", () => {
    const r = matrixEventToCanonical(alreadyRedactedMessage, ctx);
    if (r.kind !== "redaction") throw new Error("expected redaction");
    expect(r.targetEventId).toBe("$wasredacted:example.org");
    expect(r.deletedAt).toBe(new Date(1_700_000_006_500).toISOString());
  });
});

describe("matrixEventToCanonical — skips", () => {
  it("skips an m.image (no text body in phase 1)", () => {
    const r = matrixEventToCanonical(imageMessage, ctx);
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.eventId).toBe("$image1:example.org");
  });

  it("skips a non-message event (m.room.member)", () => {
    const r = matrixEventToCanonical(memberEvent, ctx);
    expect(r.kind).toBe("skip");
  });

  it("skips a message with no event id", () => {
    const r = matrixEventToCanonical(noIdMessage, ctx);
    expect(r.kind).toBe("skip");
  });
});

describe("matrixEventToCanonical — hostile / malformed (drop fields, never throw)", () => {
  it("does not throw and drops every bad field on a hostile event", () => {
    let r!: ReturnType<typeof matrixEventToCanonical>;
    expect(() => {
      r = matrixEventToCanonical(hostileEvent, ctx);
    }).not.toThrow();
    // body is an object → no usable body → skip
    expect(r.kind).toBe("skip");
  });

  it("keeps a valid body but drops a garbage reply target", () => {
    const r = matrixEventToCanonical(hostileReply, ctx);
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.content).toBe("real body, garbage reply target");
    expect(r.message.inReplyTo).toBeUndefined();
  });

  it("drops an out-of-range timestamp rather than throwing", () => {
    const r = matrixEventToCanonical(insaneTimestampMessage, ctx);
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.published).toBeUndefined();
    expect(r.message.content).toBe("timestamp from the far future");
  });

  it("does not throw on a null / non-object event", () => {
    expect(() => matrixEventToCanonical(null as unknown as MatrixEvent, ctx)).not.toThrow();
    expect(matrixEventToCanonical(null as unknown as MatrixEvent, ctx).kind).toBe("skip");
    expect(matrixEventToCanonical(42 as unknown as MatrixEvent, ctx).kind).toBe("skip");
  });

  it("does not set room when roomIriFor yields a non-http(s) value", () => {
    const r = matrixEventToCanonical(plainMessage, {
      messageIriFor,
      webIdFor,
      roomIriFor: () => "urn:room:1",
    });
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.room).toBeUndefined();
  });

  it("does not set provenance when derivedFrom is not http(s)", () => {
    const r = matrixEventToCanonical(plainMessage, {
      messageIriFor,
      derivedFrom: "ftp://nope",
    });
    if (r.kind !== "message") throw new Error("expected message");
    expect(r.message.provenance).toBeUndefined();
  });
});
