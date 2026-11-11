// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  connect,
  constants,
  type IncomingHttpHeaders,
  performServerHandshake,
  type ServerHttp2Stream,
} from "node:http2";
import { duplexPair } from "node:stream";
import { jwtVerify } from "jose";
import { afterEach, expect, test, vi } from "vitest";
import { activity, challenge } from "../test/delivery-fixtures.js";
import { buildApnsMessage, createApnsTransport } from "./apns.js";

const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const options = {
  key: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  keyId: "KEY123",
  teamId: "TEAM123",
};
const active: ReturnType<typeof createApnsTransport>[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const transport of active.splice(0)) transport.close?.();
  for (const close of cleanup.splice(0)) await close();
});
async function local(
  handler: (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => void,
  settings: import("node:http2").Settings = {},
) {
  const sessions = new Set<import("node:http2").ServerHttp2Session>();
  cleanup.push(async () => {
    await Promise.all(
      [...sessions].map(
        (session) =>
          new Promise<void>((resolve) => {
            session.once("close", resolve);
            session.destroy();
          }),
      ),
    );
  });
  const authorities: string[] = [];
  const clients: import("node:http2").ClientHttp2Session[] = [];
  // Real Node HTTP/2 client/server and frames. Paired streams also run in sandboxes
  // that prohibit listen(); no HTTP/2 implementation methods are mocked.
  const injected = ((authority: string) => {
    authorities.push(authority);
    const [clientSocket, serverSocket] = duplexPair();
    const session = performServerHandshake(serverSocket, { settings });
    sessions.add(session);
    session.on("error", () => {});
    session.on("close", () => sessions.delete(session));
    session.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      stream.resume();
      handler(stream, headers);
    });
    const client = connect("http://local.test", { createConnection: () => clientSocket });
    clients.push(client);
    return client;
  }) as typeof connect;
  return { connect: injected, authorities, sessions, clients };
}
function transport(overrides: Partial<Parameters<typeof createApnsTransport>[0]> = {}) {
  const value = createApnsTransport({ ...options, ...overrides });
  active.push(value);
  return value;
}
const message = buildApnsMessage(
  "device-token",
  activity,
  "encrypted",
  "org.jeswr.suite",
  activity.sentAt,
);

test("builds the exact iOS alert and silent challenge, with opaque per-topic collapse ids and a 24-hour TTL", () => {
  const collapseId = createHash("sha256")
    .update(JSON.stringify([activity.registrationId, activity.topicIndex]))
    .digest("hex")
    .slice(0, 32);
  expect(message).toEqual({
    token: "device-token",
    headers: {
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(activity.sentAt / 1000 + 86_400),
      "apns-topic": "org.jeswr.suite",
      "apns-collapse-id": collapseId,
    },
    body: {
      aps: {
        alert: { title: "Solid Suite", body: "You have new activity" },
        "mutable-content": 1,
        "thread-id": "chat",
      },
      p: "encrypted",
    },
  });
  expect(collapseId).toMatch(/^[a-f0-9]{32}$/u);
  const inbox = buildApnsMessage(
    "device-token",
    { ...activity, kind: "inbox" },
    "p",
    "bundle",
    1234,
  );
  expect(inbox.body.aps["thread-id"]).toBe("inbox");
  const silent = buildApnsMessage(
    "device-token",
    challenge,
    "encrypted",
    "org.jeswr.suite",
    activity.sentAt,
  );
  expect(silent).toEqual({
    token: "device-token",
    headers: {
      "apns-push-type": "background",
      "apns-priority": "5",
      "apns-expiration": String(activity.sentAt / 1000 + 86_400),
      "apns-topic": "org.jeswr.suite",
    },
    body: { aps: { "content-available": 1 }, p: "encrypted" },
  });
});

