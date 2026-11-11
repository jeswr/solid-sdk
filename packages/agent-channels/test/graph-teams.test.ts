// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes, recordFromTurtle } from "@jeswr/agent-model";
import { expect, it, vi } from "vitest";
import { capabilityToTurtle } from "../src/capability.js";
import { encodeEnvelope } from "../src/envelope.js";
import { ChannelParseError } from "../src/errors.js";
import { CARD_TYPE, card, envelopes } from "../src/graph-teams/card.js";
import { collection, graphTeamsRest, id, json, nextLink } from "../src/graph-teams/rest.js";
import { createGraphTeamsReader, ORIGINS } from "../src/graph-teams.js";
import { htmlToText } from "../src/html.js";
import { TEAMS_CARD } from "../src/profiles.js";
import { fixtureTransport } from "./fixtures/graph.js";
import { account } from "./fixtures/signed.js";
import { base, bounds, chat, cursor, item, page, path, reader, row } from "./fixtures/teams.js";

it("traverses paged chats, teams and channels with only read grants and stable conversation IDs", async () => {
  const next = `${base}${path}?$skiptoken=page2`;
  const chats2 = `${base}/me/chats?$skiptoken=chats2`;
  const teams2 = `${base}/me/joinedTeams?$skiptoken=teams2`;
  const channels2 = `${base}/teams/team/channels?$skiptoken=channels2`;
  const r = reader([
    page([{ id: chat }], chats2),
    page([row()], next),
    page([row({ id: "2", replyToId: "1" })]),
    page(),
    page([{ id: "team" }], teams2),
    page([{ id: "channel" }], channels2),
    page([row(), row({ id: "3", replyToId: "1" })]),
    page(),
    page(),
  ]);
  const result = await r.binding.ingest.list(account, undefined, bounds);
  expect(result.items).toHaveLength(4);
  const messages = result.items.map(r.binding.ingest.parse);
  expect(messages[0]).toMatchObject({
    channel: "teams",
    sender: { handle: "sender-id", displayName: "Display Name" },
    textBody: "Hello @Display Name & all",
    threadId: `teams:chat:${encodeURIComponent(chat)}`,
    date: "2026-10-26T11:59:00.000Z",
    rawMediaType: "application/json",
    warnings: ["identity-unverified"],
  });
  expect(messages[0]?.rawSha256).toBe(digestBytes(result.items[0]?.raw as string).slice(8));
  expect(messages[1]?.threadId).toBe(messages[0]?.messageId);
  expect(messages[2]?.threadId).toBe("teams:channel:team:channel:1");
  expect(messages[3]?.threadId).toBe(messages[2]?.messageId);
  expect(messages[3]?.signals["teams-conversation"]).toBe("teams:channel:team:channel");
  expect(r.binding.ingest.threadKey?.(messages[0] as never)).toBe(messages[0]?.threadId);
  expect(r.tokens.calls.every((call) => call.access === "read")).toBe(true);
  expect(r.requests.every((request) => request.url.origin === "https://graph.microsoft.com")).toBe(
    true,
  );
  expect(r.requests.map((request) => request.url.href)).toContain(next);
  expect(r.queue).toEqual([]);
  expect(JSON.parse(result.next)).toMatchObject({ jobs: [], pending: [] });
  r.queue.push(page(), page());
  expect((await r.binding.ingest.list(account, result.next, bounds)).items).toEqual([]);
  expect(r.binding.carriage).toBe(TEAMS_CARD);
});

it.each([
  "joinedTeams",
  "channels",
  "messages",
])("keeps chats working after channel scope 403 at %s and serializes the degraded RDF descriptor", async (scope) => {
  const forbidden = new Response("private body and token", { status: 403 });
  const replies: unknown[] = [page([{ id: chat }]), page([row()])];
  if (scope !== "joinedTeams") replies.push(page([{ id: "team" }]));
  if (scope === "messages") replies.push(page([{ id: "channel" }]));
  replies.push(forbidden);
  const r = reader(replies);
  expect(r.binding.describe("connected").description).toContain("Channels: read");
  expect((await r.binding.ingest.list(account, undefined, bounds)).items).toHaveLength(1);
  const capability = r.binding.describe("connected");
  expect(capability).toMatchObject({
    binding: "graph-teams",
    sendSupported: true,
    carriage: "teams-card/0.1",
    credentialState: "connected",
  });
  expect(capability.description).toContain("Channels: unavailable (HTTP 403");
  expect(await recordFromTurtle(await capabilityToTurtle(capability), capability.id)).toEqual(
    capability,
  );
  r.queue.push(page([{ id: chat }]), page([row()]), page());
  expect((await r.binding.ingest.list(account, undefined, bounds)).items).toHaveLength(1);
  const blocked = reader([new Response("private body", { status: 403 })]);
  await expect(blocked.binding.ingest.list(account, undefined, bounds)).rejects.toThrow("HTTP 403");
  expect(blocked.binding.describe("connected").description).toContain("Channels: read");
});

