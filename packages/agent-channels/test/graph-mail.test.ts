// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { MAX_EMAIL_BYTES } from "../src/email-mime.js";
import {
  DELTA_INITIAL,
  deltaLink,
  graphMailRest,
  messageId,
  mimeBody,
  record,
  responseBody,
} from "../src/graph-mail/rest.js";
import { createGraphMailReader, ORIGINS } from "../src/graph-mail.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import { fixtureTransport, mime, raw, recipient } from "./fixtures/graph.js";
import { account } from "./fixtures/signed.js";

const fixtures = JSON.parse(
  readFileSync(new URL("fixtures/graph-mail.json", import.meta.url), "utf8"),
);
const bounds = { maxItems: 100, maxBytes: 1024 * 1024 };
const inboxId = "AQMk+inbox/==";
const link = (token = "delta1", kind = "$deltatoken") =>
  `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?${kind}=${token}`;
const cursor = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ account: account.id, url: link(), pending: [], resume: "", ...extra });
function reader(replies: unknown[]) {
  const fake = fixtureTransport([{ id: inboxId }, ...replies]);
  const tokens = new RecordingTokenProvider();
  const config = {
    tokens,
    parseEmail,
    recipient,
    ownAccounts: new Set([recipient]),
    transport: fake.options,
  };
  return { ...fake, tokens, config, binding: createGraphMailReader(config) };
}

it("ingests inbox delta pages and MIME with read grants, stable IDs and the existing parser", async () => {
  const r = reader([fixtures.first, mime(), fixtures.last, mime(), fixtures.empty]);
  expect(r.binding.id).toBe("graph-mail");
  expect(r.binding.carriage).toBe(EMAIL_MIME);
  expect(r.binding.describe("connected")).toMatchObject({
    binding: "graph-mail",
    credentialState: "connected",
    sendSupported: true,
    rateLimit: { perRecipient: 0, perDay: 0 },
  });
  expect(r.binding.origins).toEqual(
    new Set(["https://graph.microsoft.com", "https://login.microsoftonline.com"]),
  );
  const first = await r.binding.ingest.list(account, undefined, bounds);
  expect(first.items.map((i) => i.id)).toEqual(["AAMk+one/=="]);
  expect(Buffer.from(first.items[0]?.raw as Uint8Array).toString()).toBe(raw);
  const parsed = r.binding.ingest.parse(first.items[0] as (typeof first.items)[number]);
  expect(parsed.warnings).toContain("signature-unverified");
  expect(r.binding.ingest.threadKey?.(parsed)).toBe(parsed.threadId);
  expect(JSON.parse(first.next)).toMatchObject({
    url: fixtures.first["@odata.nextLink"],
    pending: [],
    resume: "",
  });
  const last = await r.binding.ingest.list(account, first.next, bounds);
  expect(last.items.map((i) => i.id)).toEqual(["AAMk-two=="]);
  expect(JSON.parse(last.next).url).toBe(fixtures.last["@odata.deltaLink"]);
  expect(await r.binding.ingest.list(account, last.next, bounds)).toMatchObject({ items: [] });
  expect(r.requests[0]?.url.href).toBe(
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id",
  );
  expect(r.requests[1]?.url.href).toBe(DELTA_INITIAL);
  expect(r.requests[2]?.url.pathname).toBe("/v1.0/me/messages/AAMk%2Bone%2F%3D%3D/$value");
  expect(r.tokens.calls.every((c) => c.access === "read")).toBe(true);
  expect(r.requests.every((r) => r.headers.get("prefer")?.includes('IdType="ImmutableId"'))).toBe(
    true,
  );
  expect(r.queue).toEqual([]);
});

