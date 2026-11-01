// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
import type { guardedFetch } from "@jeswr/guarded-fetch";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import { capabilityToTurtle } from "../src/capability.js";
import type { InboundRawMessage } from "../src/channel.js";
import { parseRecord, rawId } from "../src/mastodon/records.js";
import {
  DEFAULT_INSTANCE,
  handle,
  id,
  instanceOrigin,
  MAX_RECORD_BYTES,
  mastodonRest,
  record,
  responseJson,
} from "../src/mastodon/rest.js";
import { createMastodonSend } from "../src/mastodon/send.js";
import { createMastodonReader, MASTODON_SCOPES, ORIGINS } from "../src/mastodon.js";
import { AGENT_FOOTER, DIRECT, MASTODON_FOOTER } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import type { Wire } from "../src/types.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";

const fixtures = JSON.parse(
  readFileSync(new URL("fixtures/mastodon.json", import.meta.url), "utf8"),
);
const instance = "https://instance.example";
const bounds = { maxItems: 10, maxBytes: 65536 };
function fake(replies: unknown[] = []) {
  const queue = [...replies];
  const requests: { url: URL; method: string | undefined; headers: Headers; body: string }[] = [];
  const transport = vi.fn<typeof guardedFetch>(async (input, init) => {
    requests.push({
      url: new URL(input instanceof Request ? input.url : String(input)),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body ? await new Response(init.body).text() : "",
    });
    if (!queue.length) throw new Error("fixture exhausted");
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json(reply);
  });
  const tokens = new RecordingTokenProvider();
  return {
    queue,
    requests,
    tokens,
    transport,
    options: {
      createTransport: () => transport,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    },
  };
}
function reader(replies: unknown[] = []) {
  const f = fake(replies);
  const binding = createMastodonReader({ instance, tokens: f.tokens, transport: f.options });
  return { ...f, binding };
}
function sender(replies: unknown[] = [], extra: Record<string, unknown> = {}) {
  const f = fake(replies);
  const verifyApproval = vi.fn<(wire: Wire, senderAccount: typeof account) => Promise<boolean>>(
    async () => true,
  );
  const config = {
    instance,
    account,
    recipients: new Map([[message.to?.actor as string, "receiver@remote.example"]]),
    verify: verifyMessage,
    verifyApproval,
    now: () => at,
    transport: f.options,
    ...extra,
  };
  return { ...f, config, verifyApproval, send: createMastodonSend(config) };
}
function page(rows: unknown[], path: string, rel = "next") {
  return Response.json(rows, { headers: { link: `<${instance}${path}>; rel="${rel}"` } });
}
function cursor(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    account: account.id,
    instance,
    source: 0,
    path: "/api/v1/notifications?limit=1",
    ...extra,
  });
}
function incoming(source: "notifications" | "conversations", row: Record<string, unknown>) {
  return { id: rawId(instance, source, row), raw: canonicalJson({ source, row }) };
}
function changedWire(
  wire: Wire,
  change: (plan: {
    request: { status: string; visibility: string };
    instance: string;
    account: string;
    compactJws: string;
    extra?: boolean;
  }) => void,
): Wire {
  const plan = JSON.parse(wire.bytes);
  change(plan);
  const bytes = canonicalJson(plan);
  return { ...wire, bytes, digest: digestBytes(bytes) };
}

it("advertises footer-only federated, unencrypted capability and separate OAuth scopes", async () => {
  const r = reader();
  expect(r.binding.send).toBeUndefined();
  expect(r.binding.origins).toEqual(new Set([instance]));
  expect(MASTODON_SCOPES).toEqual({
    read: ["read:notifications", "read:statuses"],
    send: ["write:statuses"],
  });
  expect(Object.isFrozen(MASTODON_SCOPES.read)).toBe(true);
  const descriptor = r.binding.describe("connected");
  expect(descriptor).toMatchObject({
    federated: true,
    endToEndEncrypted: false,
    structuredPayload: false,
  });
  expect(await capabilityToTurtle(descriptor)).toBe(
    readFileSync(new URL("fixtures/mastodon-capability.ttl", import.meta.url), "utf8").replace(
      /^#.*\n/,
      "",
    ),
  );
  expect(r.tokens.calls).toEqual([]);
  expect(r.requests).toEqual([]);
});

