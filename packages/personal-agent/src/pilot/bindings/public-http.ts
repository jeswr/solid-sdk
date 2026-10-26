/**
 * OPTIONAL LOCAL PUBLIC CARRIAGE (`public-http/0.1`) for the declared public profile
 * (CONFIG_PUBLIC): an ANONYMOUS requester sends one UNSIGNED public request and receives the
 * service's SIGNED response in the HTTP reply. It exists because the represented bindings
 * cannot express anonymous access: the A2A listener requires an access token and the MCP
 * server is the operator's own interface. Here there is no principal, credential, token or
 * cookie — nothing identifies the requester.
 *
 * Boundaries:
 *  - loopback listener only (127.0.0.1/::1), Host header must name that literal address,
 *    browser-originated requests (Origin) refused;
 *  - accepts ONLY `awp-unsigned-json/0.1` requests (the runtime then admits them only for
 *    operations whose declared access is public and kinds the public configuration allows);
 *  - bounds: request body ≤ 64 KiB (Content-Length required), response read ≤ 256 KiB, at most
 *    8 requests in progress (503 otherwise), per-request deadline;
 *  - every message leaves through `AgentRuntime.transmit` (authentic outbox entry, unexpired,
 *    re-authorised if it carries an action) on both sides;
 *  - peers are pinned (`public-peers.json`: actor → loopback URL) for actors whose keys are
 *    pinned — the requester verifies the SIGNED responses with the pinned service key;
 *  - a response counts as handed off once written to the requester's open connection; a
 *    dropped connection is not observed (the requester simply asks again — public data).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { type AgentHost, HostRefusal, type Json } from "../host.js";
import type { TrustStoreData } from "../mechanisms/trust.js";
import type { OutboundMessage } from "../runtime/agent.js";
import {
  type ProviderSendResult,
  type TransmitResult,
  wireDigest,
} from "../runtime/transmission.js";
import type { WireMessage } from "../store/state.js";

export const PUBLIC_BINDING = "public-http/0.1";
export const PUBLIC_PATH = "/awp/public";
export const PUBLIC_CONFIG_FILE = "public-http.json";
export const PUBLIC_PEERS_FILE = "public-peers.json";
export const MAX_PUBLIC_BODY_BYTES = 64 * 1024;
export const MAX_PUBLIC_RESPONSE_BYTES = 256 * 1024;
export const MAX_PUBLIC_IN_PROGRESS = 8;
export const PUBLIC_DEADLINE_MS = 10_000;

const LOOPBACK = ["127.0.0.1", "::1"] as const;
const configSchema = z.strictObject({
  version: z.literal(1),
  host: z.enum(LOOPBACK),
  port: z.number().int().min(1024).max(65535),
});
export type PublicConfig = z.infer<typeof configSchema>;
const peerSchema = z.strictObject({ actor: z.string().min(8).max(512), url: z.string() });
export type PublicPeer = z.infer<typeof peerSchema>;
const peersSchema = z.strictObject({ version: z.literal(1), peers: z.array(peerSchema).max(64) });
const endpointCardSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("awp-public-endpoint"),
  actor: z.string().min(8).max(512),
  url: z.string(),
  binding: z.literal(PUBLIC_BINDING),
  note: z.string().max(500).optional(),
});
const unsignedWire = z.strictObject({
  format: z.literal("awp-unsigned-json/0.1"),
  payload: z.string().min(2).max(MAX_PUBLIC_BODY_BYTES),
});
const requestSchema = z.strictObject({ wire: unsignedWire });
const signedWire = z.strictObject({
  format: z.literal("awp-jws-compact/0.1"),
  jws: z.string().min(16).max(MAX_PUBLIC_RESPONSE_BYTES),
});
const responseSchema = z.strictObject({
  binding: z.literal(PUBLIC_BINDING),
  disposition: z.string().max(32),
  outbound: z.array(signedWire).max(8),
});

function hostLiteral(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

/** `http://127.0.0.1:PORT/awp/public` or `http://[::1]:PORT/awp/public` only. */
export function publicEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("public endpoint is not a URL");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !(LOOPBACK as readonly string[]).includes(host))
    throw new Error("public endpoint must be http on the literal loopback address");
  if (!url.port || url.username || url.password || url.search || url.hash)
    throw new Error("public endpoint needs an explicit port and no credentials/query/fragment");
  if (url.pathname !== PUBLIC_PATH) throw new Error(`public endpoint path must be ${PUBLIC_PATH}`);
  return url;
}

export function readPublicConfig(dir: string): PublicConfig | undefined {
  const path = join(dir, PUBLIC_CONFIG_FILE);
  return existsSync(path) ? configSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : undefined;
}

