// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Identity } from "./auth.js";
import { createPushApi, type PushSink } from "./push.js";
import { createResourceTokenVerifier, mobileClientPolicy } from "./resource-auth.js";
import { createWebhookVerifier, safeUrl } from "./signatures.js";
import { InMemoryRelayStore, type RelayStore } from "./store.js";

const retentionMs = 15 * 60_000;
const maxBodyBytes = 1_048_576;
const encoder = new TextEncoder();
type Peer = { send(frame: string): void; close(cancelled?: boolean): void };
type Entry = { id: number; at: number; frame: string; bytes: number };
type Registration = {
  storage: string;
  token: string;
  expires: number;
  sequence: number;
  bytes: number;
  events: Entry[];
  seen: Map<string, number>;
  peers: Set<Peer>;
  timer: ReturnType<typeof setTimeout>;
};

async function readJson(request: Request): Promise<{ body: Buffer; json: unknown }> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBodyBytes) throw new Error("Body too large");
      chunks.push(value);
    }
    return {
      body: Buffer.concat(chunks),
      json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
  } finally {
    await reader.cancel();
  }
}

/** One process owns registrations and replay buffers. close() releases all streams/timers. */
export function createRelay(options: {
  publicUrl: string;
  verifyIdToken: (token: string) => Promise<Identity>;
  /** Must be SSRF/DNS-pinning guarded in production; default deployment supplies it. */
  fetch: typeof fetch;
  /** Push routes remain closed until the mobile Client ID Document is configured. */
  mobileClientId?: string;
  store?: RelayStore;
  pushSink?: PushSink;
  allowedOrigins?: readonly string[];
  now?: () => number;
  allowInsecureLoopback?: boolean;
}) {
  const base = safeUrl(options.publicUrl, options.allowInsecureLoopback);
  if (base.pathname !== "/" || base.search || base.hash)
    throw new Error("Relay URL must be an origin");
  const now = options.now ?? Date.now;
  const store = options.store ?? new InMemoryRelayStore(now);
  const verifyResourceToken = createResourceTokenVerifier({
    publicUrl: base.origin,
    outboundFetch: options.fetch,
    store,
    now,
    allowLoopbackForTests: options.allowInsecureLoopback,
  });
  const pushPolicy = options.mobileClientId
    ? mobileClientPolicy(options.mobileClientId)
    : undefined;
  const push = createPushApi({
    publicOrigin: base.origin,
    store,
    now,
    pushSink: options.pushSink,
    allowLoopback: options.allowInsecureLoopback,
    authorize: async (request) => {
      if (!pushPolicy) throw new Error("Push is not configured");
      const identity = await verifyResourceToken(request);
      if (!pushPolicy(identity)) throw new Error("Unauthorized");
      return identity;
    },
  });
  const sweep = setInterval(() => {
    void push.expire().catch(() => {});
  }, 60_000);
  sweep.unref();
  const verify = createWebhookVerifier({
    fetch: options.fetch,
    now,
    allowLoopback: options.allowInsecureLoopback,
  });
  const registrations = new Map<string, Registration>();
  let stopped = false;
  function drop(id: string, registration: Registration) {
    clearTimeout(registration.timer);
    for (const peer of registration.peers) peer.close();
    registrations.delete(id);
  }
  function trim(registration: Registration) {
    while (
      registration.events.length &&
      ((registration.events[0] as Entry).at <= now() - retentionMs ||
        registration.events.length > 1000 ||
        registration.bytes > 4 * maxBodyBytes)
    ) {
      registration.bytes -= (registration.events.shift() as Entry).bytes;
    }
    for (const [key, expiry] of registration.seen)
      if (expiry < now()) registration.seen.delete(key);
  }
  const handle = async (request: Request): Promise<Response> => {
    const headers = new Headers({ "cache-control": "no-store", "referrer-policy": "no-referrer" });
    const respond = (status: number, data?: unknown) =>
      new Response(data === undefined ? null : JSON.stringify(data), { status, headers });
    try {
      if (stopped) return respond(503);
      const url = new URL(request.url);
      if (url.origin !== base.origin) return respond(400);
      const origin = request.headers.get("origin");
      if (origin) {
        if (origin !== base.origin && !options.allowedOrigins?.includes(origin))
          return respond(403);
        headers.set("access-control-allow-origin", origin);
        headers.set("vary", "Origin");
      }
      if (
        request.method === "OPTIONS" &&
        ["/register", "/stream/", "/push/"].some((path) => url.pathname.startsWith(path))
      ) {
        headers.set("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
        headers.set(
          "access-control-allow-headers",
          "Authorization, DPoP, Installation-Proof, Content-Type, Last-Event-ID",
        );
        return respond(204);
      }
      if (url.pathname.startsWith("/push/")) return push.handle(request, headers);
      if (url.pathname === "/register" && request.method === "POST" && !url.search) {
        const bearer = /^Bearer (\S+)$/u.exec(request.headers.get("authorization") ?? "");
        if (!bearer) return respond(401);
        const identity = await options.verifyIdToken(bearer[1] as string);
        if (
          !identity.subject ||
          !Number.isFinite(identity.expiresAt) ||
          identity.expiresAt <= now()
        )
          return respond(401);
        if (request.headers.get("content-type") !== "application/json") return respond(400);
        const { json } = (await readJson(request)) as { json: { storage?: unknown } };
        const storage = safeUrl(json.storage, options.allowInsecureLoopback);
        if (storage.hash) return respond(400);
        if (registrations.size >= 1000) return respond(429);
        const id = randomBytes(16).toString("hex");
        const expires = Math.min(identity.expiresAt, now() + 86_400_000);
        const registration: Registration = {
          storage: storage.href,
          token: randomBytes(32).toString("base64url"),
          expires,
          sequence: 0,
          bytes: 0,
          events: [],
          seen: new Map(),
          peers: new Set(),
          timer: setTimeout(() => drop(id, registration), expires - now()),
        };
        registration.timer.unref();
        registrations.set(id, registration);
        headers.set("content-type", "application/json");
        return respond(201, {
          id,
          inbox: `${base.origin}/inbox/${id}`,
          streamToken: registration.token,
        });
      }
      const route = /^\/(inbox|stream)\/([a-f0-9]{32})$/u.exec(url.pathname);
      if (!route) return respond(404);
      const id = route[2] as string;
      const registration = registrations.get(id);
      if (!registration) return respond(401);
      if (registration.expires <= now()) {
        drop(id, registration);
        return respond(401);
      }
      trim(registration);
      if (route[1] === "inbox" && request.method === "POST" && !url.search) {
        const { body, json } = (await readJson(request)) as {
          body: Buffer;
          json: { storage?: unknown; type?: unknown };
        };
        const signed = await verify({
          url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body,
          storage: registration.storage,
        });
        // Expiration or shutdown may race asynchronous description retrieval.
        if (registrations.get(id) !== registration) return respond(401);
        if (json.storage !== registration.storage || json.type !== "Notification")
          return respond(401);
        if (registration.seen.has(signed.fingerprint)) return respond(202);
        // Keep replay protection bounded and fail closed rather than evicting live signatures.
        if (registration.seen.size >= 10_000) return respond(429);
        registration.seen.set(signed.fingerprint, signed.expires);
        const sequence = ++registration.sequence;
        const frame = `id: ${sequence}\ndata: ${JSON.stringify(json)}\n\n`;
        const entry = { id: sequence, at: now(), frame, bytes: encoder.encode(frame).length };
        registration.events.push(entry);
        registration.bytes += entry.bytes;
        trim(registration);
        for (const peer of registration.peers) peer.send(frame);
        return respond(202);
      }
      if (route[1] === "stream" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (
          !token ||
          !/^[A-Za-z0-9_-]{43}$/u.test(token) ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(registration.token))
        )
          return respond(401);
        const last = request.headers.get("last-event-id");
        if (last !== null && (!/^\d{1,15}$/u.test(last) || Number(last) > registration.sequence))
          return respond(400);
        if (registration.peers.size >= 4) return respond(429);
        let dispose: (cancelled?: boolean) => void;
        const onAbort = () => dispose();
        const stream = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              const peer: Peer = {
                send(frame) {
                  if ((controller.desiredSize as number) <= 0) {
                    peer.close();
                    return;
                  }
                  controller.enqueue(encoder.encode(frame));
                },
                close(cancelled = false) {
                  clearInterval(heartbeat);
                  registration.peers.delete(peer);
                  request.signal.removeEventListener("abort", onAbort);
                  if (!cancelled) controller.close();
                },
              };
              dispose = (cancelled) => peer.close(cancelled);
              const heartbeat = setInterval(() => {
                trim(registration);
                peer.send(": heartbeat\n\n");
              }, 20_000);
              heartbeat.unref();
              registration.peers.add(peer);
              request.signal.addEventListener("abort", onAbort, { once: true });
              if (request.signal.aborted) {
                peer.close();
                return;
              }
              peer.send(": connected\n\n");
              for (const event of registration.events)
                if (event.id > Number(last ?? 0)) peer.send(event.frame);
            },
            cancel() {
              dispose(true);
            },
          },
          { highWaterMark: 4 * maxBodyBytes + 1024, size: (chunk) => chunk.byteLength },
        );
        headers.set("content-type", "text/event-stream");
        headers.set("x-accel-buffering", "no");
        return new Response(stream, { headers });
      }
      return respond(405);
    } catch {
      return respond(401);
    }
  };
  return {
    handle,
    close() {
      stopped = true;
      clearInterval(sweep);
      for (const [id, registration] of registrations) drop(id, registration);
    },
  };
}
