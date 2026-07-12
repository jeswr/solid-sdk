// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildMessage,
  type ChatMessage,
  MessageDoc,
  messageSubject,
  parseMessage,
} from "./message.js";
import { serializeTurtle } from "./rdf-io.js";
import { turtleToStore } from "./test-helpers.js";
import { AS_CLASS, PREFIXES, WF_CLASS } from "./vocab.js";

const RES = "https://alice.pod/pod-chat/messages/m1.ttl";
const SUBJ = `${RES}#it`;
const ALICE = "https://alice.pod/profile/card#me";
const BOB = "https://bob.pod/profile/card#me";
const ROOM = "https://alice.pod/pod-chat/rooms/general.ttl#it";

describe("messageSubject", () => {
  it("appends #it to the resource URL", () => {
    expect(messageSubject(RES)).toBe(SUBJ);
  });
});

describe("buildMessage → parseMessage round-trip", () => {
  it("round-trips a plain chat note", () => {
    const now = new Date("2026-06-15T10:00:00.000Z");
    const store = buildMessage(RES, {
      content: "hello world",
      author: ALICE,
      room: ROOM,
      now,
    });
    const parsed = parseMessage(RES, store) as ChatMessage;
    expect(parsed.content).toBe("hello world");
    expect(parsed.mediaType).toBe("text/plain");
    expect(parsed.author).toBe(ALICE);
    expect(parsed.room).toBe(ROOM);
    expect(parsed.published).toBe("2026-06-15T10:00:00.000Z");
    expect(parsed.inReplyTo).toBeUndefined();
    expect(parsed.task).toBeUndefined();
  });

  it("honours an explicit media type and a reply link", () => {
    const store = buildMessage(RES, {
      content: "# heading",
      mediaType: "text/markdown",
      inReplyTo: `${ROOM.replace("#it", "")}`,
      now: new Date("2026-06-15T10:00:00.000Z"),
    });
    const parsed = parseMessage(RES, store) as ChatMessage;
    expect(parsed.mediaType).toBe("text/markdown");
    expect(parsed.inReplyTo).toBe(ROOM.replace("#it", ""));
  });

  it("falls back to text/plain when the media type is blank/whitespace", () => {
    const store = buildMessage(RES, { content: "x", mediaType: "   " });
    expect((parseMessage(RES, store) as ChatMessage).mediaType).toBe("text/plain");
  });

  it("prefers an explicit published date over now", () => {
    const published = new Date("2020-01-01T00:00:00.000Z");
    const store = buildMessage(RES, {
      content: "x",
      published,
      now: new Date("2026-06-15T10:00:00.000Z"),
    });
    expect((parseMessage(RES, store) as ChatMessage).published).toBe("2020-01-01T00:00:00.000Z");
  });

  it("stamps now when neither published nor now is given", () => {
    const before = Date.now();
    const store = buildMessage(RES, { content: "x" });
    const after = Date.now();
    const ts = new Date((parseMessage(RES, store) as ChatMessage).published as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("actionable messages (the shared wf:Task overlay)", () => {
  it("round-trips an open task with title + assignee", () => {
    const store = buildMessage(RES, {
      content: "could you review the PR?",
      author: ALICE,
      task: { state: "open", title: "Review PR", assignee: BOB },
      now: new Date("2026-06-15T10:00:00.000Z"),
    });
    const parsed = parseMessage(RES, store) as ChatMessage;
    expect(parsed.task).toEqual({ state: "open", title: "Review PR", assignee: BOB });
  });

  it("round-trips a closed task", () => {
    const store = buildMessage(RES, {
      content: "done",
      task: { state: "closed", title: "Review PR", assignee: BOB },
    });
    expect((parseMessage(RES, store) as ChatMessage).task?.state).toBe("closed");
  });

  it("types the SAME subject both as:Note AND wf:Task (cross-app discovery)", () => {
    const store = buildMessage(RES, {
      content: "x",
      task: { state: "open" },
    });
    const doc = new MessageDoc(SUBJ, store, DataFactory);
    expect(doc.types.has(AS_CLASS.Note)).toBe(true);
    expect(doc.types.has(WF_CLASS.Task)).toBe(true);
    expect(doc.types.has(WF_CLASS.Open)).toBe(true);
  });

  it("omits the task overlay entirely when no task is supplied", async () => {
    const store = buildMessage(RES, { content: "x" });
    const ttl = await serializeTurtle(store, PREFIXES);
    expect(ttl).not.toContain("wf:Task");
    expect(ttl).not.toContain("flow#Task");
  });

  it("serialises an actionable note through n3.Writer with shared-task prefixes", async () => {
    const store = buildMessage(RES, {
      content: "x",
      task: { state: "open", title: "T", assignee: BOB },
    });
    const ttl = await serializeTurtle(store, PREFIXES);
    expect(ttl).toContain("as:Note");
    expect(ttl).toContain("wf:Task");
    expect(ttl).toContain("wf:Open");
    expect(ttl).toContain("wf:assignee");
    expect(ttl).toContain("dct:title");
  });
});

describe("parseMessage edge cases", () => {
  it("returns undefined for a resource that is not an as:Note", () => {
    const store = turtleToStore(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> . <#it> as:content "orphan" .`,
      RES,
    );
    expect(parseMessage(RES, store)).toBeUndefined();
  });

  it("returns undefined for an empty dataset", () => {
    expect(parseMessage(RES, turtleToStore("", RES))).toBeUndefined();
  });

  it("defaults missing content to the empty string", () => {
    const store = turtleToStore(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> . <#it> a as:Note .`,
      RES,
    );
    const parsed = parseMessage(RES, store) as ChatMessage;
    expect(parsed.content).toBe("");
    expect(parsed.mediaType).toBe("text/plain");
  });

  it("reads a task overlay parsed from raw Turtle", () => {
    const store = turtleToStore(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> .
       @prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
       @prefix dct: <http://purl.org/dc/terms/> .
       <#it> a as:Note, wf:Task, wf:Open ;
             as:content "x" ;
             dct:title "Do the thing" ;
             wf:assignee <${BOB}> .`,
      RES,
    );
    const parsed = parseMessage(RES, store) as ChatMessage;
    expect(parsed.task).toEqual({ state: "open", title: "Do the thing", assignee: BOB });
  });

  it("treats a malformed note typed both wf:Open and wf:Closed as closed (safe read)", () => {
    const store = turtleToStore(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> .
       @prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
       <#it> a as:Note, wf:Task, wf:Open, wf:Closed ; as:content "x" .`,
      RES,
    );
    expect((parseMessage(RES, store) as ChatMessage).task?.state).toBe("closed");
  });
});
