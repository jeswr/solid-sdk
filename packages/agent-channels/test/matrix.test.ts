// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
import { expect, it, vi } from "vitest";
import * as fixtures from "../../matrix-chat-to-pod/test/fixtures/events.js";
import { encodeEventContent } from "../src/envelope.js";
import {
  identifier,
  json,
  matrixOrigins,
  matrixRest,
  record,
  responseBody,
  syncToken,
} from "../src/matrix/shared.js";
import { createMatrixReader, MatrixRoomError, parseMatrixMessage } from "../src/matrix.js";
import { MATRIX_CONTENT } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import {
  cursor,
  direct,
  event,
  fixtureTransport,
  homeserver,
  reader,
  required,
  roomId,
  sync,
  userId,
} from "./fixtures/matrix.js";
import { account, limits, signed } from "./fixtures/signed.js";

it("filters sync to m.direct rooms, bounds pages and commits the baseline only after draining", async () => {
  const r = reader([
    direct,
    sync([event(), event("$two")]),
    direct,
    sync([], { next_batch: "s2" }),
  ]);
  const first = await r.binding.ingest.list(account, undefined, { ...limits, maxItems: 1 });
  expect(first.items.map((m) => m.id)).toEqual(["$one"]);
  const filter = JSON.parse(required(required(r.requests[1]).url.searchParams.get("filter")));
  expect(filter.room.rooms).toEqual([roomId]);
  expect(filter.room.include_leave).toBe(true);
  expect(filter.room.timeline.types).toEqual(["m.room.message", "m.room.encrypted"]);
  expect(r.crypto.receiveSync).toHaveBeenCalledTimes(1);
  const second = await r.binding.ingest.list(account, first.next, limits);
  expect(second.items.map((m) => m.id)).toEqual(["$two"]);
  expect(r.requests).toHaveLength(2);
  const third = await r.binding.ingest.list(account, second.next, limits);
  expect(third.items).toEqual([]);
  expect(required(r.requests[3]).url.searchParams.get("since")).toBe("s1");
  expect(JSON.parse(third.next).since).toBe("s2");
  expect(r.tokens.calls.every((call) => call.access === "read")).toBe(true);
  const message = r.binding.ingest.parse(required(first.items[0]));
  expect(message).toMatchObject({
    channel: "matrix",
    sender: { handle: userId },
    textBody: "Hello fixture",
    messageId: "$one",
    threadId: roomId,
    date: "2023-11-14T22:13:20.000Z",
    rawSha256: digestBytes(required(first.items[0]).raw).slice(8),
    rawMediaType: "application/json",
  });
  expect(required(r.binding.ingest.threadKey)(message)).toBe(roomId);
  expect(r.binding.send).toBeUndefined();
  expect(r.binding.describe("connected")).toMatchObject({
    carriage: "matrix-event/0.1",
    endToEndEncrypted: true,
    sendSupported: true,
    rateLimit: { perRecipient: 0, perDay: 0 },
  });
  expect(r.binding.origins).toEqual(new Set([homeserver]));
});

it.each([
  "join",
  "leave",
])("retains %s ciphertext provenance while decrypting after crypto sync", async (membership) => {
  const cipher = {
    ...event(),
    type: "m.room.encrypted",
    content: { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "synthetic-fixture" },
  };
  const r = reader([
    direct,
    sync([], { rooms: { [membership]: { [roomId]: { timeline: { events: [cipher] } } } } }),
  ]);
  const page = await r.binding.ingest.list(account, undefined, limits);
  expect(r.crypto.receiveSync.mock.invocationCallOrder[0]).toBeLessThan(
    required(r.crypto.decrypt.mock.invocationCallOrder[0]),
  );
  expect(required(page.items[0]).raw).toBe(JSON.stringify(cipher));
  expect(r.binding.ingest.parse(required(page.items[0]))).toMatchObject({
    textBody: "decrypted fixture",
    rawSha256: digestBytes(JSON.stringify(cipher)).slice(8),
  });
});

it("handles the matrix-chat-to-pod fixture suite without interpreting edits/redactions as new statements", () => {
  const accepted = new Set([
    "plainMessage",
    "htmlMessage",
    "replyMessage",
    "hostileReply",
    "insaneTimestampMessage",
  ]);
  for (const [name, native] of Object.entries(fixtures)) {
    const item = { id: String(native.event_id), raw: JSON.stringify(native) };
    if (accepted.has(name)) {
      const message = parseMatrixMessage(item);
      expect(message.channel).toBe("matrix");
      expect(message.textBody.length).toBeGreaterThan(0);
      expect(message).not.toHaveProperty("formatted_body");
    } else expect(() => parseMatrixMessage(item), name).toThrow();
  }
});

