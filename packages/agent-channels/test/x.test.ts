// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import type { guardedFetch } from "@jeswr/guarded-fetch";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import type { InboundRawMessage } from "../src/channel.js";
import { ChannelParseError } from "../src/errors.js";
import { X_READ_ONLY } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import type { TokenProvider } from "../src/types.js";
import { createXReader, createXSpendCounter, ORIGINS, X_READ_SCOPES } from "../src/x.js";

const fixture = JSON.parse(readFileSync(new URL("fixtures/x.json", import.meta.url), "utf8"));
const account = { id: "x-fixture-account" };
const bounds = { maxItems: 2, maxBytes: 100000 };
const config = { cap: 6, costPerCall: 2, periodMs: 1000 };
const cursor = (page: unknown, extra = {}) =>
  JSON.stringify({ account: account.id, page, ...extra });
function reader(replies: unknown[] = [fixture], enabled: boolean | undefined = true) {
  const queue = [...replies];
  const transport = vi.fn<typeof guardedFetch>(async () => {
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json(reply);
  });
  const tokens = new RecordingTokenProvider();
  const spend = createXSpendCounter({ ...config, now: () => 100 });
  const options = {
    enabled,
    tokens,
    spend,
    transport: {
      createTransport: () => transport,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    },
  };
  return { binding: createXReader(options), tokens, spend, transport, options };
}

it("reads recorded DM pages with a read grant and an account-scoped cursor", async () => {
  const r = reader([fixture, { data: [] }, {}]);
  const first = await r.binding.ingest.list(account, undefined, bounds);
  expect(JSON.parse(first.next)).toEqual({ account: account.id, page: fixture.meta.next_token });
  const wire = first.items[0] as InboundRawMessage;
  const parsed = r.binding.ingest.parse(wire);
  expect(parsed).toEqual({
    channel: "x",
    sender: { handle: "9876543210" },
    textBody: fixture.data[0].text,
    messageId: wire.id,
    threadId: "9876543210-1111111111",
    date: fixture.data[0].created_at,
    signals: {},
    rawSha256: digestBytes(wire.raw).slice(8),
    rawByteLength: Buffer.byteLength(wire.raw),
    rawMediaType: "application/json",
    warnings: ["identity-unverified"],
  });
  expect(r.binding.ingest.threadKey?.(parsed)).toBe(parsed.threadId);
  expect(r.binding.ingest.threadKey?.({ ...parsed, threadId: undefined })).toBeUndefined();
  const second = await r.binding.ingest.list(account, first.next, { ...bounds, maxItems: 500 });
  expect(second.items).toEqual([]);
  expect(JSON.parse(second.next).page).toBe("");
  await r.binding.ingest.list(account, second.next, bounds);
  expect(r.tokens.calls).toEqual(Array(3).fill({ access: "read", account }));
  const [input, init] = r.transport.mock.calls[1] as Parameters<typeof guardedFetch>;
  const url = new URL(String(input));
  expect(url.origin).toBe("https://api.x.com");
  expect(url.pathname).toBe("/2/dm_events");
  expect(url.searchParams.get("pagination_token")).toBe(fixture.meta.next_token);
  expect(url.searchParams.get("max_results")).toBe("100");
  expect(url.searchParams.get("event_types")).toBe("MessageCreate");
  expect(init?.method).toBe("GET");
  expect(init?.redirect).toBe("manual");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-read-token-0123456789");
});

it("advertises no send path and remains disabled unless explicitly enabled", async () => {
  const r = reader();
  expect(r.binding.carriage).toBe(X_READ_ONLY);
  expect(r.binding.id).toBe("x");
  expect(r.binding.send).toBeUndefined();
  expect(r.binding.describe("connected")).toMatchObject({
    sendSupported: false,
    maxMessageBytes: 0,
    structuredPayload: false,
    credentialState: "connected",
  });
  expect(X_READ_SCOPES).toEqual(["dm.read", "tweet.read", "users.read"]);
  expect(Object.isFrozen(X_READ_SCOPES)).toBe(true);
  const disabled = createXReader({ ...r.options, enabled: undefined });
  expect(disabled.describe("connected").credentialState).toBe("disabled");
  await expect(disabled.ingest.list(account, undefined, bounds)).rejects.toThrow("disabled");
  expect(r.transport).not.toHaveBeenCalled();
  expect(r.tokens.calls).toEqual([]);
});

