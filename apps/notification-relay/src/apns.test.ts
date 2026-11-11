// AUTHORED-BY Codex GPT-6
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
import { afterEach, expect, test } from "vitest";
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
async function local(handler: (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => void) {
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
  // Real Node HTTP/2 client/server and frames. Paired streams also run in sandboxes
  // that prohibit listen(); no HTTP/2 implementation methods are mocked.
  const injected = ((authority: string) => {
    authorities.push(authority);
    const [clientSocket, serverSocket] = duplexPair();
    const session = performServerHandshake(serverSocket);
    sessions.add(session);
    session.on("error", () => {});
    session.on("close", () => sessions.delete(session));
    session.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      stream.resume();
      handler(stream, headers);
    });
    return connect("http://local.test", { createConnection: () => clientSocket });
  }) as typeof connect;
  return { connect: injected, authorities };
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
  expect(fixture.authorities).toEqual(Array(3).fill("https://api.push.apple.com"));
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
  await expect(transport({ connect: oversized.connect }).send(message)).rejects.toThrow(
    "too large",
  );
  const silent = await local(() => {});
  await expect(
    transport({ connect: silent.connect, requestTimeoutMs: 20 }).send(message),
  ).rejects.toThrow("timed out");
  const reset = await local((stream) => stream.close(constants.NGHTTP2_INTERNAL_ERROR));
  await expect(transport({ connect: reset.connect }).send(message)).rejects.toThrow("request");
  const closed = await local((stream) => stream.session?.destroy());
  await expect(transport({ connect: closed.connect }).send(message)).rejects.toThrow(
    /closed|failed/u,
  );
  const refused = await local((stream) =>
    stream.session?.destroy(undefined, constants.NGHTTP2_INTERNAL_ERROR),
  );
  await expect(transport({ connect: refused.connect }).send(message)).rejects.toThrow(
    /connection|request/u,
  );
  const disconnected = transport({
    connect: (() => connect("http://127.0.0.1:1")) as typeof connect,
  });
  await expect(disconnected.send(message)).rejects.toThrow(/connection|request/u);
  const invalid = await local(() => {});
  await expect(
    transport({ connect: invalid.connect }).send({
      ...message,
      headers: { ...message.headers, "invalid header": "invalid" },
    }),
  ).rejects.toThrow("request failed");
});

test("close cancels active sessions, rejects subsequent sends, and default construction opens no socket", async () => {
  let started!: () => void;
  const arrived = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fixture = await local(() => started());
  const sender = transport({ connect: fixture.connect });
  const pending = sender.send(message);
  const rejected = expect(pending).rejects.toThrow(/closed|failed/u);
  await arrived;
  sender.close?.();
  await rejected;
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