it("extracts only the unverified envelope, strips controls, refuses malformed carriers and altered decrypted identities", () => {
  const payload = signed();
  const native = event("$signed", {
    msgtype: "m.text",
    body: "hi\u0000\u001bthere",
    formatted_body: "<script>bad</script>",
    ...encodeEventContent(payload.compactJws),
  });
  const item = { id: "$signed", raw: Buffer.from(JSON.stringify(native)) };
  expect(parseMatrixMessage(item)).toMatchObject({
    textBody: "hithere",
    jsonLdBlocks: [
      canonicalJson(encodeEventContent(payload.compactJws)["org.jeswr.agent.envelope"]),
    ],
  });
  expect(() => parseMatrixMessage({ ...item, id: "$other" })).toThrow("identity");
  for (const key of ["event_id", "room_id", "sender"]) {
    expect(() =>
      parseMatrixMessage({
        id: "$signed",
        raw: JSON.stringify({ ...native, type: "m.room.encrypted" }),
        native: JSON.stringify({ ...native, [key]: "other" }),
      }),
    ).toThrow("identity");
  }
  expect(() =>
    parseMatrixMessage({
      id: "$one",
      raw: JSON.stringify(event("$one", { body: "hi", "org.jeswr.agent.envelope": {} })),
    }),
  ).toThrow();
  expect(
    parseMatrixMessage({
      id: "$one",
      raw: JSON.stringify({ ...event(), sender: undefined, origin_server_ts: undefined }),
    }),
  ).not.toHaveProperty("sender");
});

it("honours byte limits without consuming pending events", async () => {
  const one = event();
  const two = event("$two");
  const r = reader([direct, sync([one, two])]);
  const first = await r.binding.ingest.list(account, undefined, {
    maxItems: 2,
    maxBytes: Buffer.byteLength(JSON.stringify(one)),
  });
  expect(first.items).toHaveLength(1);
  expect(JSON.parse(first.next).pending[0].event_id).toBe("$two");
  await expect(
    r.binding.ingest.list(account, first.next, { maxItems: 1, maxBytes: 1 }),
  ).rejects.toThrow("byte bound");
  expect(required((await r.binding.ingest.list(account, first.next, limits)).items[0]).id).toBe(
    "$two",
  );
  await expect(
    reader([direct, sync([{ ...event(), padding: "x".repeat(65536) }])]).binding.ingest.list(
      account,
      undefined,
      { maxItems: 1, maxBytes: 100000 },
    ),
  ).rejects.toThrow("byte bound");
});

it("refuses wrong account and malformed bounds before acquiring credentials", async () => {
  const r = reader([]);
  await expect(r.binding.ingest.list({ id: "other" }, undefined, limits)).rejects.toThrow(
    "account",
  );
  for (const [maxItems, maxBytes] of [
    [0, 10],
    [1.5, 10],
    [1, 0],
    [1, NaN],
  ] as const)
    await expect(r.binding.ingest.list(account, undefined, { maxItems, maxBytes })).rejects.toThrow(
      "bounds",
    );
  expect(r.tokens.calls).toHaveLength(0);
});

it.each([
  { account: "other" },
  { homeserver: "https://other.example" },
  { userId: "@other:example.org" },
  { extra: 1 },
  { pending: {} },
  { pending: Array.from({ length: 513 }, () => event()) },
  { since: "" },
  { pending: [null] },
  { pending: [{ event_id: "$one", room_id: "bad" }] },
])("refuses invalid cursors %j before requests", async (patch) => {
  const r = reader([]);
  await expect(r.binding.ingest.list(account, cursor(patch), limits)).rejects.toThrow();
  expect(r.requests).toHaveLength(0);
});

it.each([
  "join",
  "leave",
])("locally rejects %s non-DM rooms and same-sync removals, even if the server ignores the filter", async (membership) => {
  const r = reader([
    direct,
    sync([], {
      rooms: {
        [membership]: {
          "!public:example.org": { timeline: { events: [event()], limited: true } },
          [roomId]: { timeline: { events: [event()] } },
        },
      },
      account_data: { events: [{ type: "other" }, { type: "m.direct", content: {} }] },
    }),
  ]);
  expect((await r.binding.ingest.list(account, undefined, limits)).items).toEqual([]);
  const empty = reader([new Response(null, { status: 404 }), { next_batch: "s0" }]);
  expect((await empty.binding.ingest.list(account, undefined, limits)).items).toEqual([]);
});

