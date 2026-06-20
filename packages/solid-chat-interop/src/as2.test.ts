// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * AS2.0 dataset-level round-trip (build → parse on the SAME store), including id,
 * the full canonical model, and edit/delete fields. Exercises the typed accessors
 * directly (no serialization hop).
 */
import { describe, expect, it } from "vitest";
import { buildAs2Message, parseAs2Message } from "./as2.js";
import type { CanonicalMessage } from "./canonical.js";

const SUBJECT = "https://alice.example/chat/r/m.ttl#it";
const ALICE = "https://alice.example/profile/card#me";
const ROOM = "https://alice.example/chat/r/index.ttl#this";
const PREV = "https://alice.example/chat/r/m0.ttl#it";
const NEXT = "https://alice.example/chat/r/m2.ttl#it";

describe("AS2.0 dataset round-trip", () => {
  it("preserves the full canonical model build → parse", () => {
    const msg: CanonicalMessage = {
      content: "full message",
      mediaType: "text/markdown",
      author: ALICE,
      published: "2026-06-20T08:00:00.000Z",
      room: ROOM,
      inReplyTo: PREV,
      replacedBy: NEXT,
      deletedAt: "2026-06-20T09:00:00.000Z",
      provenance: { derivedFrom: "https://import.example/x" },
      task: { state: "closed", title: "T", assignee: ALICE },
    };
    const store = buildAs2Message(SUBJECT, msg);
    const parsed = parseAs2Message(SUBJECT, store);
    expect(parsed).toBeDefined();
    expect(parsed?.id).toBe(SUBJECT);
    expect(parsed?.content).toBe("full message");
    expect(parsed?.mediaType).toBe("text/markdown");
    expect(parsed?.author).toBe(ALICE);
    expect(parsed?.published).toBe("2026-06-20T08:00:00.000Z");
    expect(parsed?.room).toBe(ROOM);
    expect(parsed?.inReplyTo).toBe(PREV);
    expect(parsed?.replacedBy).toBe(NEXT);
    expect(parsed?.deletedAt).toBe("2026-06-20T09:00:00.000Z");
    expect(parsed?.provenance).toEqual({ derivedFrom: "https://import.example/x" });
    expect(parsed?.task).toEqual({ state: "closed", title: "T", assignee: ALICE });
  });

  it("defaults mediaType to text/plain and published to now when omitted", () => {
    const store = buildAs2Message(SUBJECT, { content: "x", mediaType: "" });
    const parsed = parseAs2Message(SUBJECT, store);
    expect(parsed?.mediaType).toBe("text/plain");
    expect(parsed?.published).toBeDefined();
  });

  it("omits absent optional fields (no empty provenance/task)", () => {
    const store = buildAs2Message(SUBJECT, { content: "x", mediaType: "text/plain" });
    const parsed = parseAs2Message(SUBJECT, store);
    expect(parsed?.author).toBeUndefined();
    expect(parsed?.room).toBeUndefined();
    expect(parsed?.provenance).toBeUndefined();
    expect(parsed?.task).toBeUndefined();
  });

  it("returns undefined for a subject that is not an as:Note", () => {
    const store = buildAs2Message(SUBJECT, { content: "x", mediaType: "text/plain" });
    expect(parseAs2Message("https://other.example/x#it", store)).toBeUndefined();
  });
});