it("refuses the N+1th request before credentials or network, including concurrent calls", async () => {
  const r = reader([{}, {}, {}]);
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => r.binding.ingest.list(account, undefined, bounds)),
  );
  expect(results.map((result) => result.status)).toEqual([
    "fulfilled",
    "fulfilled",
    "fulfilled",
    "rejected",
  ]);
  expect(r.spend.snapshot()).toEqual({ periodStart: 0, spent: 6 });
  expect(r.transport).toHaveBeenCalledTimes(3);
  expect(r.tokens.calls).toHaveLength(3);
});

it("resets on the next UTC period, never on a backward clock; snapshots cannot reset it", () => {
  let time = 999;
  const options = { ...config, cap: 2, now: () => time };
  const spend = createXSpendCounter(options);
  options.cap = 100;
  spend.reserve();
  expect(() => spend.reserve()).toThrow("cap");
  expect(Object.isFrozen(spend.snapshot())).toBe(true);
  time = 1000;
  spend.reserve();
  time = 0;
  expect(() => spend.reserve()).toThrow("cap");
  expect(spend.snapshot()).toEqual({ periodStart: 1000, spent: 2 });
  expect(createXSpendCounter(config).snapshot().spent).toBe(0);
});

it("shares one budget across readers and accounts; zero or sub-call caps refuse", async () => {
  const r = reader([{}, {}, {}]);
  const other = createXReader(r.options);
  await r.binding.ingest.list(account, undefined, bounds);
  await other.ingest.list({ id: "another" }, undefined, bounds);
  await other.ingest.list(account, undefined, bounds);
  await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow("cap");
  for (const cap of [0, 1]) {
    const spend = createXSpendCounter({ ...config, cap });
    expect(() => spend.reserve()).toThrow("cap");
    expect(spend.snapshot().spent).toBe(0);
  }
});

it.each([
  { cap: -1 },
  { cap: NaN },
  { cap: 0.5 },
  { cap: Infinity },
  { costPerCall: 0 },
  { costPerCall: -1 },
  { costPerCall: Infinity },
  { periodMs: 0 },
  { periodMs: -1 },
  { periodMs: Number.MAX_SAFE_INTEGER + 1 },
])("rejects invalid spend configuration %o", (extra) => {
  expect(() => createXSpendCounter({ ...config, ...extra })).toThrow(RangeError);
});

it.each([NaN, -1, Infinity, 0.5])("rejects invalid accounting clocks (%s)", (time) => {
  const spend = createXSpendCounter({ ...config, now: () => time });
  expect(() => spend.reserve()).toThrow("clock");
});

it.each([
  400, 401, 403, 429, 500,
])("retains reservations for HTTP %s without retrying", async (status) => {
  const r = reader([new Response("private provider text", { status })]);
  await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow(`HTTP ${status}`);
  expect(r.spend.snapshot().spent).toBe(2);
  expect(r.transport).toHaveBeenCalledTimes(1);
});

it("retains reservations on transport and credential failures and refuses wrong-scope grants", async () => {
  const r = reader([new Error("private transport error")]);
  await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow(
    "binding transport",
  );
  const tokens: TokenProvider = {
    read: vi.fn(async () => ({ access: "send", accessToken: "fixture" }) as never),
    send: vi.fn(),
  };
  const wrong = createXReader({ ...r.options, tokens });
  await expect(wrong.ingest.list(account, undefined, bounds)).rejects.toThrow("wrong-scope");
  tokens.read = vi.fn(async () => {
    throw new Error("credential unavailable");
  });
  await expect(wrong.ingest.list(account, undefined, bounds)).rejects.toThrow("unavailable");
  expect(r.spend.snapshot().spent).toBe(6);
  expect(tokens.send).not.toHaveBeenCalled();
  expect(r.transport).toHaveBeenCalledTimes(1);
});