it("retains pending messages across reader restarts and respects item and aggregate byte bounds", async () => {
  const r = reader([page([row(), row({ id: "2" }), row({ id: "3" })])]);
  const first = await r.binding.ingest.list(account, cursor(), { ...bounds, maxItems: 1 });
  expect(first.items).toHaveLength(1);
  expect(JSON.parse(first.next).pending).toHaveLength(2);
  const restarted = reader([]);
  const second = await restarted.binding.ingest.list(account, first.next, {
    ...bounds,
    maxBytes: Buffer.byteLength(first.items[0]?.raw as string),
  });
  expect(second.items.map((i) => i.id.split(":").at(-1))).toEqual(["2"]);
  const third = await restarted.binding.ingest.list(account, second.next, bounds);
  expect(third.items.map((i) => i.id.split(":").at(-1))).toEqual(["3"]);
  expect(restarted.requests).toHaveLength(0);
  await expect(
    reader([page([row()])]).binding.ingest.list(account, cursor(), { ...bounds, maxBytes: 1 }),
  ).rejects.toThrow("byte bound");
});

it("accepts Graph's raw and percent-encoded Teams IDs without widening the collection pin", async () => {
  const rawLink = `${base}/me/chats/${chat}/messages?$skiptoken=raw`;
  const r = reader([page([row()], rawLink), page([row({ id: "2" })])]);
  const result = await r.binding.ingest.list(account, cursor(), bounds);
  expect(result.items).toHaveLength(2);
  expect(r.requests[1]?.url.href).toBe(`${base}${path}?$skiptoken=raw`);
  expect(collection(`${base}/me/chats/%63hat/messages`).pathname).toBe(
    "/v1.0/me/chats/chat/messages",
  );
});

it("skips events, deleted messages and malformed individual cards while preserving later valid messages", async () => {
  const r = reader([
    page([
      { messageType: "systemEventMessage" },
      row({ id: "%malformed" }),
      row({ messageType: "systemEventMessage" }),
      row({ id: "deleted", deletedDateTime: "2026-10-26" }),
      row({
        id: "broken",
        attachments: [{ contentType: CARD_TYPE, content: "private invalid card" }],
      }),
      row({ id: "ok", from: { user: { id: "sender" } } }),
    ]),
  ]);
  const result = await r.binding.ingest.list(account, cursor(), bounds);
  expect(result.items).toHaveLength(1);
  expect(r.binding.ingest.parse(result.items[0] as never).sender).toEqual({ handle: "sender" });
});

it("projects HTML and mentions to control-free text, drops closed/unclosed active content and decodes entities once", () => {
  expect(
    htmlToText(
      '<p>Hi <at id="0">Display Name</at>&nbsp;&amp; &#x1f642;<br>A\tB\u0001\u202e</p><style>private</style><script>private</script><!--private-->',
    ),
  ).toBe("Hi @Display Name & 🙂\nA\tB");
  for (const tail of [
    "<script>private",
    "<STYLE>private",
    "<script private",
    "<style private",
    "<!--private",
    "<".repeat(65536),
  ])
    expect(htmlToText(`safe${tail}`)).toBe("safe");
  expect(htmlToText("&lt;script&gt;literal&lt;/script&gt; &amp;lt;")).toBe(
    "<script>literal</script> &lt;",
  );
  expect(() => htmlToText(null)).toThrow(ChannelParseError);
});