export function configurePublic(dir: string, input: { host?: string; port: number }): PublicConfig {
  const config = configSchema.parse({
    version: 1,
    host: input.host ?? "127.0.0.1",
    port: input.port,
  });
  writeJson(join(dir, PUBLIC_CONFIG_FILE), config);
  return config;
}

export function publicUrlOf(config: PublicConfig): string {
  return `http://${hostLiteral(config.host)}:${config.port}${PUBLIC_PATH}`;
}

/** The endpoint card a requester pins (public information: no token). */
export function endpointCard(config: PublicConfig, actor: string) {
  return {
    version: 1 as const,
    kind: "awp-public-endpoint" as const,
    actor,
    url: publicUrlOf(config),
    binding: PUBLIC_BINDING,
    note: "anonymous public carriage; responses are signed by the pinned service key",
  };
}

export function readPublicPeers(dir: string): PublicPeer[] {
  const path = join(dir, PUBLIC_PEERS_FILE);
  if (!existsSync(path)) return [];
  const peers = peersSchema.parse(JSON.parse(readFileSync(path, "utf8"))).peers;
  for (const p of peers) publicEndpoint(p.url);
  return peers;
}

/** Pin a public service endpoint; the service's keys must already be pinned. */
export function pinPublicPeer(dir: string, trust: TrustStoreData, raw: unknown): PublicPeer {
  const c = endpointCardSchema.parse(raw);
  publicEndpoint(c.url);
  if (!trust.keys.some((k) => k.role === "actor" && k.subject === c.actor))
    throw new Error("pin the service's card (keys) first; an endpoint never establishes trust");
  const peer = { actor: c.actor, url: c.url };
  const peers = readPublicPeers(dir).filter((p) => p.actor !== c.actor);
  writeJson(join(dir, PUBLIC_PEERS_FILE), { version: 1, peers: [...peers, peer] });
  return peer;
}

// ------------------------------------------------------------------ server (the public service)

export interface PublicListener {
  readonly url: string;
  close(): Promise<void>;
}

export async function startPublicServer(
  host: AgentHost,
  config: PublicConfig,
  log: (line: string) => void,
  options: { onRequest?: (r: { method: string; headers: string[]; bytes: number }) => void } = {},
): Promise<PublicListener> {
  const cfg = configSchema.parse(config);
  const authority = `${hostLiteral(cfg.host)}:${cfg.port}`;
  let inProgress = 0;
  const reply = (res: ServerResponse, status: number, body: Json) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
    });
    res.end(text);
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.host !== authority) return reply(res, 421, { error: "unexpected Host" });
    if (req.headers.origin !== undefined)
      return reply(res, 403, { error: "browser requests refused" });
    if (req.method !== "POST" || req.url !== PUBLIC_PATH)
      return reply(res, 404, { error: "not found" });
    const length = Number(req.headers["content-length"]);
    if (!Number.isFinite(length)) return reply(res, 411, { error: "Content-Length required" });
    if (length > MAX_PUBLIC_BODY_BYTES) return reply(res, 413, { error: "request too large" });
    if (inProgress >= MAX_PUBLIC_IN_PROGRESS) return reply(res, 503, { error: "busy" });
    inProgress++;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > MAX_PUBLIC_BODY_BYTES) return reply(res, 413, { error: "request too large" });
        chunks.push(c as Buffer);
      }
      // What reached the service boundary (header NAMES only; no values are kept).
      options.onRequest?.({
        method: req.method ?? "",
        headers: Object.keys(req.headers),
        bytes: size,
      });
      let wire: z.infer<typeof unsignedWire>;
      try {
        wire = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).wire;
      } catch {
        return reply(res, 400, {
          error: "expected {wire} with one anonymous unsigned public request",
        });
      }
      let report: Awaited<ReturnType<AgentHost["deliver"]>>;
      try {
        report = await host.call(async () => {
          const r = await host.deliver({
            format: "envelope",
            data: JSON.stringify(wire),
            carrier: PUBLIC_BINDING,
          });
          host.agent.rt.recordBindingEvent({
            type: "public-request",
            binding: PUBLIC_BINDING,
            ...(r.step?.messageId ? { message: r.step.messageId } : {}),
            bytes: size,
            credentialHeaders: ["authorization", "cookie", "proxy-authorization"].filter(
              (h) => h in req.headers,
            ),
            note: "anonymous: no requester identity, credential or token is recorded",
          });
          return r;
        });
      } catch (error) {
        return reply(res, error instanceof HostRefusal ? 503 : 500, {
          error: (error as Error).message.slice(0, 200),
        });
      }
      // Each response leaves through the transmission boundary; it is written to THIS reply.
      // An IDENTICAL retry of an anonymous request (the requester lost the earlier reply) is a
      // duplicate at the runtime, which returns the responses it already made; those were
      // transmitted before (`duplicate`), and their SAME signed bytes are returned again —
      // public data, re-authorised by `transmit` like any send, no handler re-run.
      const rt = host.agent.rt;
      const outbound: WireMessage[] = [];
      for (const item of report.outbound) {
        const result = await rt.transmit(
          {
            messageId: item.id,
            binding: PUBLIC_BINDING,
            externalId: `public:${item.id}`,
            wireDigest: wireDigest(item.envelope),
          },
          {
            send: async () => ({
              outcome: "accepted",
              providerRef: `public-reply:${randomUUID()}`,
            }),
          },
        );
        if (result.status === "sent" || result.status === "duplicate") {
          outbound.push(item.envelope);
          await host.call(() => host.ack([item.id]));
        }
      }
      reply(res, 200, {
        binding: PUBLIC_BINDING,
        disposition: report.step?.disposition ?? "rejected",
        outbound: outbound as unknown as Json[],
      });
    } finally {
      inProgress--;
    }
  };
  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: Error) => {
      log(`public: ${error.message}`);
      if (!res.headersSent) reply(res, 500, { error: "internal error" });
    });
  });
  server.requestTimeout = PUBLIC_DEADLINE_MS;
  server.headersTimeout = PUBLIC_DEADLINE_MS;
  server.keepAliveTimeout = 1_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  const url = publicUrlOf(cfg);
  log(`public: listening on ${url} (loopback only; anonymous public requests)`);
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// ------------------------------------------------------------------ client (the anonymous requester)

