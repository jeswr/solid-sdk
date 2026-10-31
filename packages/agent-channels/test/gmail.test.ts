// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import type { guardedFetch } from "@jeswr/guarded-fetch";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { emailMessageIdFor, MAX_EMAIL_BYTES } from "../src/email-mime.js";
import {
  gmailRest,
  historyId,
  messageId,
  opaque,
  rawMessage,
  record,
  responseBody,
} from "../src/gmail/rest.js";
import { createGmailSend } from "../src/gmail/send.js";
import { createGmailReader, ORIGINS } from "../src/gmail.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";

const fixtures = JSON.parse(readFileSync(new URL("fixtures/gmail.json", import.meta.url), "utf8"));
const from = "sender@example.test";
const recipient = "receiver@example.test";
const bounds = { maxItems: 2, maxBytes: 100000 };
const raw =
  "From: sender@example.test\r\nTo: receiver@example.test\r\nSubject: Fixture\r\nMessage-ID: <one@example.test>\r\nIn-Reply-To: <thread@example.test>\r\n\r\nHello fixture";
const native = (id: string, bytes = raw) => ({
  id,
  threadId: "ab",
  historyId: "110",
  raw: Buffer.from(bytes).toString("base64url"),
});
function fixtureTransport(replies: unknown[]) {
  const requests: { url: URL; method: string | undefined; headers: Headers; body: string }[] = [];
  const queue = [...replies];
  const transport = vi.fn<typeof guardedFetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? await new Response(init.body).text() : "";
    requests.push({ url, headers, body, method: init?.method });
    if (!queue.length) throw new Error("fixture exhausted");
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json(reply);
  });
  return {
    requests,
    queue,
    transport,
    options: {
      createTransport: () => transport,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    },
  };
}
function reader(replies: unknown[]) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const config = {
    tokens,
    parseEmail,
    recipient,
    ownAccounts: new Set([recipient]),
    footer: AGENT_FOOTER,
    transport: fake.options,
  };
  return { ...fake, tokens, config, binding: createGmailReader(config) };
}
const historyCursor = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    account: account.id,
    mode: "history",
    start: "100",
    page: "",
    pending: [],
    resume: "",
    latest: "100",
    ...extra,
  });
function sender(replies: unknown[], extra: Record<string, unknown> = {}) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const verifyApproval = vi.fn(async () => true);
  const config = {
    from,
    footer: AGENT_FOOTER,
    recipients: new Map([[message.to?.actor as string, recipient]]),
    verify: verifyMessage,
    now: () => at,
    account,
    tokens,
    parseEmail,
    verifyApproval,
    transport: fake.options,
    ...extra,
  };
  return { ...fake, config, tokens, verifyApproval, send: createGmailSend(config) };
}

it("reads initial list/get fixtures then uses deduplicated messagesAdded history, checkpointing only fully drained pages", async () => {
  const r = reader([
    fixtures.profile,
    fixtures.messages,
    native("a1"),
    native("b2"),
    fixtures.history,
    native("a1"),
    native("c3"),
    fixtures.emptyHistory,
  ]);
  expect(r.binding.send).toBeUndefined();
  expect(r.binding.origins).toEqual(
    new Set(["https://gmail.googleapis.com", "https://www.googleapis.com"]),
  );
  expect(r.binding.describe("connected")).toMatchObject({
    binding: "gmail",
    carriage: "email-mime/0.1",
    credentialState: "connected",
    rateLimit: { perRecipient: 0, perDay: 0 },
  });
  const first = await r.binding.ingest.list(account, undefined, bounds);
  expect(first.items.map((i) => i.id)).toEqual(["a1", "b2"]);
  expect(first.items[0]?.raw).toEqual(new Uint8Array(Buffer.from(raw)));
  expect(JSON.parse(first.next)).toMatchObject({ mode: "history", start: "100" });
  const firstItem = first.items[0];
  if (!firstItem) throw new Error("missing fixture message");
  const parsed = r.binding.ingest.parse(firstItem);
  expect(parsed).toMatchObject({
    channel: "email",
    textBody: "Hello fixture",
    threadId: "thread@example.test",
    rawByteLength: Buffer.byteLength(raw),
  });
  expect(r.binding.ingest.threadKey?.(parsed)).toBe("thread@example.test");
  expect(r.binding.ingest.threadKey?.({ ...parsed, threadId: undefined })).toBeUndefined();
  const second = await r.binding.ingest.list(account, first.next, bounds);
  expect(second.items.map((i) => i.id)).toEqual(["a1", "c3"]);
  expect(JSON.parse(second.next).start).toBe("120");
  const empty = await r.binding.ingest.list(account, second.next, bounds);
  expect(empty.items).toEqual([]);
  expect(JSON.parse(empty.next).start).toBe("130");
  expect(r.requests[4]?.url.searchParams.get("startHistoryId")).toBe("100");
  expect(r.requests[4]?.url.searchParams.get("historyTypes")).toBe("messageAdded");
  for (const request of r.requests) {
    expect(request.url.origin).toBe("https://gmail.googleapis.com");
    expect(request.url.pathname).toContain("/users/me/");
    expect(request.method).toBe("GET");
    expect(request.url.search).not.toContain("token");
  }
  expect(r.tokens.calls.every((call) => call.access === "read")).toBe(true);
  expect(r.queue).toEqual([]);
});