it("keeps pending IDs and continuation links until item and aggregate-byte bounds are drained", async () => {
  const page = {
    value: [{ id: "a" }, { id: "b" }, { id: "c" }],
    "@odata.nextLink": link("page2", "$skiptoken"),
  };
  const r = reader([page, mime(), mime(), mime(), mime(), fixtures.empty]);
  const first = await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 });
  expect(JSON.parse(first.next)).toMatchObject({
    url: DELTA_INITIAL,
    pending: ["b", "c"],
    resume: link("page2", "$skiptoken"),
  });
  const second = await r.binding.ingest.list(account, first.next, {
    ...bounds,
    maxBytes: Buffer.byteLength(raw),
  });
  expect(second.items.map((i) => i.id)).toEqual(["b"]);
  const third = await r.binding.ingest.list(account, second.next, bounds);
  expect(third.items.map((i) => i.id)).toEqual(["c"]);
  expect(JSON.parse(third.next).url).toBe(link("page2", "$skiptoken"));
  expect((await r.binding.ingest.list(account, third.next, bounds)).items).toEqual([]);
  await expect(
    reader([page, mime()]).binding.ingest.list(account, undefined, { ...bounds, maxBytes: 1 }),
  ).rejects.toThrow("byte bound");
});

it.each([
  0,
  MAX_EMAIL_BYTES + 1,
])("skips refused MIME of %i bytes without consuming item bounds or retaining its pending ID", async (size) => {
  const next = link("page2", "$skiptoken");
  const r = reader([
    { value: [{ id: "refused" }, { id: "a" }, { id: "b" }], "@odata.nextLink": next },
    mime("x".repeat(size)),
    mime(),
    mime(),
    fixtures.empty,
  ]);
  const first = await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 });
  expect(first.items.map((item) => item.id)).toEqual(["a"]);
  expect(JSON.parse(first.next)).toEqual({
    account: account.id,
    url: DELTA_INITIAL,
    pending: ["b"],
    resume: next,
  });
  const second = await r.binding.ingest.list(account, first.next, bounds);
  expect(second.items.map((item) => item.id)).toEqual(["b"]);
  expect(JSON.parse(second.next)).toMatchObject({ url: next, pending: [], resume: "" });
  await r.binding.ingest.list(account, second.next, bounds);
  expect(r.requests.at(-1)?.url.href).toBe(next);
  expect(
    r.requests.filter((request) => request.url.pathname.endsWith("/refused/$value")),
  ).toHaveLength(1);
  expect(r.queue).toEqual([]);
});

it("advances past a delta page containing only refused MIME", async () => {
  const next = link("after-refused");
  const r = reader([
    { value: [{ id: "refused" }], "@odata.deltaLink": next },
    mime("x".repeat(MAX_EMAIL_BYTES + 1)),
    { value: [{ id: "valid" }], "@odata.deltaLink": link("after-valid") },
    mime(),
  ]);
  const first = await r.binding.ingest.list(account, undefined, bounds);
  expect(first.items).toEqual([]);
  expect(JSON.parse(first.next)).toMatchObject({ url: next, pending: [], resume: "" });
  const second = await r.binding.ingest.list(account, first.next, bounds);
  expect(second.items.map((item) => item.id)).toEqual(["valid"]);
  expect(r.requests[3]?.url.href).toBe(next);
  expect(r.queue).toEqual([]);
});

it.each([
  "HTTP 429",
  "HTTP 503",
  "transport",
  "body stream",
])("preserves pending IDs for retry after a transient MIME %s failure", async (failure) => {
  const stream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("body stream failed"));
      },
    }),
  );
  const failed =
    failure === "transport"
      ? new Error("transport failed")
      : failure === "body stream"
        ? stream
        : new Response(null, { status: Number(failure.slice(5)) });
  const saved = cursor({ pending: ["a", "b"], resume: link("resumed") });
  const r = reader([failed, mime(), mime()]);
  await expect(r.binding.ingest.list(account, saved, bounds)).rejects.toThrow(
    failure === "transport" ? "transport failed or refused redirect" : failure,
  );
  expect(r.requests).toHaveLength(2);
  const retry = await r.binding.ingest.list(account, saved, bounds);
  expect(retry.items.map((item) => item.id)).toEqual(["a", "b"]);
  expect(JSON.parse(retry.next)).toMatchObject({
    url: link("resumed"),
    pending: [],
    resume: "",
  });
  expect(r.requests[1]?.url.href).toBe(r.requests[2]?.url.href);
  expect(r.queue).toEqual([]);
});