it("refuses redirects and snapshots origins against exported-set mutations", async () => {
  (ORIGINS as Set<string>).add("https://attacker.example");
  const r = reader([
    new Response(null, { status: 302, headers: { location: "https://attacker.example" } }),
  ]);
  (r.binding.origins as Set<string>).add("https://attacker.example");
  await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow(
    "refused redirect",
  );
  expect(String(r.transport.mock.calls[0]?.[0])).toContain("https://api.x.com/");
  expect(r.transport).toHaveBeenCalledTimes(1);
  (ORIGINS as Set<string>).delete("https://attacker.example");
});

it.each([
  "not json",
  "null",
  "[]",
  cursor("x", { account: "another" }),
  cursor("x", { extra: true }),
  cursor(null),
  cursor("https://attacker.example"),
  cursor("a".repeat(2049)),
])("rejects hostile/account-mismatched cursors before reserving (%s)", async (state) => {
  const r = reader();
  await expect(r.binding.ingest.list(account, state, bounds)).rejects.toThrow(ChannelParseError);
  expect(r.spend.snapshot().spent).toBe(0);
  expect(r.transport).not.toHaveBeenCalled();
});

it.each([
  { maxItems: 0 },
  { maxItems: NaN },
  { maxBytes: 0 },
  { maxBytes: 0.5 },
])("rejects invalid bounds %o", async (limits) => {
  const r = reader();
  await expect(r.binding.ingest.list(account, undefined, { ...bounds, ...limits })).rejects.toThrow(
    RangeError,
  );
  expect(r.tokens.calls).toEqual([]);
});

it("rejects invalid accounts before reserving", async () => {
  const r = reader();
  await expect(r.binding.ingest.list({ id: "" }, undefined, bounds)).rejects.toThrow("account");
  expect(r.spend.snapshot().spent).toBe(0);
});

it.each([
  new Response("not json"),
  { errors: [{ detail: "secret" }] },
  { data: {} },
  { data: null },
  { data: [fixture.data[0], fixture.data[0], fixture.data[0]] },
  { meta: null },
  { meta: { next_token: "https://attacker.example" } },
])("refuses malformed provider pages without leaking contents", async (reply) => {
  const r = reader([reply]);
  await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow(
    ChannelParseError,
  );
});

it("refuses repeated page tokens and whole-page byte overflow without advancing a cursor", async () => {
  const r = reader([fixture, fixture]);
  await expect(
    r.binding.ingest.list(account, cursor(fixture.meta.next_token), bounds),
  ).rejects.toThrow("repeated");
  await expect(
    r.binding.ingest.list(account, undefined, { ...bounds, maxBytes: 1 }),
  ).rejects.toThrow("byte bound");
});

it.each([
  null,
  [],
  { ...fixture.data[0], id: "x" },
  { ...fixture.data[0], sender_id: null },
  ...["ParticipantsJoin", undefined].map((eventType) => ({
    ...fixture.data[0],
    event_type: eventType,
  })),
  ...[null, "x".repeat(16385)].map((text) => ({ ...fixture.data[0], text })),
  ...[null, "https://attacker.example"].map((dmConversationId) => ({
    ...fixture.data[0],
    dm_conversation_id: dmConversationId,
  })),
  ...[null, "not a date"].map((createdAt) => ({ ...fixture.data[0], created_at: createdAt })),
])("rejects invalid inbound events (%o)", (row) => {
  const r = reader();
  expect(() => r.binding.ingest.parse({ id: "1234567890", raw: JSON.stringify(row) })).toThrow(
    ChannelParseError,
  );
});

it("parses byte input from raw rather than native; strips controls and enforces raw bounds", () => {
  const r = reader();
  const text = JSON.stringify({ ...fixture.data[0], text: "Hi\u0000\u202e there\r\n\tNext line" });
  expect(
    r.binding.ingest.parse({ id: fixture.data[0].id, raw: Buffer.from(text), native: {} }).textBody,
  ).toBe("Hi there\r\n\tNext line");
  expect(() => r.binding.ingest.parse({ id: "0", raw: text })).toThrow("mismatch");
  for (const raw of [
    new Uint8Array([255]),
    new Uint8Array(1024 * 1024 + 1),
    " ".repeat(1024 * 1024 + 1),
    "[".repeat(20),
  ])
    expect(() => r.binding.ingest.parse({ id: "0", raw })).toThrow(ChannelParseError);
});
