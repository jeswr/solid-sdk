// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes, recordFromTurtle } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import { detectBridgeCapability } from "../../agentic-legacy-bridge/src/negotiate.js";
import { capabilityToTurtle } from "../src/capability.js";
import type { InboundRawMessage } from "../src/channel.js";
import { cleanText, readJson, record, snowflake } from "../src/discord/shared.js";
import {
  createDiscordReader,
  DISCORD_INTENTS,
  type DiscordGatewaySource,
  GATEWAY_INTENTS,
  ORIGINS,
} from "../src/discord.js";
import { ChannelParseError } from "../src/errors.js";
import { AGENT_FOOTER, DISCORD_FOOTER } from "../src/profiles.js";
import { InMemoryDiscordGateway, RecordingTokenProvider } from "../src/testing.js";
import type { TokenProvider } from "../src/types.js";
import { account } from "./fixtures/signed.js";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/discord.json", import.meta.url), "utf8"),
);
const guild = JSON.stringify(fixtures.guild);
const dm = JSON.stringify(fixtures.dm);
const bounds = { maxItems: 10, maxBytes: 65536 };
function reader(events: readonly (string | Uint8Array)[] = [guild, dm]) {
  const tokens = new RecordingTokenProvider();
  const gateway = new InMemoryDiscordGateway(new Map([[account.id, events]]));
  return { tokens, gateway, binding: createDiscordReader({ tokens, gateway }) };
}
const rawItem = (event: typeof fixtures.guild) => ({ id: event.d.id, raw: JSON.stringify(event) });

it("requests exactly the three bot intents and ingests guild channels and bot DMs without sending", async () => {
  const r = reader();
  const first = await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 });
  const second = await r.binding.ingest.list(account, first.next, bounds);
  expect(r.binding.send).toBeUndefined();
  expect(GATEWAY_INTENTS).toEqual({
    GUILD_MESSAGES: 512,
    DIRECT_MESSAGES: 4096,
    MESSAGE_CONTENT: 32768,
  });
  expect(DISCORD_INTENTS).toBe(37376);
  expect(r.gateway.calls[0]).toMatchObject({
    origin: "wss://gateway.discord.gg",
    intents: 37376,
    account,
    cursor: undefined,
  });
  expect(r.gateway.calls[1]?.cursor).toBe("1");
  expect(r.gateway.calls[0]).not.toHaveProperty("accessToken");
  expect(r.tokens.calls.map((c) => c.access)).toEqual(["read", "read"]);
  expect(r.binding.ingest.parse(first.items[0] as InboundRawMessage)).toMatchObject({
    channel: "discord",
    textBody: "Guild message",
    sender: { handle: fixtures.guild.d.author.id, displayName: "Fixture User" },
    threadId: fixtures.guild.d.channel_id,
  });
  const parsed = r.binding.ingest.parse(second.items[0] as InboundRawMessage);
  expect(parsed).toMatchObject({
    textBody: "Bot DM",
    sender: { displayName: "fixture-dm-user" },
    messageId: fixtures.dm.d.id,
  });
  expect(parsed.rawSha256).toBe(digestBytes(dm).slice(8));
  expect(parsed.rawByteLength).toBe(Buffer.byteLength(dm));
  expect(parsed.rawMediaType).toBe("application/json");
  expect(parsed.warnings).toEqual(["identity-unverified"]);
  expect(parsed.jsonLdBlocks).toBeUndefined();
  expect(r.binding.ingest.threadKey?.(parsed)).toBe(fixtures.dm.d.channel_id);
  expect(r.binding.ingest.threadKey?.({ ...parsed, threadId: undefined })).toBeUndefined();
  expect((await r.binding.ingest.list(account, second.next, bounds)).items).toEqual([]);
  expect(await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 })).toEqual(
    first,
  );
});