it("rejects hostile messages without echoing content, and ignores native metadata", () => {
  const r = reader([]);
  for (const bad of [
    { ...item(), id: "wrong" },
    { id: "x", raw: "private secret" },
    { ...item(), raw: new Uint8Array([255]) },
    { ...item(), raw: JSON.stringify({ message: row() }) },
    { ...item(), raw: JSON.stringify({ path: "/me/chats", message: row() }) },
    item({ messageType: "systemEventMessage" }),
    item({ deletedDateTime: "deleted" }),
    item({ body: null }),
    item({ body: { contentType: "html", content: 12 } }),
    item({ body: { contentType: "unsafe", content: "private" } }),
    item({ from: { application: { id: "app" } } }),
    item({ createdDateTime: 42 }),
    item({ createdDateTime: "bad" }),
    item({ replyToId: "%private" }),
    item({ body: { contentType: "text", content: "private".repeat(11000) } }),
  ]) {
    expect(() => r.binding.ingest.parse(bad)).toThrow("invalid Teams inbound message");
  }
  expect(r.binding.ingest.parse({ ...item(), native: { body: "ignored" } }).textBody).toBe(
    "Hello @Display Name & all",
  );
  expect(r.binding.ingest.parse({ ...item(), raw: Buffer.from(item().raw) }).textBody).toContain(
    "Hello",
  );
});

it("detects and bounds card envelopes, ignores unrelated attachments and refuses conflicting carriers", () => {
  expect(envelopes(undefined)).toEqual([]);
  expect(envelopes([{ contentType: "image/png", contentUrl: "https://evil.test" }])).toEqual([]);
  expect(envelopes([card("hello", "a.b.c"), card("hello", "a.b.c")])).toEqual([
    encodeEnvelope("a.b.c"),
  ]);
  const attachment = (value: unknown) => [
    { contentType: CARD_TYPE, content: JSON.stringify(value) },
  ];
  expect(envelopes(attachment({ type: "AdaptiveCard", version: "1.2", body: [] }))).toEqual([]);
  expect(
    envelopes(attachment({ type: "AdaptiveCard", version: "1.2", body: [], data: {} })),
  ).toEqual([]);
  for (const value of [
    null,
    Array(513).fill({}),
    [null],
    [{ contentType: CARD_TYPE, content: {} }],
    attachment({}),
    attachment({ type: "AdaptiveCard" }),
    attachment({ type: "AdaptiveCard", version: "1.2" }),
    attachment({ type: "AdaptiveCard", version: "1.2", body: [], data: null }),
    attachment({
      type: "AdaptiveCard",
      version: "1.2",
      body: [],
      data: { envelope: { "@context": "https://evil.test/private" } },
    }),
    [{ contentType: CARD_TYPE, content: "x".repeat(65537) }],
    [card("hello", "a.b.c"), card("hello", "a.b.d")],
  ])
    expect(() => envelopes(value)).toThrow();
});

it("refuses cross-origin, cross-operation and repeated paging without leaking tokens or content", async () => {
  const current = collection(`${base}${path}`);
  for (const next of [
    `https://evil.test/private`,
    `${base}/me/chats?access_token=private`,
    `${base}/me/chats`,
    current.href,
  ]) {
    await expect(
      reader([page([], next)]).binding.ingest.list(account, cursor(), bounds),
    ).rejects.toThrow(/invalid Teams/);
  }
  const r = reader([new Response("secret envelope", { status: 500 }), page()]);
  const saved = cursor();
  await expect(r.binding.ingest.list(account, saved, bounds)).rejects.toThrow(
    "Graph Teams read failed: HTTP 500",
  );
  await r.binding.ingest.list(account, saved, bounds);
  expect(r.requests[0]?.url.href).toBe(r.requests[1]?.url.href);
  expect(() => nextLink(`${base}/me/joinedTeams`, current)).toThrow("continuation");
  const transport = reader([new Error("private provider detail")]);
  await expect(
    transport.binding.ingest.list(
      account,
      cursor({ jobs: [`${base}${path}?$skiptoken=private-envelope`] }),
      bounds,
    ),
  ).rejects.toThrow(/^Graph Teams read transport failed$/);
});

