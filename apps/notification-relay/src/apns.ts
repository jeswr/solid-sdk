// AUTHORED-BY Codex GPT-6
import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  type ClientHttp2Session,
  type ClientHttp2Stream,
  constants,
  connect as http2Connect,
  type IncomingHttpHeaders,
} from "node:http2";
import type { PushTransport, TransportResult } from "./push-delivery.js";
import type { PushPayload } from "./push-payload.js";

export interface ApnsMessage {
  token: string;
  headers: Record<string, string>;
  body: {
    aps: {
      alert?: { title: string; body: string };
      "mutable-content"?: 1;
      "thread-id"?: "inbox" | "chat";
      "content-available"?: 1;
    };
    p: string;
  };
}
export function buildApnsMessage(
  token: string,
  payload: PushPayload,
  p: string,
  bundleId: string,
  now: number,
): ApnsMessage {
  const challenge = payload.kind === "challenge";
  return {
    token,
    headers: {
      "apns-push-type": challenge ? "background" : "alert",
      "apns-priority": challenge ? "5" : "10",
      "apns-expiration": String(Math.floor(now / 1000) + 86_400),
      "apns-topic": bundleId,
      ...(!challenge
        ? {
            "apns-collapse-id": createHash("sha256")
              .update(JSON.stringify([payload.registrationId, payload.topicIndex]))
              .digest("hex")
              .slice(0, 32),
          }
        : {}),
    },
    body: {
      aps: challenge
        ? { "content-available": 1 }
        : {
            alert: { title: "Solid Suite", body: "You have new activity" },
            "mutable-content": 1,
            "thread-id": payload.kind,
          },
      p,
    },
  };
}
export interface ApnsOptions {
  key: string;
  keyId: string;
  teamId: string;
  sandbox?: boolean;
  connect?: typeof http2Connect;
  now?: () => number;
  /** End-to-end deadline, including queue time (default ten seconds). */
  requestTimeoutMs?: number;
  /** Maximum persistent HTTP/2 sessions, 1..4 (default one). */
  maxSessions?: number;
  /** Waiting requests, in addition to at most 100 streams per session (default 1,000). */
  maxQueued?: number;
}

type Connection = {
  session: ClientHttp2Session;
  capacity: number;
  active: Set<PendingRequest>;
};
type PendingRequest = {
  message: ApnsMessage;
  resolve: (result: TransportResult) => void;
  timer: ReturnType<typeof setTimeout>;
  connection?: Connection;
  stream?: ClientHttp2Stream;
};