it.each([
  "mailfolders/inbox",
  "mailFolders/INBOX",
  "mailfolders('inbox')",
  "mailfolders('AQMk+inbox/==')",
  "mailFolders('AQMk%2Binbox%2F%3D%3D')",
  "mailfolders/AQMk%2Binbox%2F%3D%3D",
])("follows equivalent inbox continuation paths (%s), including across reader restarts", async (path) => {
  const next = link("page2", "$skiptoken").replace("mailFolders/inbox", path);
  const delta = link().replace("mailFolders/inbox", path);
  const r = reader([{ value: [{ id: "a" }, { id: "b" }], "@odata.nextLink": next }, mime()]);
  const first = await r.binding.ingest.list(account, undefined, { ...bounds, maxItems: 1 });
  expect(JSON.parse(first.next)).toMatchObject({ pending: ["b"], resume: next });
  const restarted = reader([mime(), { value: [], "@odata.deltaLink": delta }]);
  const second = await restarted.binding.ingest.list(account, first.next, bounds);
  expect(second.items.map((item) => item.id)).toEqual(["b"]);
  expect(JSON.parse(second.next).url).toBe(next);
  const last = await restarted.binding.ingest.list(account, second.next, bounds);
  expect(JSON.parse(last.next).url).toBe(delta);
  expect(restarted.requests[2]?.url.href).toBe(next);
  expect(restarted.queue).toEqual([]);
});

it("pins returned and saved continuation folders independently, including pending resumes", async () => {
  for (const path of ["mailfolders/sentitems", "mailfolders('AQMk-other==')"]) {
    const wrong = link().replace("mailFolders/inbox", path);
    const page = reader([{ value: [{ id: "a" }], "@odata.deltaLink": wrong }]);
    await expect(page.binding.ingest.list(account, undefined, bounds)).rejects.toThrow(
      "inbox delta link",
    );
    expect(page.requests).toHaveLength(2);
    for (const state of [cursor({ url: wrong }), cursor({ pending: ["a"], resume: wrong })]) {
      const saved = reader([]);
      await expect(saved.binding.ingest.list(account, state, bounds)).rejects.toThrow(
        "inbox delta link",
      );
      expect(saved.requests).toHaveLength(1);
    }
  }
});

it("resolves each account's inbox separately and retries failed resolution without trusting a cursor", async () => {
  const r = reader([
    fixtures.empty,
    { id: "otherInbox" },
    { value: [], "@odata.deltaLink": link() },
  ]);
  await r.binding.ingest.list(account, undefined, bounds);
  const other = { id: "other-account" };
  const saved = cursor({ account: other.id, url: fixtures.last["@odata.deltaLink"] });
  await expect(r.binding.ingest.list(other, saved, bounds)).rejects.toThrow("inbox delta link");
  expect(r.requests).toHaveLength(3);
  await r.binding.ingest.list(other, undefined, bounds);
  expect(r.requests).toHaveLength(4);
  expect(r.tokens.calls.map((call) => call.account.id)).toEqual([
    account.id,
    account.id,
    other.id,
    other.id,
  ]);
  for (const response of [{}, { id: "../other" }, new Response(null, { status: 503 })]) {
    const retry = reader([{ id: inboxId }, fixtures.empty]);
    retry.queue[0] = response;
    await expect(retry.binding.ingest.list(account, undefined, bounds)).rejects.toThrow();
    expect(retry.requests).toHaveLength(1);
    expect((await retry.binding.ingest.list(account, undefined, bounds)).items).toEqual([]);
    expect(retry.queue).toEqual([]);
  }
});