it("bounds aggregate bytes and leaves the next event available; snapshots mutable fake buffers", async () => {
  const bytes = new Uint8Array(Buffer.from(dm));
  const events = [guild, bytes];
  const r = reader(events);
  bytes.fill(0);
  const first = await r.binding.ingest.list(account, undefined, {
    ...bounds,
    maxBytes: Buffer.byteLength(guild),
  });
  expect(first.items).toHaveLength(1);
  const second = await r.binding.ingest.list(account, first.next, bounds);
  expect(r.binding.ingest.parse(second.items[0] as InboundRawMessage).textBody).toBe("Bot DM");
  ((second.items[0] as InboundRawMessage).raw as Uint8Array).fill(0);
  expect(
    r.binding.ingest.parse(
      (await r.binding.ingest.list(account, first.next, bounds)).items[0] as InboundRawMessage,
    ).textBody,
  ).toBe("Bot DM");
  await expect(
    r.binding.ingest.list(account, undefined, { ...bounds, maxBytes: 1 }),
  ).rejects.toThrow("Gateway read failed");
  expect((await r.binding.ingest.list({ id: "other-account" }, undefined, bounds)).items).toEqual(
    [],
  );
  await expect(
    r.gateway.read({
      origin: "wss://gateway.discord.gg",
      account,
      accessToken: "fake",
      intents: DISCORD_INTENTS,
      cursor: "99",
      limits: bounds,
    }),
  ).rejects.toThrow("offset");
});

it("ignores other Gateway dispatches and control frames; refuses malformed dispatch data", async () => {
  const r = reader([
    JSON.stringify({ op: 11 }),
    JSON.stringify({ op: 0, t: "MESSAGE_UPDATE", d: {} }),
    guild,
  ]);
  expect((await r.binding.ingest.list(account, undefined, bounds)).items).toHaveLength(1);
  const malformed = reader([JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: null })]);
  await expect(malformed.binding.ingest.list(account, undefined, bounds)).rejects.toBeInstanceOf(
    ChannelParseError,
  );
});

it("keeps footer URLs as unverified discovery text, including control-stripped footer-only messages", () => {
  const event = structuredClone(fixtures.guild);
  event.d.content = "\u0000Hello\nworld\u202e";
  event.d.author.global_name = "\u0000User\u202e";
  event.d.embeds = [{ footer: { text: AGENT_FOOTER } }, { description: "ignored structured data" }];
  const parsed = reader().binding.ingest.parse(rawItem(event));
  expect(parsed.textBody).toBe(`Hello\nworld\n${AGENT_FOOTER}`);
  expect(parsed.sender?.displayName).toBe("User");
  expect(parsed.signals).toEqual({});
  expect(
    detectBridgeCapability({ headers: parsed.signals, textBody: parsed.textBody }),
  ).toMatchObject({ capable: true, carriage: "footer-url-only" });
  expect(parsed.jsonLdBlocks).toBeUndefined();
  expect(cleanText("a\tb", 3)).toBe("a\tb");
});

it("matches the descriptor golden, with RDF-visible user-DM limitations and zero owner allowances", async () => {
  const r = reader();
  const capability = r.binding.describe("connected");
  expect(capability).toMatchObject({
    structuredPayload: false,
    carriage: DISCORD_FOOTER.id,
    maxMessageBytes: 8192,
    rateLimit: { perRecipient: 0, perDay: 0 },
    credentialState: "connected",
  });
  expect(capability.description).toContain("Personal user DMs are unavailable");
  const turtle = await capabilityToTurtle(capability);
  expect(`# AUTHORED-BY Codex GPT-6.1-Sol\n${turtle}`).toBe(
    readFileSync(new URL("./fixtures/discord-capability.ttl", import.meta.url), "utf8"),
  );
  expect(await recordFromTurtle(turtle, capability.id)).toEqual(capability);
  expect([...r.binding.origins]).toEqual([...ORIGINS]);
  (ORIGINS as Set<string>).add("https://attacker.example");
  expect(
    createDiscordReader({ tokens: r.tokens, gateway: r.gateway }).origins.has(
      "https://attacker.example",
    ),
  ).toBe(false);
  (ORIGINS as Set<string>).delete("https://attacker.example");
});

it.each([
  0,
  -1,
  0.5,
  NaN,
  Infinity,
])("refuses invalid list bounds (%s) before credentials", async (bad) => {
  const r = reader();
  for (const limits of [
    { maxItems: bad, maxBytes: 1 },
    { maxItems: 1, maxBytes: bad },
  ])
    await expect(r.binding.ingest.list(account, undefined, limits)).rejects.toThrow(RangeError);
  expect(r.tokens.calls).toEqual([]);
});

