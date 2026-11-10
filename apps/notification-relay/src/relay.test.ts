// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { epoch, event, fixture, storage } from "../test/fixtures.js";
import { createRelay } from "./relay.js";

const active: ReturnType<typeof createRelay>[] = [];
afterEach(() => {
  for (const relay of active.splice(0)) relay.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function setup() {
  const f = await fixture();
  active.push(f.relay);
  return f;
}
const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);

test("authenticates registration, issues independent random IDs/tokens, and isolates tenants", async () => {
  const f = await setup();
  expect(f.registration.id).toMatch(/^[a-f0-9]{32}$/u);
  expect(f.registration.streamToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  const second = await (await f.register()).json();
  expect(second.id).not.toBe(f.registration.id);
  expect(second.streamToken).not.toBe(f.registration.streamToken);
  expect(f.identity).toHaveBeenCalledWith("id-token");
  const stream = await f.stream();
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  expect(stream.headers.get("cache-control")).toBe("no-store");
  expect(stream.headers.get("referrer-policy")).toBe("no-referrer");
  const reader = stream.body!.getReader();
  expect(decode((await reader.read()).value)).toBe(": connected\n\n");
  expect((await f.deliver()).status).toBe(202);
  expect(decode((await reader.read()).value)).toContain('"id":"one"');
  const foreign = await f.relay.handle(
    new Request(`https://relay.example/stream/${second.id}?token=${f.registration.streamToken}`),
  );
  expect(foreign.status).toBe(401);
  await reader.cancel();
});

test("authenticates before registration and never accepts unsafe storage URLs", async () => {
  const f = await setup();
  expect((await f.register(storage, { authorization: "" })).status).toBe(401);
  f.identity.mockRejectedValueOnce(new Error("secret detail"));
  const failed = await f.register();
  expect(failed.status).toBe(401);
  expect(await failed.text()).toBe("");
  for (const identity of [
    { subject: "", expiresAt: epoch + 1 },
    { subject: "a", expiresAt: NaN },
    { subject: "a", expiresAt: epoch },
  ]) {
    f.identity.mockResolvedValueOnce(identity);
    expect((await f.register()).status).toBe(401);
  }
  expect((await f.register(storage, { "content-type": "text/plain" })).status).toBe(400);
  for (const value of ["https://a/#key", "http://a/", "https://user:secret@a/", null])
    expect((await f.register(value)).status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await f.relay.handle(
        new Request("https://relay.example/register", {
          method: "POST",
          headers: { authorization: "Bearer token", "content-type": "application/json" },
        }),
      )
    ).status,
  ).toBe(401);
  const huge = new Request("https://relay.example/register", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: "x".repeat(1_048_577),
  });
  expect((await f.relay.handle(huge)).status).toBe(401);
});

test("rejects unsigned/tampered/foreign-storage notifications and suppresses signed replay", async () => {
  const f = await setup();
  expect(
    (
      await f.relay.handle(
        new Request(f.registration.inbox, { method: "POST", body: JSON.stringify(event) }),
      )
    ).status,
  ).toBe(401);
  const signed = f.signed(event, { url: f.registration.inbox });
  expect(
    (
      await f.relay.handle(
        new Request(signed.url, {
          method: "POST",
          headers: signed.headers,
          body: JSON.stringify({ ...event, storage: "foreign" }),
        }),
      )
    ).status,
  ).toBe(401);
  expect((await f.deliver({ ...event, storage: "foreign" })).status).toBe(401);
  expect((await f.deliver({ ...event, type: "Other" })).status).toBe(401);
  expect((await f.deliver()).status).toBe(202);
  expect((await f.deliver()).status).toBe(202);
  const reader = (await f.stream()).body!.getReader();
  await reader.read();
  expect(decode((await reader.read()).value)).toContain("id: 1\n");
  await reader.cancel();
  // No second replay entry.
  const resumed = (await f.stream("1")).body!.getReader();
  expect(decode((await resumed.read()).value)).toBe(": connected\n\n");
  await resumed.cancel();
  f.time(epoch + 300_001);
  expect((await f.deliver()).status).toBe(401);
});

test("rejects a valid signature when its key lacks an authentication relationship", async () => {
  const f = await setup();
  f.fetch.mockResolvedValueOnce(Response.json({ ...f.document, authentication: [] }));
  const response = await f.deliver();
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("");
});

test("replays Last-Event-ID exclusively and expires events at exactly fifteen minutes", async () => {
  const f = await setup();
  await f.deliver();
  f.time(epoch + 1);
  await f.deliver({ ...event, activity: [{ ...event.activity[0], id: "two" }] });
  const response = await f.stream("1");
  const reader = response.body!.getReader();
  await reader.read();
  expect(decode((await reader.read()).value)).toContain("id: 2\n");
  await reader.cancel();
  f.time(epoch + 900_000);
  const replay = (await f.stream()).body!.getReader();
  await replay.read();
  expect(decode((await replay.read()).value)).toContain("id: 2\n");
  await replay.cancel();
  f.time(epoch + 900_001);
  const empty = (await f.stream()).body!.getReader();
  expect(decode((await empty.read()).value)).toBe(": connected\n\n");
  await empty.cancel();
  for (const last of ["bad", "3", "-1"]) expect((await f.stream(last)).status).toBe(400);
});

