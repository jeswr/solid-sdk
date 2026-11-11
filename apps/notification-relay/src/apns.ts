// AUTHORED-BY Codex GPT-6
import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  type ClientHttp2Stream,
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
  requestTimeoutMs?: number;
}

/** One bounded-lifetime HTTP/2 session per request; no idle socket or unbounded session queue. */
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
  const sessions = new Set<ReturnType<typeof connect>>();
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
  return {
    async send(message) {
      if (closed) throw new Error("APNs transport closed");
      return new Promise<TransportResult>((resolve, reject) => {
        const session = connect(authority);
        sessions.add(session);
        let settled = false;
        function finish(error?: Error, result?: TransportResult) {
          if (settled) return;
          settled = true;
          sessions.delete(session);
          session.destroy();
          if (error) reject(error);
          else resolve(result as TransportResult);
        }
        session.once("error", () => finish(new Error("APNs connection failed")));
        session.once("close", () => finish(new Error("APNs connection closed")));
        session.setTimeout(options.requestTimeoutMs ?? 5000, () =>
          finish(new Error("APNs request timed out")),
        );
        let request: ClientHttp2Stream;
        try {
          request = session.request({
            ...message.headers,
            ":method": "POST",
            ":path": `/3/device/${encodeURIComponent(message.token)}`,
            authorization: `bearer ${token()}`,
            "content-type": "application/json",
          });
        } catch {
          finish(new Error("APNs request failed"));
          return;
        }
        let headers: IncomingHttpHeaders = {};
        const chunks: Buffer[] = [];
        let size = 0;
        request.on("response", (value: IncomingHttpHeaders) => {
          headers = value;
        });
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 16_384) finish(new Error("APNs response too large"));
          else chunks.push(chunk);
        });
        request.once("error", () => finish(new Error("APNs request failed")));
        request.once("close", () => finish(new Error("APNs request closed")));
        request.once("end", () => {
          if (headers[":status"] === undefined) {
            finish(new Error("APNs connection closed without a response"));
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
          finish(undefined, result);
        });
        request.end(JSON.stringify(message.body));
      });
    },
    close() {
      closed = true;
      for (const session of sessions) session.destroy();
      sessions.clear();
    },
  };
}