it("drains left DM timelines without losing pre-departure events or accepting non-DMs", async () => {
  const left = {
    next_batch: "s1",
    rooms: {
      leave: {
        [roomId]: { timeline: { events: [event(), event("$two")] } },
        "!public:example.org": { timeline: { events: [event("$public")], limited: true } },
      },
    },
  };
  const r = reader([direct, left, direct, sync([], { next_batch: "s2" })]);
  const first = await r.binding.ingest.list(account, cursor(), { ...limits, maxItems: 1 });
  expect(first.items.map((item) => item.id)).toEqual(["$one"]);
  expect(JSON.parse(first.next).pending.map((item: { event_id: string }) => item.event_id)).toEqual(
    ["$two"],
  );
  const second = await r.binding.ingest.list(account, first.next, limits);
  expect(second.items.map((item) => item.id)).toEqual(["$two"]);
  expect(r.requests).toHaveLength(2);
  const third = await r.binding.ingest.list(account, second.next, limits);
  expect(third.items).toEqual([]);
  expect(required(r.requests[3]).url.searchParams.get("since")).toBe("s1");
  expect(JSON.parse(third.next).since).toBe("s2");
});

it.each(["join", "leave"])("accepts %s room updates without a timeline", async (membership) => {
  const r = reader([
    direct,
    sync([], {
      rooms: { [membership]: { [roomId]: { account_data: { events: [] } } } },
    }),
  ]);
  const page = await r.binding.ingest.list(account, cursor(), limits);
  expect(page.items).toEqual([]);
  expect(JSON.parse(page.next)).toMatchObject({ since: "s1", pending: [] });
});

it.each([
  "join",
  "leave",
])("reports failed/truncated %s DM rooms and preserves retries", async (membership) => {
  for (const data of [
    null,
    { timeline: null },
    { timeline: [] },
    { timeline: {} },
    { timeline: { events: [], limited: true } },
    { timeline: { events: null } },
    { timeline: { events: [null] } },
    { timeline: { events: [event("bad")] } },
    { timeline: { events: [{ ...event(), room_id: "!other:example.org" }] } },
  ]) {
    const r = reader([
      direct,
      sync([], { rooms: { [membership]: { [roomId]: data } } }),
      direct,
      sync([], { rooms: { [membership]: { [roomId]: { timeline: { events: [event()] } } } } }),
    ]);
    const previous = cursor();
    await expect(r.binding.ingest.list(account, previous, limits)).rejects.toMatchObject({
      roomId,
    });
    const retry = await r.binding.ingest.list(account, previous, limits);
    expect(retry.items.map((item) => item.id)).toEqual(["$one"]);
    expect(required(r.requests[1]).url.searchParams.get("since")).toBe("s0");
    expect(required(r.requests[3]).url.searchParams.get("since")).toBe("s0");
  }
});

it("reports a decryption failure with room context, leaving the checkpoint reusable", async () => {
  const pending = { ...event(), type: "m.room.encrypted" };
  const r = reader([]);
  r.crypto.decrypt.mockRejectedValueOnce(new Error("must not escape"));
  await expect(
    r.binding.ingest.list(account, cursor({ pending: [pending] }), limits),
  ).rejects.toBeInstanceOf(MatrixRoomError);
  expect(
    (await r.binding.ingest.list(account, cursor({ pending: [pending] }), limits)).items,
  ).toHaveLength(1);
});

it.each([
  [{ peer: "bad" }],
  [{ peer: ["bad"] }],
  [{ peer: Array.from({ length: 513 }, (_, i) => `!${i}:example.org`) }],
  [direct, sync([], { account_data: { events: {} } })],
  [direct, sync([], { account_data: { events: [{ type: "m.direct", content: { peer: 1 } }] } })],
  [direct, sync(Array.from({ length: 513 }, (_, i) => event(`$${i}`)))],
  [direct, sync([], { next_batch: "" })],
])("refuses malformed sync or account data", async (...replies) => {
  await expect(reader(replies).binding.ingest.list(account, undefined, limits)).rejects.toThrow();
});