test("requires stream capability tokens, handles aborts, peer limits, heartbeats and expiration", async () => {
  vi.useFakeTimers();
  const f = await setup();
  for (const token of ["", "bad", "z".repeat(43)])
    expect((await f.stream(undefined, token)).status).toBe(401);
  const abort = new AbortController();
  const response = await f.stream(undefined, f.registration.streamToken, abort.signal);
  const reader = response.body!.getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(decode((await reader.read()).value)).toBe(": heartbeat\n\n");
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  abort.abort();
  const already = new AbortController();
  already.abort();
  expect(
    (
      await (
        await f.stream(undefined, f.registration.streamToken, already.signal)
      )
        .body!.getReader()
        .read()
    ).done,
  ).toBe(true);
  const readers = [];
  for (let i = 0; i < 4; i++) readers.push((await f.stream()).body!.getReader());
  expect((await f.stream()).status).toBe(429);
  for (const reader of readers) await reader.cancel();
  const expiring = (await f.stream()).body!.getReader();
  await expiring.read();
  await vi.advanceTimersByTimeAsync(86_400_000);
  while (!(await expiring.read()).done) {
    /* Drain queued heartbeats before EOF. */
  }
  expect((await f.stream()).status).toBe(401);
});

test("checks expiry on requests and after asynchronous signature verification", async () => {
  const f = await setup();
  f.time(epoch + 86_400_000);
  expect((await f.stream()).status).toBe(401);
  const g = await setup();
  g.fetch.mockImplementationOnce(async () => {
    g.relay.close();
    return Response.json(g.document);
  });
  expect((await g.deliver()).status).toBe(401);
});

test("bounds registration count and closes all peers on shutdown", async () => {
  const f = await setup();
  for (let i = 1; i < 1000; i++) expect((await f.register()).status).toBe(201);
  expect((await f.register()).status).toBe(429);
  const response = await f.stream();
  const reader = response.body!.getReader();
  await reader.read();
  f.relay.close();
  expect((await reader.read()).done).toBe(true);
  expect((await f.register()).status).toBe(503);
});

test("bounds event count, buffer bytes and slow consumers", async () => {
  const f = await setup();
  for (let i = 0; i < 1001; i++)
    await f.deliver({ ...event, activity: [{ ...event.activity[0], id: String(i) }] });
  const reader = (await f.stream()).body!.getReader();
  await reader.read();
  expect(decode((await reader.read()).value)).toContain("id: 2\n");
  await reader.cancel();
  const slow = (await f.stream("1001")).body!.getReader();
  const payload = { ...event, padding: "x".repeat(900_000) };
  for (let i = 0; i < 6; i++) await f.deliver({ ...payload, n: i });
  // Consumer was closed when its bounded queue filled; drain it to observe EOF.
  let frames = 0;
  while (!(await slow.read()).done) frames++;
  expect(frames).toBeLessThan(7);
  const replay = (await f.stream()).body!.getReader();
  await replay.read();
  expect(decode((await replay.read()).value)).toContain("id: 1004\n");
  await replay.cancel();
}, 20_000);

test("fails closed when replay-protection capacity is exhausted", async () => {
  const f = await setup();
  for (let i = 0; i < 10_000; i++) {
    const result = await f.deliver({ ...event, n: i });
    expect(result.status).toBe(202);
  }
  expect((await f.deliver({ ...event, n: 10_000 })).status).toBe(429);
  f.time(epoch + 300_001);
  expect(
    (await f.deliver({ ...event, n: 10_001 }, { created: ((epoch + 300_001) / 1000) | 0 })).status,
  ).toBe(202);
  // 10,001 signed deliveries: about 9 s alone, but over 30 s in a full-workspace CI gate.
}, 120_000);

test("routes requests and enforces explicit CORS policy", async () => {
  const f = await setup();
  for (const path of ["/missing", "/inbox/bad"])
    expect((await f.relay.handle(new Request(`https://relay.example${path}`))).status).toBe(404);
  expect((await f.relay.handle(new Request("https://other.example/register"))).status).toBe(400);
  expect((await f.relay.handle(new Request(f.registration.inbox))).status).toBe(405);
  expect(
    (await f.relay.handle(new Request("https://relay.example/inbox/" + "b".repeat(32)))).status,
  ).toBe(401);
  for (const origin of ["https://app.example", "https://relay.example"]) {
    const response = await f.relay.handle(
      new Request("https://relay.example/register", { method: "OPTIONS", headers: { origin } }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-headers")).toContain("Last-Event-ID");
  }
  expect((await f.register(storage, { origin: "https://evil.example" })).status).toBe(403);
  for (const publicUrl of [
    "https://relay.example/prefix",
    "https://relay.example/?q=1",
    "https://relay.example/#f",
  ])
    expect(() => createRelay({ publicUrl, fetch: f.fetch, verifyIdToken: f.identity })).toThrow(
      "origin",
    );
  const relay = createRelay({
    publicUrl: "https://relay.example",
    fetch: f.fetch,
    verifyIdToken: f.identity,
  });
  active.push(relay);
  expect(
    (
      await relay.handle(
        new Request("https://relay.example/register", {
          method: "OPTIONS",
          headers: { origin: "https://other.example" },
        }),
      )
    ).status,
  ).toBe(403);
});

test("rejects registration without any authorization header", async () => {
  const f = await setup();
  expect(
    (await f.relay.handle(new Request("https://relay.example/register", { method: "POST" })))
      .status,
  ).toBe(401);
});