it("resets only expired delta state, skips deleted MIME and leaves failed cursors retryable", async () => {
  const r = reader([
    new Response(null, { status: 410 }),
    fixtures.last,
    new Response(null, { status: 404 }),
  ]);
  expect((await r.binding.ingest.list(account, cursor(), bounds)).items).toEqual([]);
  expect(r.requests[2]?.url.href).toBe(DELTA_INITIAL);
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const failed = reader([new Response(null, { status })]);
    await expect(failed.binding.ingest.list(account, cursor(), bounds)).rejects.toThrow(
      `HTTP ${status}`,
    );
    expect(failed.requests).toHaveLength(2);
  }
  await expect(
    reader([new Response(null, { status: 410 })]).binding.ingest.list(account, undefined, bounds),
  ).rejects.toThrow("HTTP 410");
  const retry = reader([fixtures.last, new Response(null, { status: 503 }), fixtures.last, mime()]);
  const saved = cursor();
  await expect(retry.binding.ingest.list(account, saved, bounds)).rejects.toThrow("HTTP 503");
  expect((await retry.binding.ingest.list(account, saved, bounds)).items).toHaveLength(1);
});

it.each([
  400, 404, 409,
])("restarts saved delta and page states on HTTP %s syncStateNotFound", async (status) => {
  for (const code of ["syncStateNotFound", "SyncStateNotFound"]) {
    for (const kind of ["$deltatoken", "$skiptoken"]) {
      const saved = cursor({ url: link("expired", kind) });
      const r = reader([
        Response.json({ error: { code, message: "private provider detail" } }, { status }),
        { value: [{ id: "a" }, { id: "b" }], "@odata.deltaLink": link("fresh") },
        mime(),
        mime(),
        fixtures.empty,
      ]);
      const first = await r.binding.ingest.list(account, saved, { ...bounds, maxItems: 1 });
      expect(first.items.map((item) => item.id)).toEqual(["a"]);
      expect(r.requests[1]?.url.href).toBe(JSON.parse(saved).url);
      expect(r.requests[2]?.url.href).toBe(DELTA_INITIAL);
      expect(JSON.parse(first.next)).toMatchObject({
        url: DELTA_INITIAL,
        pending: ["b"],
        resume: link("fresh"),
      });
      const second = await r.binding.ingest.list(account, first.next, bounds);
      expect(second.items.map((item) => item.id)).toEqual(["b"]);
      expect(JSON.parse(second.next).url).toBe(link("fresh"));
      await r.binding.ingest.list(account, second.next, bounds);
      expect(r.requests.at(-1)?.url.href).toBe(link("fresh"));
      expect(r.tokens.calls.every((call) => call.access === "read")).toBe(true);
      expect(r.queue).toEqual([]);
    }
  }
});

it("preserves cursors for unrelated, malformed and oversized errors without exposing their bodies", async () => {
  const code = "syncStateNotFound";
  for (const [status, body] of [
    [400, { error: { code: "BadRequest", message: code } }],
    [401, { error: { code: "InvalidAuthenticationToken" } }],
    [403, { error: { code: "ErrorAccessDenied" } }],
    [404, { error: { code: "ErrorItemNotFound" } }],
    [429, { error: { code: "TooManyRequests" } }],
    [500, { error: { code } }],
    [400, null],
    [400, {}],
    [400, { error: null }],
    [400, { error: { code: 42 } }],
    [400, { error: { code, message: "x".repeat(65537) } }],
  ] as const) {
    const saved = cursor();
    const r = reader([Response.json(body, { status }), fixtures.empty]);
    await expect(r.binding.ingest.list(account, saved, bounds)).rejects.toThrow(
      `Graph read failed: HTTP ${status}`,
    );
    expect(r.requests).toHaveLength(2);
    await r.binding.ingest.list(account, saved, bounds);
    expect(r.requests[2]?.url.href).toBe(JSON.parse(saved).url);
    expect(r.queue).toEqual([]);
  }
  const malformed = reader([new Response("private malformed JSON", { status: 400 })]);
  await expect(malformed.binding.ingest.list(account, cursor(), bounds)).rejects.toThrow(
    "Graph read failed: HTTP 400",
  );
  expect(malformed.requests).toHaveLength(2);
});