it("ingests notifications and conversations using read grants, stable IDs, provenance and plain text", async () => {
  const r = reader([[fixtures.notification], [fixtures.conversation]]);
  const result = await r.binding.ingest.list(account, undefined, bounds);
  expect(result.items).toHaveLength(2);
  const notice = r.binding.ingest.parse(result.items[0] as InboundRawMessage);
  expect(notice).toMatchObject({
    channel: "mastodon",
    sender: { handle: "alice@remote.example", displayName: "Alice" },
    textBody: "Mastodon notification: mention\nHello & welcome\nNext line",
    threadId: `${instance}:status:399`,
    date: "2026-10-26T11:30:00.000Z",
    rawMediaType: "application/json",
  });
  expect(notice.rawSha256).toBe(digestBytes((result.items[0] as InboundRawMessage).raw).slice(8));
  expect(notice.rawByteLength).toBe(Buffer.byteLength((result.items[0] as InboundRawMessage).raw));
  expect(notice).not.toHaveProperty("jsonLdBlocks");
  const conversation = r.binding.ingest.parse(result.items[1] as InboundRawMessage);
  expect(conversation).toMatchObject({
    textBody: "Context\nPrivate conversation",
    threadId: `${instance}:conversation:42`,
    messageId: `${instance}:conversations:42:401`,
  });
  expect(r.binding.ingest.threadKey?.(conversation)).toBe(conversation.threadId);
  expect(r.binding.ingest.threadKey?.({ ...conversation, threadId: undefined })).toBeUndefined();
  expect(r.requests.map((q) => q.url.pathname)).toEqual([
    "/api/v1/notifications",
    "/api/v1/conversations",
  ]);
  expect(
    r.requests.every(
      (q) =>
        q.url.origin === instance && q.method === "GET" && q.url.searchParams.get("limit") === "1",
    ),
  ).toBe(true);
  expect(r.tokens.calls.map((c) => c.access)).toEqual(["read", "read"]);
  expect(JSON.parse(result.next).source).toBe(0);
  r.queue.push([fixtures.notification], [fixtures.conversation]);
  expect((await r.binding.ingest.list(account, result.next, bounds)).items).toEqual(result.items);
  expect(
    r.binding.ingest.parse({
      ...(result.items[0] as InboundRawMessage),
      native: { poisoned: true },
    }),
  ).toEqual(notice);
});

it("resumes both provider endpoints under item and aggregate byte bounds without dropping a record", async () => {
  const next = "/api/v1/notifications?max_id=499&limit=1";
  const row = { ...fixtures.notification, id: "498" };
  const r = reader([page([fixtures.notification], next), [row], [fixtures.conversation]]);
  const first = await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 });
  expect(JSON.parse(first.next).path).toBe(next);
  const second = await r.binding.ingest.list(account, first.next, { ...bounds, maxItems: 1 });
  expect(second.items[0]?.id).toBe(`${instance}:notifications:498`);
  expect(JSON.parse(second.next).source).toBe(1);
  const third = await r.binding.ingest.list(account, second.next, bounds);
  expect(third.items).toHaveLength(1);
  expect(r.requests[1]?.url.searchParams.get("max_id")).toBe("499");
  const size = Buffer.byteLength(incoming("notifications", fixtures.notification).raw);
  const b = reader([page([fixtures.notification], next), [row], [row], []]);
  const bounded = await b.binding.ingest.list(account, undefined, { ...bounds, maxBytes: size });
  expect(bounded.items).toHaveLength(1);
  expect(JSON.parse(bounded.next).path).toBe(next);
  expect((await b.binding.ingest.list(account, bounded.next, bounds)).items[0]?.id).toContain(
    "498",
  );
  const tooSmall = reader([[fixtures.notification]]);
  await expect(
    tooSmall.binding.ingest.list(account, undefined, { ...bounds, maxBytes: size - 1 }),
  ).rejects.toThrow("byte bound");
});

