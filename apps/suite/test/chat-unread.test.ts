// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { unreadCountsByRoom } from "../src/apps/chat/lib/timeline";
import {
  advanceReadMarker,
  countUnread,
  decideNotification,
  type MessageEvent,
  type NotificationContext,
  type ReadMarker,
  UnreadError,
  type UnreadErrorCode,
  type UnreadMessage,
} from "../src/apps/chat/lib/unread";

const roomId = "https://example.org/chat/fictional-book-club/";
const otherRoom = "https://example.org/chat/fictional-garden-club/";
const mira = "https://example.org/people/mira#me";
const noel = "https://example.org/people/noel#me";
const start = Date.parse("2026-10-26T12:00:00Z");
const marker: ReadMarker = { roomId, lastRead: start };

function message(overrides: Partial<UnreadMessage> = {}): UnreadMessage {
  return {
    id: `${roomId}2026/10/26.ttl#one`,
    roomId,
    senderId: noel,
    timestamp: start + 1,
    mentionIds: [],
    ...overrides,
  };
}

function context(overrides: Partial<NotificationContext> = {}): NotificationContext {
  return { marker, viewerId: mira, muted: false, ...overrides };
}

function event(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return { type: "create", message: message(), ...overrides };
}

function fails(action: () => unknown, code: UnreadErrorCode): void {
  expect(action).toThrow(UnreadError);
  expect(action).toThrow(expect.objectContaining({ code, name: "UnreadError" }));
  expect(action).toThrow(`Chat unread: ${code}`);
}

describe("monotonic per-room read markers", () => {
  it("initializes explicitly, advances, and never moves backwards or resets", () => {
    const neverRead = { roomId, lastRead: null };
    const newer = { roomId, lastRead: start + 1 };
    expect(advanceReadMarker(neverRead, neverRead)).toEqual(neverRead);
    expect(advanceReadMarker(neverRead, marker)).toEqual(marker);
    expect(advanceReadMarker(marker, neverRead)).toEqual(marker);
    expect(advanceReadMarker(marker, marker)).toEqual(marker);
    expect(advanceReadMarker(marker, newer)).toEqual(newer);
    expect(advanceReadMarker(newer, marker)).toEqual(newer);
  });

  it("converges for updates arriving in any order, including negative timestamps", () => {
    const updates = [null, -10, 0, start, start - 1, start + 10];
    for (const values of [updates, [...updates].reverse()]) {
      const result = values.reduce<ReadMarker>(
        (current, lastRead) => advanceReadMarker(current, { roomId, lastRead }),
        { roomId, lastRead: null },
      );
      expect(result).toEqual({ roomId, lastRead: start + 10 });
    }
    expect(advanceReadMarker({ roomId, lastRead: null }, { roomId, lastRead: -10 })).toEqual({
      roomId,
      lastRead: -10,
    });
  });

  it("isolates conversations and does not mutate frozen markers", () => {
    const current = Object.freeze(marker);
    const candidate = Object.freeze({ roomId, lastRead: start + 1 });
    const result = advanceReadMarker(current, candidate);
    expect(result).toEqual(candidate);
    expect(result).not.toBe(candidate);
    expect(result).not.toBe(current);
    expect(current.lastRead).toBe(start);
    fails(() => advanceReadMarker(marker, { roomId: otherRoom, lastRead: start }), "room-mismatch");
    expect(
      advanceReadMarker(
        { roomId: otherRoom, lastRead: null },
        { roomId: otherRoom, lastRead: start },
      ),
    ).toEqual({ roomId: otherRoom, lastRead: start });
  });
});