/** Persistent bounded pool; peer settings govern streams and every queued request has a deadline. */
export function createApnsTransport(options: ApnsOptions): PushTransport<ApnsMessage> {
  const key = createPrivateKey(options.key);
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
    !options.keyId ||
    !options.teamId
  )
    throw new Error("Invalid APNs configuration");
  const connect = options.connect ?? http2Connect;
  const now = options.now ?? Date.now;
  const authority = options.sandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const maxSessions = options.maxSessions ?? 1;
  const maxQueued = options.maxQueued ?? 1000;
  const timeout = options.requestTimeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(maxSessions) ||
    maxSessions < 1 ||
    maxSessions > 4 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 1 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1
  )
    throw new Error("Invalid APNs pool configuration");
  const connections = new Set<Connection>();
  const queue = new Set<PendingRequest>();
  const pending = new Set<PendingRequest>();
  let cached: { jwt: string; created: number } | undefined;
  let closed = false;
  function token(): string {
    if (cached && now() - cached.created < 50 * 60_000) return cached.jwt;
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: options.keyId })).toString(
      "base64url",
    );
    const claims = Buffer.from(
      JSON.stringify({ iss: options.teamId, iat: Math.floor(now() / 1000) }),
    ).toString("base64url");
    const input = `${header}.${claims}`;
    const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
    cached = { jwt: `${input}.${signature.toString("base64url")}`, created: now() };
    return cached.jwt;
  }
  let scheduled = false;
  function wake() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      pump();
    });
  }
  function finish(job: PendingRequest, result: TransportResult) {
    if (!pending.delete(job)) return;
    clearTimeout(job.timer);
    queue.delete(job);
    job.connection?.active.delete(job);
    job.stream?.close(constants.NGHTTP2_CANCEL);
    job.resolve(result);
    wake();
  }
  function retire(connection: Connection) {
    // Remove before completing requests so no new stream can use a dead session.
    if (!connections.delete(connection)) return;
    for (const job of connection.active) finish(job, { status: 503 });
    // If the pool loses its last connection, return waiting work to the delivery sink too.
    // Its backoff prevents a failed handshake from becoming a tight reconnect loop.
    if (connections.size === 0) for (const job of queue) finish(job, { status: 503 });
    connection.session.destroy();
    wake();
  }
  function open() {
    const session = connect(authority);
    const connection: Connection = { session, capacity: 0, active: new Set() };
    connections.add(connection);
    // Wait for peer SETTINGS before opening any streams. A peer may advertise zero.
    session.on("remoteSettings", (settings) => {
      // Node supplies a complete peer-settings snapshot, including the protocol defaults.
      connection.capacity = Math.min(settings.maxConcurrentStreams as number, 100);
      wake();
    });
    session.on("error", () => retire(connection));
    session.on("close", () => retire(connection));
    session.on("goaway", () => retire(connection));
  }
  function start(connection: Connection, job: PendingRequest) {
    queue.delete(job);
    connection.active.add(job);
    job.connection = connection;
    let request: ClientHttp2Stream;
    try {
      request = connection.session.request({
        ...job.message.headers,
        ":method": "POST",
        ":path": `/3/device/${encodeURIComponent(job.message.token)}`,
        authorization: `bearer ${token()}`,
        "content-type": "application/json",
      });
    } catch {
      finish(job, { status: 503 });
      return;
    }
    job.stream = request;
    let headers: IncomingHttpHeaders = {};
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("response", (value: IncomingHttpHeaders) => {
      headers = value;
    });
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) finish(job, { status: 503 });
      else chunks.push(chunk);
    });
    request.once("error", () => finish(job, { status: 503 }));
    request.once("close", () => finish(job, { status: 503 }));
    request.once("end", () => {
      if (headers[":status"] === undefined) {
        finish(job, { status: 503 });
        return;
      }
      const result: TransportResult = { status: Number(headers[":status"]) };
      const retryAfter = headers["retry-after"];
      if (typeof retryAfter === "string") result.retryAfter = retryAfter;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof body?.reason === "string") result.reason = body.reason;
        if (typeof body?.timestamp === "number" && Number.isFinite(body.timestamp))
          result.timestamp = body.timestamp;
      } catch {
        /* Successful APNs responses have no body. */
      }
      finish(job, result);
    });
    request.end(JSON.stringify(job.message.body));
  }
  function pump() {
    if (closed) return;
    for (const job of queue) {
      const available = [...connections].find(
        (connection) => connection.active.size < connection.capacity,
      );
      if (available) start(available, job);
      else {
        if (connections.size < maxSessions) {
          try {
            open();
          } catch {
            finish(job, { status: 503 });
          }
        }
        // SETTINGS, completion or the deadline will resume the queue.
        return;
      }
    }
  }
  return {
    async send(message) {
      if (closed) throw new Error("APNs transport closed");
      if (queue.size >= maxQueued) return { status: 503 };
      return new Promise<TransportResult>((resolve) => {
        const job: PendingRequest = {
          message,
          resolve,
          timer: setTimeout(() => finish(job, { status: 503 }), timeout),
        };
        pending.add(job);
        queue.add(job);
        pump();
      });
    },
    close() {
      closed = true;
      for (const job of pending) finish(job, { status: 503 });
      for (const connection of connections) retire(connection);
    },
  };
}