it("retains byte-limited pending items, list page tokens and the pre-list baseline without losing concurrent arrivals", async () => {
  const r = reader([
    fixtures.profile,
    { ...fixtures.messages, nextPageToken: "page2" },
    native("a1"),
    native("b2"),
    native("b2"),
    { messages: [{ id: "c3" }] },
    native("c3"),
  ]);
  const limits = { ...bounds, maxBytes: Buffer.byteLength(raw) };
  const first = await r.binding.ingest.list(account, undefined, limits);
  expect(first.items).toHaveLength(1);
  expect(JSON.parse(first.next)).toMatchObject({ pending: ["b2"], resume: "page2", start: "100" });
  const second = await r.binding.ingest.list(account, first.next, limits);
  expect(second.items.map((i) => i.id)).toEqual(["b2"]);
  expect(JSON.parse(second.next)).toMatchObject({ page: "page2", pending: [] });
  const third = await r.binding.ingest.list(account, second.next, limits);
  expect(third.items.map((i) => i.id)).toEqual(["c3"]);
  expect(JSON.parse(third.next)).toMatchObject({ mode: "history", start: "100" });
  expect(r.requests[5]?.url.searchParams.get("pageToken")).toBe("page2");
});

it("bounds history items across calls and pages without advancing to the latest historyId early", async () => {
  const r = reader([
    { ...fixtures.history, nextPageToken: "next" },
    native("a1"),
    native("c3"),
    { history: [{ id: "125" }, { id: "126", messagesAdded: [] }], historyId: "140" },
  ]);
  const first = await r.binding.ingest.list(account, historyCursor(), { ...bounds, maxItems: 1 });
  expect(JSON.parse(first.next)).toMatchObject({
    pending: ["c3"],
    resume: "next",
    latest: "120",
    start: "100",
  });
  const second = await r.binding.ingest.list(account, first.next, bounds);
  expect(JSON.parse(second.next)).toMatchObject({ page: "next", start: "100" });
  const third = await r.binding.ingest.list(account, second.next, bounds);
  expect(third.items).toEqual([]);
  expect(JSON.parse(third.next).start).toBe("140");
});

it("falls back only on expired history (404), skips deleted messages and refuses other read failures", async () => {
  const r = reader([
    new Response(null, { status: 404 }),
    fixtures.profile,
    fixtures.messages,
    new Response(null, { status: 404 }),
    native("b2"),
  ]);
  const page = await r.binding.ingest.list(account, historyCursor(), bounds);
  expect(page.items.map((i) => i.id)).toEqual(["b2"]);
  expect(r.requests.map((i) => i.url.pathname.split("/").at(-1))).toEqual([
    "history",
    "profile",
    "messages",
    "a1",
    "b2",
  ]);
  for (const response of [
    new Response(null, { status: 401 }),
    new Response(null, { status: 429 }),
    new Error("network"),
  ]) {
    const failed = reader([response]);
    await expect(failed.binding.ingest.list(account, historyCursor(), bounds)).rejects.toThrow();
    expect(failed.requests).toHaveLength(1);
  }
  await expect(
    reader([fixtures.profile, fixtures.messages, native("a1")]).binding.ingest.list(
      account,
      undefined,
      { ...bounds, maxBytes: 1 },
    ),
  ).rejects.toThrow("byte bound");
});

