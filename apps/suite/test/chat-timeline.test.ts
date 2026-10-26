// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  aggregateReactions,
  buildTimeline,
  type ChatMessage,
  type Reaction,
  type RoomSnapshot,
  TimelineError,
  type TimelineErrorCode,
  type TimelineOptions,
  unreadCountsByRoom,
} from "../src/apps/chat/lib/timeline";

const roomId = "https://example.org/chat/fictional-book-club/";
const mira = "https://example.org/people/mira#me";
const noel = "https://example.org/people/noel#me";
const start = Date.parse("2026-10-26T12:00:00Z");
const options = { timeZone: "UTC", groupWithinMinutes: 5 };

function message(id: string, offset = 0, senderId = mira): ChatMessage {
  return { id, roomId, senderId, timestamp: start + offset };
}

function room(messages: readonly ChatMessage[], lastRead: number | null = start): RoomSnapshot {
  return { roomId, messages, lastRead };
}

function groups(snapshot: RoomSnapshot, opts = options): string[][] {
  return buildTimeline(snapshot, opts).items.flatMap((item) =>
    item.kind === "message-group" ? [item.messages.map(({ id }) => id)] : [],
  );
}

function fails(action: () => unknown, code: TimelineErrorCode): void {
  expect(action).toThrow(TimelineError);
  expect(action).toThrow(expect.objectContaining({ code, name: "TimelineError" }));
  expect(action).toThrow(`Chat timeline: ${code}`);
}