it("does not retry initial sync errors or loop when an expiry restart fails", async () => {
  const expired = () => Response.json({ error: { code: "syncStateNotFound" } }, { status: 400 });
  const initial = reader([expired()]);
  await expect(initial.binding.ingest.list(account, undefined, bounds)).rejects.toThrow("HTTP 400");
  expect(initial.requests).toHaveLength(2);
  const restart = reader([expired(), expired(), fixtures.empty]);
  const saved = cursor();
  await expect(restart.binding.ingest.list(account, saved, bounds)).rejects.toThrow("HTTP 400");
  expect(restart.requests).toHaveLength(3);
  await restart.binding.ingest.list(account, saved, bounds);
  expect(restart.requests[3]?.url.href).toBe(JSON.parse(saved).url);
});

it("refuses invalid bounds, account cursors and unsafe continuation URLs before requesting credentials", async () => {
  const r = reader([]);
  for (const bad of [
    "",
    "null",
    "[]",
    "{}",
    "x".repeat(65537),
    cursor({ account: "other" }),
    cursor({ extra: 1 }),
    cursor({ url: null }),
    cursor({ url: link().replace("graph.microsoft.com", "evil.test") }),
    cursor({ url: link().replace("/me/", "/users/other/") }),
    cursor({ url: link().replace("/messages/delta", "/sendMail") }),
    cursor({ pending: null }),
    cursor({ pending: ["bad.id"], resume: link() }),
    cursor({ pending: ["a"] }),
    cursor({ resume: link() }),
    cursor({ pending: ["a"], resume: "bad" }),
    cursor({ pending: Array(513).fill("a"), resume: link() }),
  ])
    await expect(r.binding.ingest.list(account, bad, bounds)).rejects.toThrow();
  for (const bad of [
    { maxItems: 0, maxBytes: 1 },
    { maxItems: NaN, maxBytes: 1 },
    { maxItems: 1, maxBytes: 0 },
    { maxItems: 1, maxBytes: Infinity },
  ])
    await expect(r.binding.ingest.list(account, undefined, bad)).rejects.toThrow();
  expect(r.tokens.calls).toEqual([]);
  for (const bad of [
    null,
    "",
    "bad",
    "x".repeat(8193),
    link().replace("graph.microsoft.com", "evil.test"),
    link().replace("https:", "http:"),
    link().replace("/me/", "/users/other/"),
    link().replace("/inbox/", "/sentitems/"),
    link().replace("/messages/delta", "/messages"),
    link().replace("/inbox/", "/%ZZ/"),
    link().replace("/inbox/", "/inbox%2Fmessages/"),
    link().replace("mailFolders/inbox", "mailfolders('inbox')/childFolders('other')"),
    link().replace("mailFolders/inbox", "mailfolders('other')"),
    link().replace("https://", "https://user@"),
    link().replace("https://", "https://user:secret@"),
    `${link()}#fragment`,
    `${link()}\n`,
    link(""),
    `${link()}&$select=subject`,
    `${link()}&$select=id&$select=id`,
    `${link()}&$skiptoken=other`,
    `${link()}&$deltatoken=other`,
    `${link()}&access_token=secret`,
  ])
    expect(() => deltaLink(bad, inboxId)).toThrow("inbox delta link");
  expect(deltaLink(`${link()}&$select=id`, inboxId)).toContain("$select=id");
  expect(deltaLink(link("skip", "$skiptoken"), inboxId)).toContain("$skiptoken=skip");
});