it("refuses invalid account cursors, bounds, provider pages and credential grants before advancing", async () => {
  const r = reader([]);
  for (const bad of [
    "",
    "null",
    "[]",
    "{}",
    "x".repeat(65537),
    historyCursor({ account: "other" }),
    historyCursor({ extra: true }),
    historyCursor({ mode: "invalid" }),
    historyCursor({ pending: null }),
    historyCursor({ pending: Array(513).fill("a1") }),
    historyCursor({ start: "bad" }),
    historyCursor({ latest: 1 }),
    historyCursor({ pending: ["../x"] }),
    historyCursor({ page: "https://evil.test" }),
    historyCursor({ resume: null }),
  ])
    await expect(r.binding.ingest.list(account, bad, bounds)).rejects.toThrow();
  for (const bad of [
    { maxItems: 0, maxBytes: 1 },
    { maxItems: 1, maxBytes: 0 },
    { maxItems: NaN, maxBytes: 1 },
    { maxItems: 1, maxBytes: Infinity },
  ])
    await expect(r.binding.ingest.list(account, undefined, bad)).rejects.toThrow();
  expect(r.requests).toHaveLength(0);
  const badPages = [
    { history: 1 },
    { history: [null] },
    { history: [{ id: "105", messagesAdded: {} }] },
    { history: [{ id: "105", messagesAdded: [{ message: { id: "../" } }] }] },
    { ...fixtures.history, historyId: null },
    { ...fixtures.history, nextPageToken: "" },
    { ...fixtures.history, nextPageToken: "same" },
    {
      history: [
        {
          id: "105",
          messagesAdded: Array.from({ length: 513 }, (_, i) => ({ message: { id: `a${i}` } })),
        },
      ],
      historyId: "120",
    },
  ];
  for (const page of badPages)
    await expect(
      reader([page]).binding.ingest.list(account, historyCursor({ page: "same" }), bounds),
    ).rejects.toThrow();
  await expect(
    reader([fixtures.profile, { messages: {} }]).binding.ingest.list(account, undefined, bounds),
  ).rejects.toThrow();
  await expect(
    reader([fixtures.profile, {}]).binding.ingest.list(account, undefined, bounds),
  ).resolves.toMatchObject({ items: [] });
  const badGrant = { read: async () => ({ access: "send", accessToken: "fake" }), send: vi.fn() };
  const binding = createGmailReader({ ...r.config, tokens: badGrant as never });
  await expect(binding.ingest.list(account, undefined, bounds)).rejects.toThrow("wrong-scope");
  expect(badGrant.send).not.toHaveBeenCalled();
  expect(() => createGmailReader({ ...r.config, recipient: "unsafe" })).toThrow();
});

it("uses dry-run by default and requires approved exact MIME, account, signature, freshness and a send grant", async () => {
  const s = sender([fixtures.accepted]);
  const proposal = signed();
  const wire = await s.send.render(proposal, EMAIL_MIME);
  const io = { account, tokens: s.tokens };
  expect(await s.send.transmit(wire, io)).toEqual({ outcome: "rejected", detail: "dry-run" });
  expect(await s.send.transmit(wire, { ...io, dryRun: true })).toEqual({
    outcome: "rejected",
    detail: "dry-run",
  });
  expect(s.tokens.calls).toEqual([]);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
  await expect(
    s.send.transmit(wire, { ...io, account: { id: "other" }, dryRun: false }),
  ).rejects.toThrow("account differs");
  expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  expect(await s.send.transmit(wire, { ...io, dryRun: false })).toEqual({
    outcome: "accepted",
    providerRef: "d4",
  });
  expect(s.send).not.toHaveProperty("finalAbsence");
  expect(s.requests[0]?.url.pathname).toBe("/gmail/v1/users/me/messages/send");
  expect(s.requests[0]?.method).toBe("POST");
  expect(JSON.parse(s.requests[0]?.body ?? "null")).toEqual({
    raw: Buffer.from(wire.bytes).toString("base64url"),
  });
  expect(s.tokens.calls.map((c) => c.access)).toEqual(["send"]);
  expect(s.verifyApproval).toHaveBeenCalledWith(wire, account);
  expect(s.requests[0]?.headers.get("authorization")).toContain("Bearer");
  for (const verifyApproval of [async () => false, undefined, async () => "yes"]) {
    const refused = sender([], { verifyApproval });
    await expect(
      refused.send.transmit(wire, { ...io, tokens: refused.tokens, dryRun: false }),
    ).rejects.toThrow("approval required");
    expect(refused.requests).toEqual([]);
  }
});