it.each([
  "null",
  "[]",
  "{",
  JSON.stringify({ account: "elsewhere", checkpoint: "0" }),
  JSON.stringify({ account: account.id, checkpoint: 2 }),
  JSON.stringify({ account: account.id, checkpoint: "\n" }),
  JSON.stringify({ account: account.id, checkpoint: "a".repeat(2049) }),
  JSON.stringify({ account: account.id, checkpoint: "0", extra: true }),
])("refuses malformed or cross-account cursors (%s)", async (cursor) => {
  const r = reader();
  await expect(r.binding.ingest.list(account, cursor, bounds)).rejects.toBeInstanceOf(
    ChannelParseError,
  );
  expect(r.tokens.calls).toEqual([]);
});

it("fails closed on wrong-scope grants and sanitizes Gateway exceptions", async () => {
  const read = vi.fn(async () => {
    throw new Error("sensitive transport details");
  });
  const tokens = new RecordingTokenProvider();
  await expect(
    createDiscordReader({ tokens, gateway: { read } }).ingest.list(account, undefined, bounds),
  ).rejects.toThrow(/^Discord Gateway read failed$/);
  const invalid = {
    read: async () => ({ access: "send", accessToken: "fake" }),
  } as unknown as TokenProvider;
  await expect(
    createDiscordReader({ tokens: invalid, gateway: { read } }).ingest.list(
      account,
      undefined,
      bounds,
    ),
  ).rejects.toThrow("wrong-scope");
  expect(read).toHaveBeenCalledTimes(1);
});

it.each([
  { events: [guild, dm], next: "ok", limits: { ...bounds, maxItems: 1 } },
  { events: [guild], next: "ok", limits: { ...bounds, maxBytes: 1 } },
  { events: [new Uint8Array(65537)], next: "ok", limits: { ...bounds, maxBytes: 100000 } },
  { events: {}, next: "ok", limits: bounds },
  { events: [42], next: "ok", limits: bounds },
  { events: [], next: 42, limits: bounds },
])("refuses out-of-contract Gateway batches", async ({ events, next, limits }) => {
  const gateway = { read: async () => ({ events, next }) } as unknown as DiscordGatewaySource;
  await expect(
    createDiscordReader({ tokens: new RecordingTokenProvider(), gateway }).ingest.list(
      account,
      undefined,
      limits,
    ),
  ).rejects.toThrow();
});

it.each([
  (e: typeof fixtures.guild) => {
    e.d.id = "../1";
  },
  (e: typeof fixtures.guild) => {
    e.d.channel_id = "0";
  },
  (e: typeof fixtures.guild) => {
    e.d.guild_id = "invalid";
  },
  (e: typeof fixtures.guild) => {
    e.d.author = null;
  },
  (e: typeof fixtures.guild) => {
    e.d.author.id = "invalid";
  },
  (e: typeof fixtures.guild) => {
    e.d.author.global_name = 42;
  },
  (e: typeof fixtures.guild) => {
    e.d.content = "x".repeat(4001);
  },
  (e: typeof fixtures.guild) => {
    e.d.content = {};
  },
  (e: typeof fixtures.guild) => {
    e.d.embeds = null;
  },
  (e: typeof fixtures.guild) => {
    e.d.embeds = Array(11).fill({});
  },
  (e: typeof fixtures.guild) => {
    e.d.embeds = [{ footer: null }];
  },
  (e: typeof fixtures.guild) => {
    e.d.embeds = [{ footer: { text: "x".repeat(2049) } }];
  },
  (e: typeof fixtures.guild) => {
    e.d.timestamp = false;
  },
  (e: typeof fixtures.guild) => {
    e.d.timestamp = "invalid";
  },
])("refuses hostile message fields", (change) => {
  const event = structuredClone(fixtures.guild);
  change(event);
  expect(() => reader().binding.ingest.parse(rawItem(event))).toThrow(ChannelParseError);
});

it("rejects invalid UTF-8, excessive bytes, invalid objects and mismatched raw/native identities", () => {
  for (const raw of ["[", "[]", "null", "x".repeat(65537), new Uint8Array([255])])
    expect(() => readJson(raw)).toThrow(ChannelParseError);
  for (const value of [false, null, []]) expect(() => record(value)).toThrow(ChannelParseError);
  for (const id of [1, "0", "-1", "01", "18446744073709551616", "1".repeat(21)])
    expect(() => snowflake(id)).toThrow(ChannelParseError);
  expect(snowflake("18446744073709551615")).toBe("18446744073709551615");
  const parse = reader().binding.ingest.parse;
  expect(() => parse({ id: "other", raw: guild, native: fixtures.dm })).toThrow("id mismatch");
  expect(() => parse({ id: "other", raw: '{"op":11}' })).toThrow("id mismatch");
});
