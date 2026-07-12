// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { channelToAs2, messageToAs2, threadToAs2 } from "../src/activitystreams.js";
import type { CommunityChannel, CommunityMessage, CommunityThread } from "../src/types.js";

const MESSAGE: CommunityMessage = {
  id: "discourse:p:1",
  source: "discourse",
  author: "Alice",
  authorId: "alice",
  body: "hello world",
  createdAt: "2026-01-01T00:00:00.000Z",
  permalink: "https://forum.solidproject.org/t/x/1/1",
};

describe("messageToAs2", () => {
  it("maps a message to an as:Note", () => {
    const note = messageToAs2(MESSAGE);
    expect(note["@context"]).toBe("https://www.w3.org/ns/activitystreams");
    expect(note.type).toBe("Note");
    expect(note.id).toBe(MESSAGE.permalink);
    expect(note.content).toBe("hello world");
    expect(note.published).toBe("2026-01-01T00:00:00.000Z");
    expect(note["https://w3id.org/jeswr/community#source"]).toBe("discourse");
    expect(note.attributedTo).toMatchObject({
      type: "Person",
      name: "Alice",
      preferredUsername: "alice",
    });
  });

  it("uses HTML content + summary when bodyHtml present", () => {
    const note = messageToAs2({ ...MESSAGE, bodyHtml: "<p>hello world</p>" });
    expect(note.mediaType).toBe("text/html");
    expect(note.content).toBe("<p>hello world</p>");
    expect(note.summary).toBe("hello world");
  });
});

describe("threadToAs2", () => {
  it("maps a thread to an as:Collection of notes", () => {
    const thread: CommunityThread = {
      id: "discourse:t:1",
      source: "discourse",
      title: "A topic",
      channelId: "discourse:1",
      lastActivityAt: "2026-01-02T00:00:00.000Z",
      messageCount: 2,
      permalink: "https://forum.solidproject.org/t/x/1",
      messages: [MESSAGE],
    };
    const coll = threadToAs2(thread);
    expect(coll.type).toBe("Collection");
    expect(coll.name).toBe("A topic");
    expect(coll.totalItems).toBe(2);
    expect((coll.items as unknown[]).length).toBe(1);
  });

  it("defaults totalItems to item count when messageCount missing", () => {
    const coll = threadToAs2({
      id: "matrix:!r",
      source: "matrix",
      title: "Room",
      channelId: "!r",
      lastActivityAt: "2026-01-02T00:00:00.000Z",
      permalink: "https://matrix.to/#/!r",
      messages: [MESSAGE, MESSAGE],
    });
    expect(coll.totalItems).toBe(2);
  });
});

describe("channelToAs2", () => {
  it("maps a channel to an as:Collection of threads with optional summary", () => {
    const channel: CommunityChannel = {
      id: "discourse:1",
      source: "discourse",
      name: "General",
      topic: "the topic",
      permalink: "https://forum.solidproject.org/c/general/1",
      threads: [],
    };
    const coll = channelToAs2(channel);
    expect(coll.type).toBe("Collection");
    expect(coll.name).toBe("General");
    expect(coll.summary).toBe("the topic");
    expect(coll.totalItems).toBe(0);
  });

  it("omits summary when no topic", () => {
    const coll = channelToAs2({
      id: "matrix:!r",
      source: "matrix",
      name: "Room",
      permalink: "https://matrix.to/#/!r",
    });
    expect(coll.summary).toBeUndefined();
  });
});