it("refuses tampering and rechecks expiry after credential and owner-approval awaits", async () => {
  let now = at;
  const s = sender([], { now: () => now });
  const wire = await s.send.render(signed(), EMAIL_MIME);
  const io = { account, tokens: s.tokens, dryRun: false };
  const bytes = wire.bytes.replace("To: receiver", "To: stranger");
  for (const changed of [
    { ...wire, bytes, digest: digestBytes(bytes) },
    {
      bytes: "Subject: Plain\r\n\r\nHuman",
      mediaType: "message/rfc822",
      digest: digestBytes("Subject: Plain\r\n\r\nHuman"),
    },
  ])
    await expect(s.send.transmit(changed, io)).rejects.toThrow("wire differs");
  now = at + 24 * 3600000;
  await expect(s.send.transmit(wire, io)).rejects.toThrow("expired");
  now = at;
  const tokens = {
    read: vi.fn(),
    send: async () => {
      now = at + 24 * 3600000;
      return { access: "send" as const, accessToken: "fake-send" };
    },
  };
  await expect(s.send.transmit(wire, { ...io, tokens })).rejects.toThrow("expired");
  now = at;
  const expiredApproval = sender([], {
    now: () => now,
    verifyApproval: async () => {
      now = at + 24 * 3600000;
      return true;
    },
  });
  await expect(expiredApproval.send.transmit(wire, io)).rejects.toThrow("expired");
  expect(s.requests).toEqual([]);
  expect(expiredApproval.requests).toEqual([]);
});

it.each([
  400, 401, 403, 429, 500, 503,
])("distinguishes definitive HTTP 400 rejection from uncertain HTTP %s", async (status) => {
  const s = sender([new Response(null, { status })]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  await expect(s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).rejects.toThrow(
    status === 400 ? "refused" : "uncertain",
  );
});

it("treats malformed acknowledgements and transport failures as uncertain, without retrying", async () => {
  for (const reply of [
    {},
    { id: "../bad" },
    new Response("bad JSON"),
    new Error("network token-sensitive"),
  ]) {
    const s = sender([reply]);
    const wire = await s.send.render(signed(), EMAIL_MIME);
    await expect(
      s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow();
    expect(s.requests).toHaveLength(1);
  }
});

it("reconciles only verified raw provider copies using rfc822msgid and read grants, including after expiry", async () => {
  let now = at;
  const s = sender([], { now: () => now });
  const wire = await s.send.render(signed(), EMAIL_MIME);
  // The transport's closed queue is mutable only in the fixture.
  s.queue.push(
    { messages: [{ id: "a1" }, { id: "b2" }, { id: "c3" }] },
    new Response(null, { status: 404 }),
    native("b2", raw),
    native("c3", `Received: google.test\r\n${wire.bytes}`),
  );
  now = at + 24 * 3600000;
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "c3" });
  expect(s.requests[0]?.url.searchParams.get("q")).toBe(
    `rfc822msgid:${emailMessageIdFor(message.id)} in:anywhere`,
  );
  expect(s.tokens.calls.every((c) => c.access === "read")).toBe(true);
  expect(s.verifyApproval).not.toHaveBeenCalled();
});

it("never reports final absence for empty, incomplete, malformed, failed or unverifiable search", async () => {
  for (const replies of [
    [{}],
    [{ messages: [] }],
    [{ nextPageToken: "next", messages: [] }],
    [{ messages: {} }],
    [{ messages: [null] }],
    [new Response(null, { status: 403 })],
    [{ messages: [{ id: "a1" }] }, { id: "other", raw: "eA" }],
  ]) {
    const s = sender(replies);
    const wire = await s.send.render(signed(), EMAIL_MIME);
    expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    expect(s.send.finalAbsence).toBeUndefined();
  }
  const s = sender([]);
  expect(
    await s.send.lookup?.({ bytes: "invalid", mediaType: "message/rfc822", digest: "bad" }),
  ).toMatchObject({ outcome: "unknown" });
});