/** Durable spool of received, not yet processed public replies (requester side). */
export const PUBLIC_REPLIES_FILE = "public-replies.json";
/** Most reply sets retained at once; new requests are held (not sent) while it is full. */
export const MAX_RETAINED_REPLIES = 64;
/** Identical-retry bound for an unresolved public request (lost / malformed reply). */
export const PUBLIC_MAX_ATTEMPTS = 5;

const retainedSchema = z.strictObject({
  version: z.literal(1),
  replies: z
    .array(
      z.strictObject({
        request: z.string().min(8).max(512),
        toActor: z.string().min(8).max(512),
        receivedAt: z.string().max(64),
        bytes: z.number().int().min(0).max(MAX_PUBLIC_RESPONSE_BYTES),
        wires: z.array(signedWire).max(8),
      }),
    )
    .max(MAX_RETAINED_REPLIES),
});
type Retained = z.infer<typeof retainedSchema>["replies"][number];

/**
 * The requester's reply spool. A reply is written here (atomically, 0600) BEFORE its request's
 * transmission counts as sent, and removed only after the runtime processed every signed
 * response and the request was retired. So an interruption anywhere after the HTTP reply was
 * received loses nothing; processing again is idempotent (the runtime deduplicates by message
 * id). Bounded: at most MAX_RETAINED_REPLIES sets of ≤ 256 KiB; malformed contents fail closed.
 */
class ReplySpool {
  constructor(private readonly path: string) {}
  list(): Retained[] {
    if (!existsSync(this.path)) return [];
    return retainedSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))).replies;
  }
  put(entry: Retained): void {
    const rest = this.list().filter((r) => r.request !== entry.request);
    if (rest.length >= MAX_RETAINED_REPLIES) throw new Error("reply spool full");
    writeJson(this.path, { version: 1, replies: [...rest, entry] });
  }
  remove(request: string): void {
    const rest = this.list().filter((r) => r.request !== request);
    writeJson(this.path, { version: 1, replies: rest });
  }
}

/** Fault points of the requester's reply path (tests and the separate-process harness). */
export type PublicFaultPoint = "after-receipt" | "after-processing";
function envFault(point: PublicFaultPoint): void {
  // AWP_SYNTHETIC_FAULT=public-kill-<point>: the process dies here (SIGKILL), as in a crash.
  if (process.env.AWP_SYNTHETIC_FAULT === `public-kill-${point}`)
    process.kill(process.pid, "SIGKILL");
}