it("accepts /sync events without room_id and uses the containing room", async () => {
  const value = { ...event(), room_id: undefined };
  const r = reader([direct, sync([value])]);
  expect(
    r.binding.ingest.parse(
      required((await r.binding.ingest.list(account, undefined, limits)).items[0]),
    ),
  ).toMatchObject({ threadId: roomId });
});

it("bounds shared parsing, origin configuration, scope separation and response handling", async () => {
  for (const v of [null, 1, []]) expect(() => record(v)).toThrow();
  for (const v of [undefined, "", "$", "!wrong", `$${"x".repeat(256)}`, "$bad\n"])
    expect(() => identifier(v, "$")).toThrow();
  for (const v of [undefined, "", "x".repeat(2049), "bad\n"]) expect(() => syncToken(v)).toThrow();
  expect(syncToken("s0")).toBe("s0");
  for (const raw of ["null", "{", new Uint8Array([255]), new Uint8Array(65537)])
    expect(() => json(raw, 65536)).toThrow();
  expect(json(new TextEncoder().encode("{}"))).toEqual({});
  for (const origin of [
    "bad",
    "http://matrix.example",
    "https://user:pass@matrix.example",
    "https://matrix.example/path",
  ])
    expect(() => matrixOrigins(origin)).toThrow();
  await expect(responseBody(new Response(null, { status: 500 }))).rejects.toThrow("500");
  await expect(responseBody(new Response("{"))).rejects.toThrow("JSON");
  const fake = fixtureTransport([
    new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
  ]);
  const tokens = new RecordingTokenProvider();
  await expect(
    matrixRest(homeserver, fake.options)("/sync", account, tokens, "read"),
  ).rejects.toThrow("redirect");
  const scoped = matrixRest(homeserver, fixtureTransport([]).options);
  await expect(
    scoped(
      "/sync",
      account,
      {
        ...tokens,
        read: vi.fn(async () => ({ access: "send" as "read", accessToken: "synthetic" })),
        send: tokens.send,
      },
      "read",
    ),
  ).rejects.toThrow("scope");
  // Construction with the production transport performs no network request.
  expect(
    createMatrixReader({ account, homeserver, userId, tokens, crypto: reader([]).crypto }).origins,
  ).toEqual(new Set([homeserver]));
  expect(MATRIX_CONTENT.id).toBe("matrix-event/0.1");
});

it("caps aggregate rooms/events even when each individual array is within its bound", async () => {
  const rooms = Array.from({ length: 513 }, (_, i) => `!${i}:example.org`);
  await expect(
    reader([{ peer1: rooms.slice(0, 256), peer2: rooms.slice(256) }]).binding.ingest.list(
      account,
      undefined,
      limits,
    ),
  ).rejects.toThrow("room cap");
  const room2 = "!dm2:example.org";
  const many = {
    next_batch: "s1",
    rooms: {
      join: {
        [roomId]: { timeline: { events: Array.from({ length: 256 }, (_, i) => event(`$a${i}`)) } },
      },
      leave: {
        [room2]: {
          timeline: {
            events: Array.from({ length: 257 }, (_, i) => ({ ...event(`$b${i}`), room_id: room2 })),
          },
        },
      },
    },
  };
  await expect(
    reader([{ peer: [roomId, room2] }, many]).binding.ingest.list(account, undefined, limits),
  ).rejects.toThrow("item cap");
  expect(
    (
      await reader([direct, sync([], { account_data: { events: [] } })]).binding.ingest.list(
        account,
        undefined,
        limits,
      )
    ).items,
  ).toEqual([]);
  const race = reader([
    {},
    sync([], { account_data: { events: [{ type: "m.direct", content: direct }] } }),
    direct,
    sync([event()]),
  ]);
  await expect(race.binding.ingest.list(account, undefined, limits)).rejects.toMatchObject({
    roomId,
  });
  expect((await race.binding.ingest.list(account, undefined, limits)).items).toHaveLength(1);
});

it("refuses missing, executable or oversized decrypted JSON before inspecting content", () => {
  const raw = JSON.stringify({ ...event(), type: "m.room.encrypted" });
  for (const native of [
    undefined,
    Object.defineProperty({}, "content", {
      get() {
        throw new Error("must not execute");
      },
    }),
    "x".repeat(65537),
  ]) {
    expect(() => parseMatrixMessage({ id: "$one", raw, native })).toThrow(/Matrix/);
  }
});