it("validates provider scalar fields, canonical raw encoding, JSON shape and status without leaking remote bodies", async () => {
  for (const value of [null, [], "str"]) expect(() => record(value)).toThrow();
  for (const value of ["", "bad/id", "x".repeat(2049), null]) expect(() => opaque(value)).toThrow();
  for (const value of ["", "x", "1".repeat(41), 1]) expect(() => historyId(value)).toThrow();
  for (const value of ["", "../x", "a".repeat(65), 1]) expect(() => messageId(value)).toThrow();
  for (const value of [
    null,
    {},
    { id: "b2", raw: "eA" },
    { id: "a1", raw: 1 },
    { id: "a1", raw: "bad===" },
    { id: "a1", raw: "eB" },
    { id: "a1", raw: "x".repeat(Math.ceil((MAX_EMAIL_BYTES * 4) / 3) + 1) },
    { id: "a1", raw: Buffer.alloc(MAX_EMAIL_BYTES + 1).toString("base64url") },
  ])
    expect(() => rawMessage(value, "a1")).toThrow();
  expect(rawMessage({ id: "a1", raw: "eA" }, "a1").historyId).toBeUndefined();
  expect(rawMessage(native("a1"), "a1").historyId).toBe("110");
  await expect(
    responseBody(new Response("private provider body", { status: 500 })),
  ).rejects.toThrow("HTTP 500");
  await expect(responseBody(new Response("private malformed JSON"))).rejects.toThrow(
    "invalid Gmail JSON",
  );
  await expect(responseBody(Response.json(null))).rejects.toThrow("invalid Gmail JSON");
  // Default construction does not contact a provider; tests only use injected fixtures.
  expect(typeof gmailRest()).toBe("function");
  const original = new Set(ORIGINS);
  (ORIGINS as Set<string>).add("https://evil.test");
  expect(
    createGmailReader({
      tokens: new RecordingTokenProvider(),
      parseEmail,
      recipient,
      ownAccounts: new Set(),
      footer: AGENT_FOOTER,
    }).origins,
  ).toEqual(original);
  (ORIGINS as Set<string>).delete("https://evil.test");
});

it("continues past malformed or unreachable search candidates to verified positive evidence", async () => {
  const s = sender([]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  s.queue.push(
    { messages: [{ id: "a1" }, { id: "b2" }, { id: "c3" }] },
    { id: "other", raw: "bad" },
    new Response(null, { status: 503 }),
    native("c3", wire.bytes),
  );
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "c3" });
});

it("snapshots account policy and rejects missing own-account configuration instead of defaulting to LENIENT", async () => {
  const r = reader([]);
  for (const ownAccounts of [undefined, null])
    expect(() => createGmailReader({ ...r.config, ownAccounts } as never)).toThrow();
  const s = sender([]);
  const recipients = s.config.recipients;
  recipients.set(message.to?.actor as string, "stranger@example.test");
  const wire = await s.send.render(signed(), EMAIL_MIME);
  expect(wire.bytes).toContain(`To: ${recipient}\r\n`);
  r.config.ownAccounts.clear();
  const mismatch = wire.bytes.replace("multipart/alternative", "multipart/mixed");
  expect(() => r.binding.ingest.parse({ id: "a1", raw: mismatch })).toThrow(
    "human-parity-mismatch",
  );
});

it("transmits only the checked snapshot when the outbox object changes during owner approval", async () => {
  const s = sender([fixtures.accepted]);
  const wire = { ...(await s.send.render(signed(), EMAIL_MIME)) };
  const original = wire.bytes;
  s.verifyApproval.mockImplementation(async () => {
    wire.bytes = "unreviewed body";
    wire.digest = digestBytes(wire.bytes);
    return true;
  });
  expect(await s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).toEqual({
    outcome: "accepted",
    providerRef: "d4",
  });
  expect(Buffer.from(JSON.parse(s.requests[0]?.body ?? "null").raw, "base64url").toString()).toBe(
    original,
  );
});