test("sends real HTTP/2 requests with verifiable ES256 auth and refreshes JWTs every fifty minutes", async () => {
  const requests: { headers: IncomingHttpHeaders; body: string }[] = [];
  const fixture = await local((stream, headers) => {
    let body = "";
    stream.on("data", (data) => {
      body += data.toString();
    });
    stream.on("end", () => {
      requests.push({ headers, body });
      stream.respond({ ":status": 200 });
      stream.end();
    });
  });
  let now = activity.sentAt;
  const sender = transport({ connect: fixture.connect, now: () => now });
  expect(await sender.send(message)).toEqual({ status: 200 });
  expect(requests[0]?.headers).toMatchObject({
    ...message.headers,
    ":method": "POST",
    ":path": "/3/device/device-token",
    "content-type": "application/json",
  });
  expect(JSON.parse(requests[0]?.body as string)).toEqual(message.body);
  const token = (requests[0] as { headers: IncomingHttpHeaders }).headers.authorization?.slice(
    "bearer ".length,
  );
  const { payload, protectedHeader } = await jwtVerify(token, keys.publicKey, {
    algorithms: ["ES256"],
  });
  expect(payload).toEqual({ iss: "TEAM123", iat: now / 1000 });
  expect(protectedHeader).toEqual({ alg: "ES256", kid: "KEY123" });
  now += 50 * 60_000 - 1;
  await sender.send(message);
  expect(requests[1]?.headers.authorization).toBe(requests[0]?.headers.authorization);
  now++;
  await sender.send(message);
  expect(requests[2]?.headers.authorization).not.toBe(requests[0]?.headers.authorization);
  expect(fixture.authorities).toEqual(["https://api.push.apple.com"]);
  const sandbox = transport({ connect: fixture.connect, sandbox: true });
  await sandbox.send({ ...message, token: "token/with?delimiters" });
  expect(fixture.authorities.at(-1)).toBe("https://api.sandbox.push.apple.com");
  expect(requests.at(-1)?.headers[":path"]).toBe("/3/device/token%2Fwith%3Fdelimiters");
});

test("maps APNs error status, reason, millisecond timestamp and Retry-After over a real h2c server", async () => {
  const bodies = [
    JSON.stringify({ reason: "Unregistered", timestamp: 1_800_000_000_123 }),
    JSON.stringify({ reason: 3, timestamp: "wrong" }),
    "{}",
    "null",
    "not JSON",
  ];
  let index = 0;
  const fixture = await local((stream) => {
    stream.respond({ ":status": 410, ...(index === 0 ? { "retry-after": "20" } : {}) });
    stream.end(bodies[index++]);
  });
  const sender = transport({ connect: fixture.connect });
  expect(await sender.send(message)).toEqual({
    status: 410,
    reason: "Unregistered",
    timestamp: 1_800_000_000_123,
    retryAfter: "20",
  });
  for (let i = 1; i < bodies.length; i++)
    expect(await sender.send(message)).toEqual({ status: 410 });
});

test("bounds provider response bodies, times out hung requests, and reports stream/session failures", async () => {
  const oversized = await local((stream) => {
    stream.respond({ ":status": 500 });
    stream.end("x".repeat(32_768));
  });
  expect(await transport({ connect: oversized.connect }).send(message)).toEqual({ status: 503 });
  const silent = await local(() => {});
  await expect(
    transport({ connect: silent.connect, requestTimeoutMs: 20 }).send(message),
  ).resolves.toEqual({ status: 503 });
  const reset = await local((stream) => stream.close(constants.NGHTTP2_INTERNAL_ERROR));
  expect(await transport({ connect: reset.connect }).send(message)).toEqual({ status: 503 });
  const closed = await local((stream) => stream.session?.destroy());
  expect(await transport({ connect: closed.connect }).send(message)).toEqual({ status: 503 });
  const refused = await local((stream) =>
    stream.session?.destroy(undefined, constants.NGHTTP2_INTERNAL_ERROR),
  );
  expect(await transport({ connect: refused.connect }).send(message)).toEqual({ status: 503 });
  const disconnected = transport({
    connect: (() => connect("http://127.0.0.1:1")) as typeof connect,
  });
  await expect(disconnected.send(message)).resolves.toEqual({ status: 503 });
  const invalid = await local(() => {});
  await expect(
    transport({ connect: invalid.connect }).send({
      ...message,
      headers: { ...message.headers, "invalid header": "invalid" },
    }),
  ).resolves.toEqual({ status: 503 });
});

test("close cancels active sessions, rejects subsequent sends, and default construction opens no socket", async () => {
  let started!: () => void;
  const arrived = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fixture = await local(() => started());
  const sender = transport({ connect: fixture.connect });
  const pending = sender.send(message);
  const completed = expect(pending).resolves.toEqual({ status: 503 });
  await arrived;
  sender.close?.();
  await completed;
  await expect(sender.send(message)).rejects.toThrow("closed");
  transport();
});