it("follows conversation Link cursors rather than deriving them from conversation IDs", async () => {
  const path = "/api/v1/conversations?max_id=989898&limit=1";
  const r = reader([[], page([fixtures.conversation], path), []]);
  const first = await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 });
  expect(JSON.parse(first.next).path).toBe(path);
  await r.binding.ingest.list(account, first.next, bounds);
  expect(r.requests[2]?.url.searchParams.get("max_id")).toBe("989898");
});

it("bounds empty provider pagination and ignores prev links", async () => {
  const r = reader(
    Array.from({ length: 80 }, (_, i) =>
      page([], `/api/v1/notifications?max_id=${1000 - i}&limit=1`),
    ),
  );
  expect((await r.binding.ingest.list(account, undefined, bounds)).items).toEqual([]);
  expect(r.requests).toHaveLength(80);
  const empty = reader([page([], "/api/v1/notifications?min_id=1000", "prev"), []]);
  expect((await empty.binding.ingest.list(account, undefined, bounds)).items).toEqual([]);
});

it("refuses hostile pagination destinations and loops before sending any next-page credentials", async () => {
  for (const link of [
    "https://evil.example/api/v1/notifications?max_id=1",
    "https://secret@instance.example/api/v1/notifications?max_id=1",
    `${instance}/api/v1/statuses?max_id=1`,
    `${instance}/api/v1/notifications?max_id=1#fragment`,
    `${instance}/api/v1/notifications?access_token=secret`,
    `${instance}/api/v1/notifications?max_id=1&max_id=2`,
    `${instance}/api/v1/notifications?max_id=bad`,
    "https://[",
    `${instance}/api/v1/notifications?limit=1`,
  ]) {
    const r = reader([Response.json([], { headers: { link: `<${link}>; rel="next"` } })]);
    await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow();
    expect(r.requests).toHaveLength(1);
    expect(r.tokens.calls).toHaveLength(1);
  }
});

it("refuses invalid bounds, accounts and cursors without credentials", async () => {
  const r = reader();
  for (const value of [0, -1, 1.5, Infinity]) {
    await expect(
      r.binding.ingest.list(account, undefined, { ...bounds, maxItems: value }),
    ).rejects.toThrow();
    await expect(
      r.binding.ingest.list(account, undefined, { ...bounds, maxBytes: value }),
    ).rejects.toThrow();
  }
  await expect(r.binding.ingest.list({ id: "" }, undefined, bounds)).rejects.toThrow();
  for (const value of [
    "bad",
    "null",
    "[]",
    cursor({ account: "other" }),
    cursor({ instance: "https://other.example" }),
    cursor({ source: 2 }),
    cursor({ path: 3 }),
    cursor({ extra: true }),
    cursor({ path: "https://evil.example/api/v1/notifications" }),
  ])
    await expect(r.binding.ingest.list(account, value, bounds)).rejects.toThrow();
  expect(r.tokens.calls).toEqual([]);
});

it("fails closed for malformed pages, read failures and redirects without leaking remote details", async () => {
  for (const reply of [
    null,
    {},
    [fixtures.notification, fixtures.notification],
    [null],
    new Response("private token", { status: 403 }),
    new Response("private token"),
    new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    new Error("secret transport details"),
  ]) {
    const r = reader([reply]);
    await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow();
    expect(r.requests).toHaveLength(1);
  }
  const tokens = {
    read: vi.fn(async () => ({ access: "send", accessToken: "fake" })),
    send: vi.fn(),
  };
  const r = reader();
  const bad = createMastodonReader({ instance, tokens: tokens as never, transport: r.options });
  await expect(bad.ingest.list(account, undefined, bounds)).rejects.toThrow("wrong-scope");
  expect(tokens.send).not.toHaveBeenCalled();
  expect(r.requests).toEqual([]);
});