/**
 * Sends this agent's undelivered public requests to pinned public services through the
 * transmission boundary, then hands the SIGNED responses to the runtime (verified there with
 * the pinned service keys). Network I/O runs outside every lock.
 *
 * Three distinct outcomes are recorded: TRANSPORT completion (the transmission record + a
 * `public-reply-received` binding event with the byte count), RESPONSE VALIDATION (the
 * runtime's disposition per signed response, `public-reply-processed`), and DOMAIN completion
 * (the conversation / comparison — not decided here).
 *
 * Lost or malformed replies: the request stays unresolved (`uncertain`) and is re-sent only as
 * the IDENTICAL unsigned request (same message id), because this carriage serves only the
 * declared public, read-only profile and the service deduplicates by message id and returns
 * the responses it already made. A request whose send was recorded but whose reply was never
 * retained (possible only for records written before the spool existed) is not re-sent; start
 * a new public request round instead.
 */
export class PublicDispatcher {
  #running: Promise<Json> | undefined;
  readonly #spool: ReplySpool;
  constructor(
    private readonly host: AgentHost,
    private readonly peers: readonly PublicPeer[],
    private readonly log: (line: string) => void,
    private readonly deadlineMs = PUBLIC_DEADLINE_MS,
    /** Test fault injection at the reply path's interruption points. */
    private readonly fault?: (point: PublicFaultPoint) => void,
    /** The HTTP client (tests inject lossy / malformed replies). */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    for (const p of peers) publicEndpoint(p.url);
    this.#spool = new ReplySpool(join(host.agent.dir, PUBLIC_REPLIES_FILE));
  }

  /** Retained reply sets not yet processed (request ids). */
  retained(): string[] {
    return this.#spool.list().map((r) => r.request);
  }

  /**
   * Process every retained reply set through the runtime (idempotent), retire its request and
   * drop it from the spool. Called before each dispatch and at service start.
   */
  async recover(): Promise<Json[]> {
    const done: Json[] = [];
    for (const r of this.#spool.list()) done.push(await this.#process(r));
    return done;
  }

  /** Hand one retained reply set to the runtime; then retire the request; then forget it. */
  async #process(r: Retained): Promise<Json> {
    const dispositions: string[] = [];
    await this.host.call(async () => {
      const rt = this.host.agent.rt;
      for (const [i, w] of r.wires.entries()) {
        const rep = await this.host.deliver({
          format: "envelope",
          data: JSON.stringify(w),
          carrier: PUBLIC_BINDING,
        });
        const disposition = rep.step?.disposition ?? "rejected";
        dispositions.push(disposition);
        rt.recordBindingEvent({
          type: "public-reply-processed",
          binding: PUBLIC_BINDING,
          request: r.request,
          response: i,
          disposition,
          ...(rep.step?.reason ? { reason: rep.step.reason } : {}),
          note: "response validation by the runtime (signature, pinned key, audience, replay); not domain completion",
        });
      }
      this.fault?.("after-processing");
      envFault("after-processing");
      if (this.host.undelivered().some((m) => m.id === r.request)) await this.host.ack([r.request]);
    });
    this.#spool.remove(r.request);
    return { id: r.request, toActor: r.toActor, responses: dispositions };
  }

  get pinned(): readonly PublicPeer[] {
    return this.peers;
  }

  #again = false;

  async idle(): Promise<void> {
    this.#again = false;
    while (this.#running) await this.#running.catch(() => undefined);
  }

  /** Coalescing background trigger (auto-dispatch); never runs inside a lock. */
  kick(): void {
    if (this.#running) {
      this.#again = true;
      return;
    }
    setImmediate(() => {
      this.dispatch().catch((error: Error) => this.log(`public dispatch: ${error.message}`));
    });
  }

  dispatch(toActor?: string): Promise<Json> {
    if (this.#running) return this.#running;
    const run = this.#once(toActor).finally(() => {
      this.#running = undefined;
      if (this.#again) {
        this.#again = false;
        this.kick();
      }
    });
    this.#running = run;
    return run;
  }