test("validates key material, P-256 curve, team and key identifiers", () => {
  for (const override of [
    { key: "invalid" },
    { keyId: "" },
    { teamId: "" },
    {
      key: generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
    {
      key: generateKeyPairSync("ec", { namedCurve: "P-384" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
  ])
    expect(() => createApnsTransport({ ...options, ...override })).toThrow();
});

// Event-based stream arrival lets the tests hold responses without sleeps or real sockets.
function arrivals() {
  const streams: ServerHttp2Stream[] = [];
  let changed: (() => void) | undefined;
  return {
    streams,
    handler(stream: ServerHttp2Stream) {
      streams.push(stream);
      changed?.();
    },
    async count(n: number) {
      while (streams.length < n)
        await new Promise<void>((resolve) => {
          changed = resolve;
        });
    },
    respond(index: number) {
      const stream = streams[index] as ServerHttp2Stream;
      stream.respond({ ":status": 200 });
      stream.end();
    },
  };
}

test("honours peer stream limits, queues excess requests and resumes after completion or SETTINGS changes", async () => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 1 });
  const sender = transport({ connect: fixture.connect });
  const a = sender.send(message);
  const b = sender.send(message);
  const c = sender.send(message);
  await arrived.count(1);
  expect(arrived.streams).toHaveLength(1);
  expect(fixture.authorities).toHaveLength(1);
  arrived.respond(0);
  expect(await a).toEqual({ status: 200 });
  await arrived.count(2);
  expect(arrived.streams).toHaveLength(2);
  // A changed setting, rather than an existing stream completing, releases the next one.
  for (const session of fixture.sessions) session.settings({ maxConcurrentStreams: 2 });
  await arrived.count(3);
  arrived.respond(1);
  arrived.respond(2);
  expect(await Promise.all([b, c])).toEqual([{ status: 200 }, { status: 200 }]);
  expect(fixture.authorities).toHaveLength(1);
});

test("pool size and queue are bounded, and close completes both active and waiting work", async () => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 1 });
  const sender = transport({ connect: fixture.connect, maxSessions: 2, maxQueued: 1 });
  const a = sender.send(message);
  await arrived.count(1);
  const b = sender.send(message);
  await arrived.count(2);
  const c = sender.send(message);
  expect(await sender.send(message)).toEqual({ status: 503 });
  expect(arrived.streams).toHaveLength(2);
  expect(fixture.authorities).toHaveLength(2);
  sender.close?.();
  expect(await Promise.all([a, b, c])).toEqual(Array(3).fill({ status: 503 }));
  await expect(sender.send(message)).rejects.toThrow("closed");
  await vi.waitFor(() => expect(fixture.sessions.size).toBe(0));
});

test("deadlines cover queued work even if a peer allows zero streams", async () => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 0 });
  const sender = transport({ connect: fixture.connect, requestTimeoutMs: 20 });
  expect(await sender.send(message)).toEqual({ status: 503 });
  expect(arrived.streams).toHaveLength(0);
  expect(fixture.authorities).toHaveLength(1);
});

test("per-request deadlines survive an active session and allow later sends to reuse it", async () => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 1 });
  const sender = transport({ connect: fixture.connect, requestTimeoutMs: 50 });
  const hung = sender.send(message);
  await arrived.count(1);
  // Keep receiving data: an inactivity timeout would never fire here.
  const stream = arrived.streams[0] as ServerHttp2Stream;
  stream.respond({ ":status": 200 });
  const interval = setInterval(() => stream.write(" "), 5);
  try {
    expect(await hung).toEqual({ status: 503 });
  } finally {
    clearInterval(interval);
  }
  const next = sender.send(message);
  await arrived.count(2);
  arrived.respond(1);
  expect(await next).toEqual({ status: 200 });
  expect(fixture.authorities).toHaveLength(1);
});

test.each([
  "close",
  "error",
  "goaway",
] as const)("reconnects after session %s and fails its in-flight requests transiently", async (event) => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 2 });
  const sender = transport({ connect: fixture.connect });
  const a = sender.send(message);
  const b = sender.send(message);
  await arrived.count(2);
  const session = [...fixture.sessions][0] as import("node:http2").ServerHttp2Session;
  if (event === "goaway") session.goaway();
  else session.destroy(undefined, event === "error" ? constants.NGHTTP2_INTERNAL_ERROR : undefined);
  expect(await Promise.all([a, b])).toEqual([{ status: 503 }, { status: 503 }]);
  const next = sender.send(message);
  await arrived.count(3);
  arrived.respond(2);
  expect(await next).toEqual({ status: 200 });
  expect(fixture.authorities).toHaveLength(2);
});

test("an idle session's GOAWAY removes it so the next send reconnects", async () => {
  const fixture = await local((stream) => {
    stream.respond({ ":status": 200 });
    stream.end();
  });
  const sender = transport({ connect: fixture.connect });
  await sender.send(message);
  const session = [...fixture.sessions][0] as import("node:http2").ServerHttp2Session;
  const gone = new Promise<void>((resolve) => fixture.clients[0]?.once("goaway", () => resolve()));
  session.goaway();
  await gone;
  expect(await sender.send(message)).toEqual({ status: 200 });
  expect(fixture.authorities).toHaveLength(2);
});

test("connection construction failures are transient and leave queued work and future sends usable", async () => {
  const fixture = await local((stream) => {
    stream.respond({ ":status": 200 });
    stream.end();
  });
  const connect = vi.fn(fixture.connect).mockImplementationOnce(() => {
    throw new Error("connect failed");
  });
  const sender = transport({ connect });
  expect(await sender.send(message)).toEqual({ status: 503 });
  expect(await sender.send(message)).toEqual({ status: 200 });
});