describe("unread and mention counts", () => {
  it("counts only strictly newer messages and each mentioned message once", () => {
    const messages = [
      message({ id: "old", timestamp: start - 1, mentionIds: [mira] }),
      message({ id: "equal", timestamp: start, mentionIds: [mira] }),
      message({ id: "plain" }),
      message({ id: "mention", mentionIds: [mira, mira, noel] }),
      message({ id: "own", senderId: mira, mentionIds: [mira] }),
      message({ id: "other-mention", mentionIds: [noel] }),
    ];
    const snapshot = { ...marker, messages };
    expect(countUnread(snapshot, mira)).toEqual({ unreadCount: 4, mentionCount: 2 });
    expect(countUnread({ ...snapshot, messages: [...messages].reverse() }, mira)).toEqual({
      unreadCount: 4,
      mentionCount: 2,
    });
    expect(countUnread(snapshot, mira).unreadCount).toBe(
      unreadCountsByRoom([snapshot]).get(roomId),
    );
    expect(countUnread(snapshot, noel)).toEqual({ unreadCount: 4, mentionCount: 2 });
  });

  it("supports empty, never-read, all-read and future-marker snapshots", () => {
    expect(countUnread({ ...marker, messages: [] }, mira)).toEqual({
      unreadCount: 0,
      mentionCount: 0,
    });
    const messages = [message({ timestamp: start, mentionIds: [mira] }), message({ id: "two" })];
    expect(countUnread({ roomId, lastRead: null, messages }, mira)).toEqual({
      unreadCount: 2,
      mentionCount: 1,
    });
    expect(countUnread({ roomId, lastRead: start + 1, messages }, mira)).toEqual({
      unreadCount: 0,
      mentionCount: 0,
    });
    expect(countUnread({ roomId, lastRead: start + 100, messages }, mira)).toEqual({
      unreadCount: 0,
      mentionCount: 0,
    });
  });

  it("uses exact identities and does not mutate frozen snapshots", () => {
    const entry = Object.freeze(
      message({ mentionIds: Object.freeze([`${mira}x`, mira.toUpperCase()]) }),
    );
    const messages = Object.freeze([entry]);
    const snapshot = Object.freeze({ ...marker, messages });
    expect(countUnread(snapshot, mira)).toEqual({ unreadCount: 1, mentionCount: 0 });
    expect(snapshot.messages).toBe(messages);
    expect(snapshot.messages[0]).toBe(entry);
  });
});

describe("notification rules", () => {
  it.each([
    false,
    true,
  ])("notifies unread creates, with mention override when muted=%s", (muted) => {
    expect(decideNotification(event(), context({ muted }))).toEqual({
      notify: !muted,
      reason: muted ? "muted" : "message",
    });
    expect(
      decideNotification(
        event({ message: message({ mentionIds: [mira, mira] }) }),
        context({ muted }),
      ),
    ).toEqual({ notify: true, reason: "mention" });
    expect(
      decideNotification(event({ message: message({ mentionIds: [noel] }) }), context({ muted })),
    ).toEqual({ notify: !muted, reason: muted ? "muted" : "message" });
  });

  it("suppresses own messages even when mentioned, muted, or never read", () => {
    for (const muted of [true, false]) {
      expect(
        decideNotification(
          event({ message: message({ senderId: mira, mentionIds: [mira] }) }),
          context({ muted, marker: { roomId, lastRead: null } }),
        ),
      ).toEqual({ notify: false, reason: "own-message" });
    }
  });

  it("never re-notifies edits, including an edit that adds a mention", () => {
    for (const muted of [true, false]) {
      for (const mentionIds of [[], [mira]]) {
        expect(
          decideNotification(
            event({ type: "edit", message: message({ mentionIds }) }),
            context({ muted }),
          ),
        ).toEqual({ notify: false, reason: "edit" });
      }
    }
  });

  it("suppresses already-read messages before considering mute or mention override", () => {
    for (const timestamp of [start - 1, start]) {
      expect(
        decideNotification(
          event({ message: message({ timestamp, mentionIds: [mira] }) }),
          context({ muted: true }),
        ),
      ).toEqual({ notify: false, reason: "already-read" });
    }
    expect(decideNotification(event(), context({ marker: { roomId, lastRead: null } }))).toEqual({
      notify: true,
      reason: "message",
    });
  });

  it("preserves frozen inputs and uses literal mention IDs", () => {
    const incoming = Object.freeze(
      event({
        message: Object.freeze(
          message({
            mentionIds: Object.freeze([mira.toUpperCase()]),
          }),
        ),
      }),
    );
    const settings = Object.freeze(context({ muted: true }));
    expect(decideNotification(incoming, settings)).toEqual({ notify: false, reason: "muted" });
  });
});