it("validates all saved cursor fields and bounds before credentials", async () => {
  const r = reader([]);
  for (const bad of [
    "null",
    "[]",
    "{}",
    "x".repeat(1024 * 1024 + 1),
    cursor({ account: "other" }),
    cursor({ extra: true }),
    cursor({ jobs: null }),
    cursor({ jobs: Array(513).fill(`${base}/me/chats`) }),
    cursor({ jobs: ["https://evil.test/private"] }),
    cursor({ pending: null }),
    cursor({ pending: Array(513).fill(item()) }),
    cursor({ pending: [null] }),
    cursor({ pending: [{}] }),
    cursor({ pending: [{ id: "x", raw: 1 }] }),
    cursor({ pending: [{ id: "x", raw: "private" }] }),
    cursor({ pages: -1 }),
    cursor({ pages: 513 }),
    cursor({ pages: 1.5 }),
  ])
    await expect(r.binding.ingest.list(account, bad, bounds)).rejects.toThrow();
  for (const invalid of [
    { maxItems: 0, maxBytes: 1 },
    { maxItems: NaN, maxBytes: 1 },
    { maxItems: 1, maxBytes: 0 },
    { maxItems: 1, maxBytes: Infinity },
  ])
    await expect(r.binding.ingest.list(account, undefined, invalid)).rejects.toThrow("bounds");
  expect(r.tokens.calls).toEqual([]);
});

it("bounds total scan pages, per-call requests and queued collections even with cyclic pagination", async () => {
  const pages = Array.from({ length: 32 }, (_, i) => page([], `${base}${path}?$skiptoken=${i}`));
  const r = reader(pages);
  const result = await r.binding.ingest.list(account, cursor(), bounds);
  expect(r.requests).toHaveLength(32);
  expect(JSON.parse(result.next).pages).toBe(34);
  await expect(
    reader([]).binding.ingest.list(account, cursor({ pages: 512 }), bounds),
  ).rejects.toThrow("page bound");
  const jobs = Array(512).fill(`${base}/me/chats`);
  await expect(
    reader([page([{ id: "new" }, { id: "new2" }])]).binding.ingest.list(
      account,
      cursor({ jobs }),
      bounds,
    ),
  ).rejects.toThrow("collection bound");
});

it("fails closed on malformed pages, and snapshots declared origins", async () => {
  for (const bad of [
    null,
    {},
    { value: null },
    { value: Array(513).fill({}) },
    page([null]),
    page([{ id: "../bad" }]),
    new Response("private json"),
  ])
    await expect(reader([bad]).binding.ingest.list(account, undefined, bounds)).rejects.toThrow();
  const tokens = {
    read: vi.fn(async () => ({ access: "send", accessToken: "private" })),
    send: vi.fn(),
  };
  await expect(
    createGraphTeamsReader({ tokens: tokens as never }).ingest.list(account, undefined, bounds),
  ).rejects.toThrow("wrong-scope");
  const original = new Set(ORIGINS);
  (ORIGINS as Set<string>).add("https://evil.test");
  expect(reader([]).binding.origins).toEqual(original);
  (ORIGINS as Set<string>).delete("https://evil.test");
});

it("restricts endpoint and ID syntax, JSON bytes, depth and UTF-8", async () => {
  for (const bad of [null, "", ".", "..", "%x", "x".repeat(2049)])
    expect(() => id(bad)).toThrow("Teams id");
  for (const bad of [
    null,
    "",
    "x".repeat(8193),
    `${base}/me/chats\n`,
    `${base}/me/chats#private`,
    `${base.replace("https://", "https://user@")}/me/chats`,
    `${base.replace("https://", "https://user:private@")}/me/chats`,
    `${base}/me/sendMail`,
    `${base}/me/chats/%ZZ/messages`,
    `${base}/me/chats?$top=1&$top=2`,
    `${base}/me/chats?$skiptoken=`,
    `${base}/me/chats?access_token=private`,
  ])
    expect(() => collection(bad)).toThrow("collection link");
  expect(collection(`${base}/me/chats?$top=50&$skip=1&$skiptoken=token`).origin).toBe(
    "https://graph.microsoft.com",
  );
  for (const bad of ["private", "[]", "x".repeat(65537), new Uint8Array([255])])
    expect(() => json(bad)).toThrow("invalid Teams JSON");
  expect(json(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
  const fake = fixtureTransport([]);
  await expect(
    graphTeamsRest(fake.options)(
      "https://evil.test/messages",
      account,
      reader([]).tokens,
      "send",
      "private",
    ),
  ).rejects.toThrow("send target");
});