test("a session that goes silent after a good exchange fails its PING and is replaced", async () => {
  const fixture = await local((stream) => {
    stream.respond({ ":status": 200 });
    stream.end();
  });
  // A real client/server pair whose server end the test keeps, so it can silence it.
  const [clientSocket, serverSocket] = duplexPair();
  const server = performServerHandshake(serverSocket);
  server.on("error", () => {});
  server.on("stream", (stream) => {
    stream.on("error", () => {});
    stream.respond({ ":status": 200 });
    stream.end();
  });
  cleanup.push(async () => {
    server.destroy();
  });
  const first = connect("http://local.test", { createConnection: () => clientSocket });
  const opened = vi.fn(fixture.connect).mockImplementationOnce(() => first);
  const sender = transport({ connect: opened, requestTimeoutMs: 50, healthCheckTimeoutMs: 30 });
  expect(await sender.send(message)).toEqual({ status: 200 });
  // The peer stops reading: no response, no PING ACK, and the socket never closes.
  serverSocket.pause();
  // Two streams miss the deadline together; the session gets one PING, not two.
  const ping = vi.spyOn(first, "ping");
  expect(await Promise.all([sender.send(message), sender.send(message)])).toEqual([
    { status: 503 },
    { status: 503 },
  ]);
  expect(ping).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(first.destroyed).toBe(true));
  expect(opened).toHaveBeenCalledTimes(1);
  expect(await sender.send(message)).toEqual({ status: 200 });
  expect(opened).toHaveBeenCalledTimes(2);
});

test("a missed deadline on a healthy session keeps it after its PING is answered", async () => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 2 });
  const sender = transport({ connect: fixture.connect, requestTimeoutMs: 40 });
  const hung = sender.send(message);
  await arrived.count(1);
  expect(await hung).toEqual({ status: 503 });
  const next = sender.send(message);
  await arrived.count(2);
  arrived.respond(1);
  expect(await next).toEqual({ status: 200 });
  expect(fixture.authorities).toHaveLength(1);
  expect(fixture.clients[0]?.destroyed).toBe(false);
});

test("a handshake that never sends SETTINGS is retired at the deadline", async () => {
  const fixture = await local((stream) => {
    stream.respond({ ":status": 200 });
    stream.end();
  });
  const [clientSocket] = duplexPair(); // the peer end never speaks HTTP/2
  const silent = connect("http://local.test", { createConnection: () => clientSocket });
  silent.on("error", () => {});
  const opened = vi.fn(fixture.connect).mockImplementationOnce(() => silent);
  const sender = transport({ connect: opened, requestTimeoutMs: 30 });
  expect(await sender.send(message)).toEqual({ status: 503 });
  await vi.waitFor(() => expect(silent.destroyed).toBe(true));
  expect(await sender.send(message)).toEqual({ status: 200 });
  expect(opened).toHaveBeenCalledTimes(2);
});

test.each([
  [
    "a PING error",
    (cb: (error: Error | null) => void) => {
      cb(new Error("ping failed"));
      return true;
    },
  ],
  ["a refused PING", () => false],
  [
    "a PING that throws",
    () => {
      throw new Error("invalid session");
    },
  ],
] as const)("%s after a missed deadline retires the session", async (_, ping) => {
  const arrived = arrivals();
  const fixture = await local(arrived.handler, { maxConcurrentStreams: 2 });
  const sender = transport({ connect: fixture.connect, requestTimeoutMs: 40 });
  const hung = sender.send(message);
  await arrived.count(1);
  const client = fixture.clients[0] as import("node:http2").ClientHttp2Session;
  vi.spyOn(client, "ping").mockImplementation(ping as never);
  expect(await hung).toEqual({ status: 503 });
  await vi.waitFor(() => expect(client.destroyed).toBe(true));
  const next = sender.send(message);
  await arrived.count(2);
  arrived.respond(1);
  expect(await next).toEqual({ status: 200 });
  expect(fixture.authorities).toHaveLength(2);
});

test("validates pool size, queue capacity and finite positive request deadlines", () => {
  for (const override of [
    { maxSessions: 0 },
    { maxSessions: 5 },
    { maxSessions: 1.5 },
    { maxQueued: 0 },
    { maxQueued: Number.POSITIVE_INFINITY },
    { requestTimeoutMs: 0 },
    { requestTimeoutMs: 1.5 },
    { healthCheckTimeoutMs: 0 },
    { healthCheckTimeoutMs: 1.5 },
  ])
    expect(() => createApnsTransport({ ...options, ...override })).toThrow("configuration");
});