it("treats follow notifications as observations and strips scripts, markup and controls", () => {
  const notice = { ...fixtures.notification, type: "follow", status: null };
  delete notice.account.display_name;
  const follow = parseRecord(instance, incoming("notifications", notice));
  expect(follow.textBody).toBe("Mastodon notification: follow");
  expect(follow).not.toHaveProperty("threadId");
  expect(follow.sender).toEqual({ handle: "alice@remote.example" });
  const row = structuredClone(fixtures.notification);
  row.status.content =
    "<p>A\u0000\u202e<script>secret</script><style>hidden</style><!--comment--><b>B</b>&lt;literal&gt;&quot;&apos;&nbsp;</p>";
  delete row.status.spoiler_text;
  row.status.in_reply_to_id = null;
  const item = incoming("notifications", row);
  const parsed = parseRecord(instance, { ...item, raw: new Uint8Array(Buffer.from(item.raw)) });
  expect(parsed.textBody).toBe("Mastodon notification: mention\nAB<literal>\"'");
  expect(parsed.threadId).toBe(`${instance}:status:400`);
});

it("rejects malformed inbound records, UTF-8, IDs, dates and non-direct conversations", () => {
  const item = incoming("notifications", fixtures.notification);
  for (const raw of [
    "null",
    "[]",
    "{}",
    '{"source":"unknown","row":{}}',
    "x".repeat(MAX_RECORD_BYTES + 1),
    new Uint8Array([255]),
  ])
    expect(() => parseRecord(instance, { ...item, raw })).toThrow("invalid Mastodon inbound");
  expect(() => parseRecord(instance, { ...item, id: "other" })).toThrow();
  const variants = [
    { ...fixtures.notification, type: "Bad!" },
    { ...fixtures.notification, type: null },
    { ...fixtures.notification, account: null },
    { ...fixtures.notification, created_at: "bad" },
    { ...fixtures.notification, created_at: 1 },
    { ...fixtures.notification, status: { ...fixtures.notification.status, visibility: 1 } },
    { ...fixtures.notification, status: { ...fixtures.notification.status, content: 1 } },
    { ...fixtures.notification, status: { ...fixtures.notification.status, id: "bad" } },
  ];
  for (const row of variants)
    expect(() =>
      parseRecord(instance, { ...item, raw: canonicalJson({ source: "notifications", row }) }),
    ).toThrow();
  for (const visibility of ["public", "private", "unlisted", undefined]) {
    const row = {
      ...fixtures.conversation,
      last_status: { ...fixtures.conversation.last_status, visibility: visibility ?? null },
    };
    expect(() => parseRecord(instance, incoming("conversations", row))).toThrow();
  }
  expect(() =>
    rawId(instance, "conversations", { ...fixtures.conversation, last_status: null }),
  ).toThrow();
});