it("fails closed on malformed pages, tombstones and repeated page links", async () => {
  for (const page of [
    null,
    {},
    { value: {} },
    { value: [] },
    { value: [], "@odata.nextLink": link("page2", "$skiptoken"), "@odata.deltaLink": link() },
    { value: [null], "@odata.deltaLink": link() },
    { value: [{ id: "../bad" }], "@odata.deltaLink": link() },
    { value: [{ id: "a", "@removed": null }], "@odata.deltaLink": link() },
    { value: [{ id: "a", "@removed": { reason: "other" } }], "@odata.deltaLink": link() },
    { value: Array(513).fill({ id: "a" }), "@odata.deltaLink": link() },
    {
      value: Array.from({ length: 100 }, (_, i) => ({ id: `${i}${"a".repeat(1000)}` })),
      "@odata.deltaLink": link(),
    },
    { value: [], "@odata.nextLink": link() },
    { value: [], "@odata.deltaLink": link("skip", "$skiptoken") },
  ])
    await expect(reader([page]).binding.ingest.list(account, undefined, bounds)).rejects.toThrow();
  await expect(
    reader([{ value: [], "@odata.nextLink": link("page2", "$skiptoken") }]).binding.ingest.list(
      account,
      cursor({ url: link("page2", "$skiptoken") }),
      bounds,
    ),
  ).rejects.toThrow("repeated");
});

it("snapshots strict receiving policy and rejects wrong grants and invalid configuration", async () => {
  const r = reader([]);
  r.config.ownAccounts.clear();
  const provider = raw.replace(
    "Content-Type: application/ld+json;",
    "Content-Description: agent-message.jsonld\r\nContent-Type: application/ld+json;",
  );
  expect(r.binding.ingest.parse({ id: "a", raw: provider }).warnings).toContain(
    "signature-unverified",
  );
  expect(() =>
    r.binding.ingest.parse({
      id: "a",
      raw: raw.replace("multipart/alternative", "multipart/mixed"),
    }),
  ).toThrow("human-parity-mismatch");
  const badGrant = {
    read: vi.fn(async () => ({ access: "send", accessToken: "fake" })),
    send: vi.fn(),
  };
  const bad = createGraphMailReader({ ...r.config, tokens: badGrant as never });
  await expect(bad.ingest.list(account, undefined, bounds)).rejects.toThrow("wrong-scope");
  expect(badGrant.send).not.toHaveBeenCalled();
  for (const extra of [{ recipient: "unsafe" }, { ownAccounts: undefined }, { footer: "\n" }])
    expect(() => createGraphMailReader({ ...r.config, ...extra } as never)).toThrow();
  const original = new Set(ORIGINS);
  (ORIGINS as Set<string>).add("https://evil.test");
  expect(createGraphMailReader(r.config).origins).toEqual(original);
  (ORIGINS as Set<string>).delete("https://evil.test");
  expect(AGENT_FOOTER).toBeTruthy();
});

it("bounds MIME and JSON, sanitizes provider errors and keeps construction offline", async () => {
  for (const bad of [null, [], "string"]) expect(() => record(bad)).toThrow();
  for (const bad of [null, "", "../x", "a".repeat(2049)]) expect(() => messageId(bad)).toThrow();
  expect(messageId("AAMk+one/==")).toBe("AAMk+one/==");
  await expect(responseBody(new Response("private body", { status: 500 }))).rejects.toThrow(
    "HTTP 500",
  );
  for (const response of [
    new Response("private malformed JSON"),
    Response.json(null),
    new Response("x".repeat(1024 * 1024 + 1)),
  ])
    await expect(responseBody(response)).rejects.toThrow("invalid Graph JSON");
  for (const response of [mime(""), mime("x".repeat(MAX_EMAIL_BYTES + 1))])
    await expect(mimeBody(response)).rejects.toThrow("byte length");
  expect((await mimeBody(mime("x".repeat(MAX_EMAIL_BYTES)))).byteLength).toBe(MAX_EMAIL_BYTES);
  expect(typeof graphMailRest()).toBe("function");
});