describe("chat timeline", () => {
  it("handles an empty room and all-read timelines without an unread marker", () => {
    expect(buildTimeline(room([]), options)).toEqual({ items: [], unreadCount: 0 });
    expect(buildTimeline(room([message("a")]), options)).toEqual({
      items: [
        { kind: "day-divider", date: "2026-10-26" },
        { kind: "message-group", senderId: mira, messages: [message("a")] },
      ],
      unreadCount: 0,
    });
  });

  it("sorts chronologically with an id tie-break independent of input and locale", () => {
    const z = message("z", 1);
    const messages = [z, message("ä"), message("a"), message("A")];
    for (const input of [messages, [...messages].reverse(), [...messages.slice(1), z]]) {
      expect(groups(room(input, null))).toEqual([["A", "a", "ä", "z"]]);
    }
  });

  it("groups only consecutive senders and inclusive adjacent gaps", () => {
    const minute = 60_000;
    const messages = [
      message("a"),
      message("b", 5 * minute),
      message("c", 10 * minute), // Total duration exceeds N; adjacent gap does not.
      message("d", 15 * minute + 1),
      message("e", 15 * minute + 2, noel),
      message("f", 15 * minute + 3),
    ];
    expect(groups(room(messages, null))).toEqual([["a", "b", "c"], ["d"], ["e"], ["f"]]);
  });

  it("supports zero and fractional windows with millisecond precision", () => {
    const snapshot = room([message("a"), message("b"), message("c", 30_000)], null);
    expect(groups(snapshot, { ...options, groupWithinMinutes: 0 })).toEqual([["a", "b"], ["c"]]);
    expect(groups(snapshot, { ...options, groupWithinMinutes: 0.5 })).toEqual([["a", "b", "c"]]);
  });

  it("inserts exactly one unread marker inside a same-sender run", () => {
    const messages = [message("a", -1), message("b"), message("c", 1), message("d", 2)];
    const result = buildTimeline(room(messages), options);
    expect(result).toEqual({
      items: [
        { kind: "day-divider", date: "2026-10-26" },
        { kind: "message-group", senderId: mira, messages: messages.slice(0, 2) },
        { kind: "unread-marker", beforeMessageId: "c" },
        { kind: "message-group", senderId: mira, messages: messages.slice(2) },
      ],
      unreadCount: 2,
    });
    expect(buildTimeline(room(messages, null), options).unreadCount).toBe(4);
    expect(buildTimeline(room(messages, start + 10), options).unreadCount).toBe(0);
  });

  it("places day dividers before unread markers and breaks grouping at local midnight", () => {
    const messages = [
      { ...message("a"), timestamp: Date.parse("2026-10-26T03:59:59Z") },
      { ...message("b"), timestamp: Date.parse("2026-10-26T04:00:00Z") },
    ];
    const result = buildTimeline(room(messages, Date.parse("2026-10-26T03:59:59Z")), {
      ...options,
      timeZone: "America/New_York",
    });
    expect(result.items.map((item) => item.kind)).toEqual([
      "day-divider",
      "message-group",
      "day-divider",
      "unread-marker",
      "message-group",
    ]);
    expect(result.items.filter((item) => item.kind === "day-divider")).toEqual([
      { kind: "day-divider", date: "2026-10-25" },
      { kind: "day-divider", date: "2026-10-26" },
    ]);
    expect(groups(room(messages, null))).toEqual([["a", "b"]]);
    expect(groups(room(messages, null), { ...options, timeZone: "America/New_York" })).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it.each([
    ["America/New_York", "2026-03-08T06:59:00Z", "2026-03-08T07:01:00Z", "2026-03-08"],
    ["America/New_York", "2026-11-01T05:59:00Z", "2026-11-01T06:01:00Z", "2026-11-01"],
    ["Asia/Kathmandu", "2026-10-25T18:15:00Z", "2026-10-25T18:17:00Z", "2026-10-26"],
  ])("uses actual instants across DST / offsets in %s", (timeZone, a, b, date) => {
    const messages = [
      { ...message("a"), timestamp: Date.parse(a) },
      { ...message("b"), timestamp: Date.parse(b) },
    ];
    const result = buildTimeline(room(messages, null), { ...options, timeZone });
    expect(result.items[0]).toEqual({ kind: "day-divider", date });
    expect(groups(room(messages, null), { ...options, timeZone })).toEqual([["a", "b"]]);
  });

  it("does not invent dividers for dates skipped by a time-zone change", () => {
    const snapshot = room(
      [
        { ...message("a"), timestamp: Date.parse("2011-12-30T09:59:00Z") },
        { ...message("b"), timestamp: Date.parse("2011-12-30T10:01:00Z") },
      ],
      null,
    );
    const result = buildTimeline(snapshot, { ...options, timeZone: "Pacific/Apia" });
    expect(result.items.filter((item) => item.kind === "day-divider")).toEqual([
      { kind: "day-divider", date: "2011-12-29" },
      { kind: "day-divider", date: "2011-12-31" },
    ]);
  });

  it("pads early Gregorian years and rejects local year overflow at both ends", () => {
    const earliest = { ...message("a"), timestamp: -62_135_596_800_000 };
    const latest = { ...message("b"), timestamp: 253_402_300_799_999 };
    expect(buildTimeline(room([earliest], null), options).items[0]).toEqual({
      kind: "day-divider",
      date: "0001-01-01",
    });
    expect(buildTimeline(room([latest], null), options).items[0]).toEqual({
      kind: "day-divider",
      date: "9999-12-31",
    });
    for (const [entry, timeZone] of [
      [earliest, "America/New_York"],
      [latest, "Pacific/Kiritimati"],
    ] as const) {
      fails(
        () => buildTimeline(room([entry], null), { ...options, timeZone }),
        "invalid-timestamp",
      );
    }
  });

  it("preserves generic payloads and frozen inputs", () => {
    const a = Object.freeze({ ...message("a"), content: "A fictional book discussion" });
    const b = Object.freeze({ ...message("b", 1), content: "A synthetic reply" });
    const messages = Object.freeze([b, a]);
    const snapshot = Object.freeze({ roomId, messages, lastRead: null });
    const result = buildTimeline(snapshot, Object.freeze(options));
    const group = result.items.find((item) => item.kind === "message-group");
    expect(group).toBeDefined();
    if (!group) throw new Error("Expected a message group");
    expect(group.messages[0]).toBe(a);
    expect(group.messages[0]?.content).toBe(a.content);
    group.messages.pop();
    expect(messages).toEqual([b, a]);
  });
});

describe("unread counts", () => {
  it("counts every newer message, keeps zero rooms, and agrees with the timeline", () => {
    const snapshots = [
      room([message("a", -1), message("b"), message("c", 1), message("d", 2, noel)]),
      { roomId: "__proto__", messages: [], lastRead: null },
      { roomId: "empty", messages: [], lastRead: start + 100 },
      {
        roomId: "never-read",
        messages: [{ ...message("a"), roomId: "never-read" }],
        lastRead: null,
      },
    ];
    expect([...unreadCountsByRoom(snapshots)]).toEqual([
      [roomId, 2],
      ["__proto__", 0],
      ["empty", 0],
      ["never-read", 1],
    ]);
    for (const snapshot of snapshots) {
      expect(unreadCountsByRoom([snapshot]).get(snapshot.roomId)).toBe(
        buildTimeline(snapshot, options).unreadCount,
      );
    }
    expect([...unreadCountsByRoom([])]).toEqual([]);
    fails(() => unreadCountsByRoom([room([]), room([])]), "invalid-room");
    fails(() => unreadCountsByRoom(null as unknown as RoomSnapshot[]), "invalid-room");
  });
});

describe("active reaction aggregation", () => {
  it("counts distinct actors and 'me' per exact emoji token in deterministic order", () => {
    const reactions = Object.freeze([
      Object.freeze({ emoji: "👍🏽", actorId: mira }),
      Object.freeze({ emoji: "👍", actorId: noel }),
      Object.freeze({ emoji: "👍🏽", actorId: noel }),
      Object.freeze({ emoji: "👩‍💻", actorId: mira }),
      Object.freeze({ emoji: "👍🏽", actorId: mira }),
      Object.freeze({ emoji: "❤", actorId: noel }),
      Object.freeze({ emoji: "❤️", actorId: mira }),
    ]);
    const expected = [
      { emoji: "❤", count: 1, reactedByMe: false },
      { emoji: "❤️", count: 1, reactedByMe: true },
      { emoji: "👍", count: 1, reactedByMe: false },
      { emoji: "👍🏽", count: 2, reactedByMe: true },
      { emoji: "👩‍💻", count: 1, reactedByMe: true },
    ];
    expect(aggregateReactions(reactions, mira)).toEqual(expected);
    expect(aggregateReactions([...reactions].reverse(), mira)).toEqual(expected);
    expect(aggregateReactions([], mira)).toEqual([]);
    expect(aggregateReactions([{ emoji: "__proto__", actorId: mira }], noel)).toEqual([
      { emoji: "__proto__", count: 1, reactedByMe: false },
    ]);
    expect(reactions).toHaveLength(7);
  });

  it.each([
    null,
    1,
    {},
    [null],
    [1],
    [{ emoji: "", actorId: mira }],
    [{ emoji: "👍", actorId: " " }],
  ])("rejects malformed reactions: %j", (value) =>
    fails(() => aggregateReactions(value as unknown as Reaction[], mira), "invalid-reaction"));

  it.each(["", " ", null, 1])("rejects invalid viewer identities: %j", (value) => {
    fails(() => aggregateReactions([], value as string), "invalid-identity");
  });
});

describe("fail-closed validation", () => {
  it.each([
    null,
    {},
    { timeZone: null, groupWithinMinutes: 5 },
    { ...options, timeZone: "" },
    { ...options, timeZone: " " },
    { ...options, timeZone: "Not/A_Zone" },
    { ...options, groupWithinMinutes: -1 },
    { ...options, groupWithinMinutes: Number.NaN },
    { ...options, groupWithinMinutes: Number.POSITIVE_INFINITY },
    { ...options, groupWithinMinutes: Number.MAX_SAFE_INTEGER },
    { ...options, groupWithinMinutes: 1 / 7 },
    { ...options, groupWithinMinutes: "5" },
  ])("rejects invalid options even with no messages: %j", (value) => {
    fails(() => buildTimeline(room([]), value as TimelineOptions), "invalid-options");
  });

  it.each([null, 1, {}, { ...room([]), roomId: " " }])("rejects invalid rooms: %j", (value) => {
    fails(() => buildTimeline(value as RoomSnapshot, options), "invalid-room");
  });

  it.each([
    null,
    {},
    [null],
    [1],
    new Array(1),
    [{ ...message("a"), id: " " }],
    [{ ...message("a"), id: 1 }],
    [{ ...message("a"), senderId: "" }],
    [{ ...message("a"), roomId: "https://example.org/chat/another-room/" }],
    [message("a"), message("a", 1, noel)],
  ])("rejects malformed, mixed-room or duplicate messages: %j", (messages) => {
    const snapshot = room(messages as ChatMessage[]);
    fails(() => buildTimeline(snapshot, options), "invalid-message");
    fails(() => unreadCountsByRoom([snapshot]), "invalid-message");
  });

  it.each([
    undefined,
    null,
    "2026-10-26T12:00:00Z",
    new Date(start),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0.5,
    -62_135_596_800_001,
    253_402_300_800_000,
  ])("rejects unsupported timestamps and receipts without coercion: %j", (value) => {
    const snapshot = room([{ ...message("a"), timestamp: value as number }]);
    fails(() => buildTimeline(snapshot, options), "invalid-timestamp");
    fails(() => unreadCountsByRoom([snapshot]), "invalid-timestamp");
    if (value !== null) {
      const invalidReceipt = { ...room([]), lastRead: value as number };
      fails(() => buildTimeline(invalidReceipt, options), "invalid-timestamp");
      fails(() => unreadCountsByRoom([invalidReceipt]), "invalid-timestamp");
    }
  });
});