it("validates the configured instance and provider scalars and snapshots allowed origins", async () => {
  for (const value of [
    "bad",
    "http://instance.example",
    "https://user:secret@instance.example",
    `${instance}/path`,
    `${instance}?query=1`,
    `${instance}#fragment`,
  ])
    expect(() => instanceOrigin(value)).toThrow();
  expect(instanceOrigin(`${instance}/`)).toBe(instance);
  for (const value of [null, [], "x"]) expect(() => record(value)).toThrow();
  for (const value of ["", "bad", 1, "1".repeat(41)]) expect(() => id(value)).toThrow();
  for (const value of ["", "@extra", "one two", 1, "a".repeat(257)])
    expect(() => handle(value)).toThrow();
  for (const value of ["local_user", "a@remote.example:8443"]) expect(handle(value)).toBe(value);
  await expect(responseJson(new Response("secret", { status: 500 }))).rejects.toThrow("HTTP 500");
  await expect(responseJson(new Response("secret"))).rejects.toThrow("invalid Mastodon JSON");
  expect(typeof mastodonRest(instance)).toBe("function");
  (ORIGINS as Set<string>).add("https://evil.example");
  const binding = createMastodonReader({ tokens: new RecordingTokenProvider() });
  expect(binding.origins).toEqual(new Set([DEFAULT_INSTANCE]));
  (ORIGINS as Set<string>).delete("https://evil.example");
  const r = reader([[], []]);
  (r.binding.origins as Set<string>).add("https://evil.example");
  await r.binding.ingest.list(account, undefined, bounds);
  expect(r.requests.every((q) => q.url.origin === instance)).toBe(true);
});

it("renders an exact direct-only request with footer and keeps signed evidence local", async () => {
  const s = sender([fixtures.accepted]);
  const proposal = signed();
  const wire = await s.send.render(proposal, MASTODON_FOOTER);
  const plan = JSON.parse(wire.bytes);
  expect(plan.request).toEqual({
    status: `@receiver@remote.example\nAgent describe: {}\n${AGENT_FOOTER}`,
    visibility: "direct",
  });
  expect(Buffer.byteLength(plan.request.status)).toBeLessThanOrEqual(256);
  expect(wire.digest).toBe(digestBytes(wire.bytes));
  expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  expect(await s.send.transmit(wire, { account, tokens: s.tokens })).toEqual({
    outcome: "rejected",
    detail: "dry-run",
  });
  expect(s.tokens.calls).toEqual([]);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
  expect(await s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).toEqual({
    outcome: "accepted",
    providerRef: "600",
  });
  expect(s.requests).toHaveLength(1);
  const request = s.requests[0] as (typeof s.requests)[number];
  expect(request.url.href).toBe(`${instance}/api/v1/statuses`);
  expect(request.method).toBe("POST");
  expect(request.body).toBe(canonicalJson(plan.request));
  expect(request.body).not.toContain(proposal.compactJws);
  expect(request.headers.get("idempotency-key")).toBe(wire.digest);
  expect(request.headers.get("content-type")).toBe("application/json");
  expect(s.verifyApproval).toHaveBeenCalledWith(wire, account);
  expect(s.tokens.calls.map((c) => c.access)).toEqual(["send"]);
  expect(s.send.lookup).toBeUndefined();
  expect(s.send.finalAbsence).toBeUndefined();
});