  async #once(toActor?: string): Promise<Json> {
    // Replies retained before an interruption are processed first.
    const delivered: Json[] = [...(await this.recover())];
    const byActor = new Map(this.peers.map((p) => [p.actor, p]));
    const queue = await this.host.call(async () =>
      this.host
        .undelivered(toActor)
        .filter((m) => m.toActor && byActor.has(m.toActor))
        .map((m) => ({ id: m.id, wire: m.wire, toActor: m.toActor as string, kind: m.kind })),
    );
    const rt = this.host.agent.rt;
    const failed: Json[] = [];
    for (const m of queue) {
      const peer = byActor.get(m.toActor) as PublicPeer;
      if (this.#spool.list().length >= MAX_RETAINED_REPLIES) {
        failed.push({
          id: m.id,
          kind: m.kind,
          toActor: m.toActor,
          status: "held",
          detail: "reply spool full; not sent (retained replies are processed first)",
        });
        continue;
      }
      // Identical re-sends only for anonymous public requests (read-only profile, receiver
      // deduplicates by message id); anything else keeps the default (no resend).
      const publicRead = m.wire.format === "awp-unsigned-json/0.1";
      let result: TransmitResult;
      try {
        result = await rt.transmit(
          {
            messageId: m.id,
            binding: PUBLIC_BINDING,
            externalId: `public:${m.id}`,
            wireDigest: wireDigest(m.wire),
          },
          {
            ...(publicRead
              ? { idempotentResend: true as const, maxAttempts: PUBLIC_MAX_ATTEMPTS }
              : {}),
            send: async (): Promise<ProviderSendResult> => {
              const r = await this.#post(peer, m.wire);
              if (r.kind === "refused") return { outcome: "rejected", detail: r.detail };
              if (r.kind === "unknown") throw new Error(r.detail);
              // Retain BEFORE the send counts as done: a crash from here on loses nothing.
              this.#spool.put({
                request: m.id,
                toActor: m.toActor,
                receivedAt: new Date().toISOString(),
                bytes: r.bytes,
                wires: r.outbound as z.infer<typeof signedWire>[],
              });
              return { outcome: "accepted", providerRef: `public-http:${r.status}` };
            },
          },
        );
      } catch (error) {
        result = { status: "uncertain", detail: (error as Error).message.slice(0, 200) };
      }
      const retained = this.#spool.list().find((r) => r.request === m.id);
      if ((result.status === "sent" || result.status === "duplicate") && retained) {
        rt.recordBindingEvent({
          type: "public-reply-received",
          binding: PUBLIC_BINDING,
          request: m.id,
          bytes: retained.bytes,
          responses: retained.wires.length,
          note: "transport completion: the reply is retained durably; not yet validated",
        });
        this.fault?.("after-receipt");
        envFault("after-receipt");
        delivered.push({ kind: m.kind, ...(await this.#process(retained)) });
      } else if (result.status === "sent" || result.status === "duplicate") {
        failed.push({
          id: m.id,
          kind: m.kind,
          toActor: m.toActor,
          status: "reply-not-retained",
          detail:
            "the send is recorded but no reply was retained (pre-spool record); not re-sent — start a new request round",
        });
      } else {
        const detail = "detail" in result ? result.detail : "";
        failed.push({
          id: m.id,
          kind: m.kind,
          toActor: m.toActor,
          status: result.status,
          ...(result.status === "refused" ? { reason: result.reason } : {}),
          detail,
        });
        this.log(`public: ${m.id} to ${m.toActor}: ${result.status} (${detail})`);
      }
    }
    return { delivered, failed, binding: PUBLIC_BINDING };
  }

  async #post(
    peer: PublicPeer,
    wire: WireMessage,
  ): Promise<
    | { kind: "ok"; status: number; bytes: number; outbound: WireMessage[] }
    | { kind: "refused"; detail: string }
    | { kind: "unknown"; detail: string }
  > {
    const target = publicEndpoint(peer.url);
    const body = JSON.stringify({ wire });
    let res: Response;
    try {
      res = await this.fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(this.deadlineMs),
      });
    } catch (error) {
      const code = ((error as { cause?: { code?: unknown } }).cause?.code ?? "") as string;
      if (code === "ECONNREFUSED")
        return { kind: "refused", detail: "connection refused: not sent" };
      return { kind: "unknown", detail: `no reply: ${(error as Error).message.slice(0, 160)}` };
    }
    const text = await readBounded(res);
    if (text === undefined) return { kind: "unknown", detail: "response too large" };
    if ([400, 403, 404, 411, 413, 421, 503].includes(res.status))
      return { kind: "refused", detail: `service refused before processing (HTTP ${res.status})` };
    if (res.status !== 200) return { kind: "unknown", detail: `HTTP ${res.status}` };
    try {
      const parsed = responseSchema.parse(JSON.parse(text));
      return {
        kind: "ok",
        status: res.status,
        bytes: Buffer.byteLength(text),
        outbound: parsed.outbound as WireMessage[],
      };
    } catch {
      return { kind: "unknown", detail: "malformed public response" };
    }
  }
}

async function readBounded(res: Response): Promise<string | undefined> {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PUBLIC_RESPONSE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Outbound messages this agent still owes to pinned public services (for status). */
export function pendingPublic(host: AgentHost, peers: readonly PublicPeer[]): OutboundMessage[] {
  const actors = new Set(peers.map((p) => p.actor));
  return host.undelivered().filter((m) => m.toActor && actors.has(m.toActor));
}