describe("fail-closed input validation", () => {
  it.each([
    undefined,
    null,
    false,
    [],
    {},
    { roomId: " " },
    { roomId: 1 },
  ])("rejects malformed markers in every position: %j", (invalid) => {
    const value = invalid as ReadMarker;
    fails(() => advanceReadMarker(value, marker), "invalid-marker");
    fails(() => advanceReadMarker(marker, value), "invalid-marker");
    fails(() => countUnread({ ...value, messages: [] }, mira), "invalid-marker");
    fails(() => decideNotification(event(), context({ marker: value })), "invalid-marker");
  });

  it.each([
    undefined,
    "2026-10-26",
    new Date(start),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    -62_135_596_800_001,
    253_402_300_800_000,
  ])("rejects invalid timestamps without coercion: %j", (invalid) => {
    const badMarker = { roomId, lastRead: invalid as number };
    fails(() => advanceReadMarker(marker, badMarker), "invalid-timestamp");
    fails(() => advanceReadMarker(badMarker, marker), "invalid-timestamp");
    fails(() => countUnread({ ...badMarker, messages: [] }, mira), "invalid-timestamp");
    const badMessage = message({ timestamp: invalid as number });
    fails(() => countUnread({ ...marker, messages: [badMessage] }, mira), "invalid-timestamp");
    fails(() => decideNotification(event({ message: badMessage }), context()), "invalid-timestamp");
  });

  it("accepts supported timestamp bounds and rejects null message timestamps", () => {
    for (const timestamp of [-62_135_596_800_000, 253_402_300_799_999]) {
      expect(
        countUnread({ roomId, lastRead: null, messages: [message({ timestamp })] }, mira),
      ).toEqual({ unreadCount: 1, mentionCount: 0 });
      expect(
        advanceReadMarker({ roomId, lastRead: null }, { roomId, lastRead: timestamp }),
      ).toEqual({ roomId, lastRead: timestamp });
    }
    fails(
      () =>
        decideNotification(
          event({ message: message({ timestamp: null as unknown as number }) }),
          context(),
        ),
      "invalid-timestamp",
    );
  });

  it.each([undefined, null, 1, " "])("rejects invalid viewer identities: %j", (value) => {
    const viewerId = value as string;
    fails(() => countUnread({ ...marker, messages: [] }, viewerId), "invalid-identity");
    fails(() => decideNotification(event(), context({ viewerId })), "invalid-identity");
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { ...context(), muted: "false" },
    { ...context(), muted: undefined },
  ])("rejects malformed notification options: %j", (value) => {
    fails(() => decideNotification(event(), value as NotificationContext), "invalid-options");
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { type: "update", message: message() },
    { type: undefined, message: message() },
  ])("rejects unknown event kinds: %j", (value) => {
    fails(() => decideNotification(value as MessageEvent, context()), "invalid-event");
  });

  it.each([
    undefined,
    null,
    [],
    1,
    {},
    message({ id: " " }),
    message({ senderId: "" }),
    message({ roomId: " " }),
    message({ mentionIds: null as unknown as string[] }),
    message({ mentionIds: [""] }),
    message({ mentionIds: [1] as unknown as string[] }),
    message({ mentionIds: new Array(1) as string[] }),
  ])("rejects malformed messages even if read, own, or edited: %j", (value) => {
    const invalid = value as UnreadMessage;
    fails(() => countUnread({ ...marker, messages: [invalid] }, mira), "invalid-message");
    fails(
      () => decideNotification(event({ type: "edit", message: invalid }), context()),
      "invalid-message",
    );
  });

  it.each([undefined, null, {}, new Array(1)])("rejects malformed message lists: %j", (value) => {
    fails(
      () => countUnread({ ...marker, messages: value as UnreadMessage[] }, mira),
      "invalid-message",
    );
  });

  it("rejects duplicate snapshots, mixed rooms and invalid trailing messages", () => {
    const valid = message();
    fails(
      () => countUnread({ ...marker, messages: [valid, { ...valid, timestamp: start + 2 }] }, mira),
      "duplicate-message",
    );
    const mixed = message({ roomId: otherRoom });
    fails(() => countUnread({ ...marker, messages: [mixed] }, mira), "room-mismatch");
    fails(() => decideNotification(event({ message: mixed }), context()), "room-mismatch");
    fails(
      () =>
        countUnread(
          { ...marker, messages: [valid, message({ id: "bad", mentionIds: [""] })] },
          mira,
        ),
      "invalid-message",
    );
  });

  it("does not echo input in typed errors", () => {
    const input = "synthetic-private-value";
    expect(() => decideNotification({ type: input } as unknown as MessageEvent, context())).toThrow(
      "Chat unread: invalid-event",
    );
    try {
      decideNotification({ type: input } as unknown as MessageEvent, context());
    } catch (error) {
      expect(String(error)).not.toContain(input);
    }
  });
});