it("refuses altered wires, unpinned recipients, invalid signatures and incompatible carriage", async () => {
  const s = sender();
  const proposal = signed();
  const wire = await s.send.render(proposal, MASTODON_FOOTER);
  const invalid = [
    { ...wire, digest: "bad" },
    { ...wire, mediaType: "application/json" },
    { ...wire, extra: true },
    { ...wire, bytes: 1 },
    { ...wire, bytes: "x".repeat(96 * 1024 + 1) },
    changedWire(wire, (p) => {
      p.request.visibility = "public";
    }),
    changedWire(wire, (p) => {
      p.request.status += " @stranger";
    }),
    changedWire(wire, (p) => {
      p.instance = "https://other.example";
    }),
    changedWire(wire, (p) => {
      p.account = "other";
    }),
    changedWire(wire, (p) => {
      p.extra = true;
    }),
    changedWire(wire, (p) => {
      p.compactJws = "bad";
    }),
  ];
  for (const changed of invalid) {
    expect((await s.send.validate(changed as Wire, proposal)).ok).toBe(false);
    await expect(
      s.send.transmit(changed as Wire, { account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow();
  }
  await expect(
    s.send.transmit(wire, { account: { id: "other" }, tokens: s.tokens, dryRun: false }),
  ).rejects.toThrow("account differs");
  await expect(s.send.render(proposal, DIRECT)).rejects.toThrow("carriage");
  await expect(
    s.send.render({ ...proposal, message: { ...message, id: "urn:changed" } }, MASTODON_FOOTER),
  ).rejects.toThrow("differs");
  await expect(
    s.send.render(signed({ ...message, to: { actor: "https://other.example" } }), MASTODON_FOOTER),
  ).rejects.toThrow("pinned");
  await expect(
    s.send.render(
      signed(Object.fromEntries(Object.entries(message).filter(([key]) => key !== "to"))),
      MASTODON_FOOTER,
    ),
  ).rejects.toThrow("pinned");
  for (const verify of [
    async () => ({}),
    async () => ({ ...message, id: "urn:other" }),
    async () => {
      throw new Error("invalid signature");
    },
  ])
    await expect(sender([], { verify }).send.render(proposal, MASTODON_FOOTER)).rejects.toThrow();
  for (const compactJws of [
    "bad",
    "a.b.c",
    "a._w.c",
    `a.${Buffer.from("{}").toString("base64url")}.c`,
    "x".repeat(65537),
  ])
    await expect(s.send.render({ ...proposal, compactJws }, MASTODON_FOOTER)).rejects.toThrow(
      "signed proposal",
    );
  expect(() =>
    sender([], { recipients: new Map([[message.to?.actor, "unsafe @stranger"]]) }),
  ).toThrow();
  expect(s.tokens.calls).toEqual([]);
  expect(s.requests).toEqual([]);
});

it("neutralizes body mentions, snapshots recipient pins and refuses over-limit statuses", async () => {
  const s = sender();
  s.config.recipients.clear();
  const m = {
    ...message,
    kind: "describe",
    body: { want: ["@extra"] },
  };
  const proposal = signed(m);
  const wire = await s.send.render(proposal, MASTODON_FOOTER);
  expect(JSON.parse(wire.bytes).request.status).toContain("＠extra");
  expect(JSON.parse(wire.bytes).request.status).not.toContain(" @extra");
  await expect(
    s.send.render(
      signed({ ...m, body: { want: ["x".repeat(128), "y".repeat(128)] } }),
      MASTODON_FOOTER,
    ),
  ).rejects.toThrow("byte cap");
});

it("requires strict owner approval and the send grant, rechecking expiry after every await", async () => {
  for (const verifyApproval of [undefined, async () => false, async () => "true"]) {
    const s = sender([], { verifyApproval });
    const wire = await s.send.render(signed(), MASTODON_FOOTER);
    await expect(
      s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow("approval required");
    expect(s.requests).toEqual([]);
  }
  let now = at;
  const s = sender([], { now: () => now });
  const wire = await s.send.render(signed(), MASTODON_FOOTER);
  for (const value of [NaN, at - 86400000, at + 86400000]) {
    now = value;
    expect((await s.send.validate(wire, signed())).ok).toBe(false);
    await expect(
      s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow("expired");
  }
  now = at;
  const tokens = {
    read: vi.fn(),
    send: vi.fn(async () => {
      now = at + 86400000;
      return { access: "send" as const, accessToken: "fake-send" };
    }),
  };
  await expect(s.send.transmit(wire, { account, tokens, dryRun: false })).rejects.toThrow(
    "expired",
  );
  now = at;
  const late = sender([], {
    now: () => now,
    verifyApproval: async () => {
      now = at + 86400000;
      return true;
    },
  });
  await expect(
    late.send.transmit(wire, { account, tokens: late.tokens, dryRun: false }),
  ).rejects.toThrow("expired");
  now = at;
  const bad = { read: vi.fn(), send: vi.fn(async () => ({ access: "read", accessToken: "fake" })) };
  await expect(
    s.send.transmit(wire, { account, tokens: bad as never, dryRun: false }),
  ).rejects.toThrow("wrong-scope");
  expect(tokens.read).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
  expect(late.requests).toEqual([]);
});

it.each([
  400, 401, 403, 404, 422, 429, 500, 503,
])("classifies HTTP %s without retrying", async (status) => {
  const s = sender([new Response("private provider details", { status })]);
  const wire = await s.send.render(signed(), MASTODON_FOOTER);
  await expect(s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).rejects.toThrow(
    status < 429 ? "refused" : "uncertain",
  );
  expect(s.requests).toHaveLength(1);
});

it("treats malformed or non-direct acknowledgements and network failures as uncertain", async () => {
  for (const reply of [
    {},
    { id: "bad", visibility: "direct" },
    { id: "1", visibility: "public" },
    new Response("secret"),
    new Error("secret"),
  ]) {
    const s = sender([reply]);
    const wire = await s.send.render(signed(), MASTODON_FOOTER);
    await expect(
      s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow(/uncertain/);
    expect(s.requests).toHaveLength(1);
  }
});

it("sends only the checked snapshot when the outbox changes during owner approval", async () => {
  const s = sender([fixtures.accepted]);
  const wire = { ...(await s.send.render(signed(), MASTODON_FOOTER)) };
  const request = JSON.parse(wire.bytes).request;
  s.verifyApproval.mockImplementation(async (approved: Wire) => {
    expect(Object.isFrozen(approved)).toBe(true);
    wire.bytes = "tampered";
    wire.digest = digestBytes(wire.bytes);
    return true;
  });
  await s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false });
  expect(JSON.parse(s.requests[0]?.body ?? "null")).toEqual(request);
  expect(createMastodonSend({ ...s.config, instance: undefined, now: undefined })).toHaveProperty(
    "render",
  );
});

it("skips conversations whose last status was deleted and caps retained raw records", async () => {
  const r = reader([[], [{ ...fixtures.conversation, last_status: null }]]);
  expect((await r.binding.ingest.list(account, undefined, bounds)).items).toEqual([]);
  const row = {
    ...fixtures.notification,
    padding: Array.from({ length: 6 }, () => "x".repeat(10000)),
  };
  const base = Buffer.byteLength(JSON.stringify(row));
  row.padding.push("x".repeat(MAX_RECORD_BYTES - 20 - base - 3));
  expect(Buffer.byteLength(JSON.stringify([row]))).toBeLessThan(MAX_RECORD_BYTES);
  const large = reader([[row]]);
  await expect(
    large.binding.ingest.list(account, undefined, { ...bounds, maxBytes: 100000 }),
  ).rejects.toThrow("record exceeds cap");
  expect(() => instanceOrigin(`https://${"a".repeat(2050)}.example`)).toThrow();
});

it("qualifies local sender handles with their configured instance", () => {
  const row = { ...fixtures.notification, account: { acct: "alice" } };
  expect(parseRecord(instance, incoming("notifications", row)).sender?.handle).toBe(
    "alice@instance.example",
  );
});

it("accepts the exact status byte ceiling and counts Unicode by UTF-8 bytes", async () => {
  const s = sender([fixtures.accepted]);
  const empty = await s.send.render(signed({ ...message, body: { want: [""] } }), MASTODON_FOOTER);
  const available = 256 - Buffer.byteLength(JSON.parse(empty.bytes).request.status);
  const proposal = signed({ ...message, body: { want: ["x".repeat(available)] } });
  const wire = await s.send.render(proposal, MASTODON_FOOTER);
  expect(Buffer.byteLength(JSON.parse(wire.bytes).request.status)).toBe(256);
  expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  expect(await s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).toEqual({
    outcome: "accepted",
    providerRef: "600",
  });
  const unicode = signed({
    ...message,
    body: { want: ["😀".repeat(Math.ceil((available + 1) / 4))] },
  });
  await expect(s.send.render(unicode, MASTODON_FOOTER)).rejects.toThrow("byte cap");
});
