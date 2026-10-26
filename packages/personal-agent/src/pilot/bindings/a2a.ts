/**
 * OPTIONAL LOCAL A2A BINDING (`a2a-data-part/0.2`) over the A2A Protocol v1.0 JSON-RPC binding,
 * using the official SDK `@a2a-js/sdk` (a2aproject/a2a-js, Apache-2.0; see A2A_SDK).
 *
 * What it is: a CARRIER for this profile's signed envelopes. One A2A `SendMessage` carries one
 * signed envelope in a single structured-data part (media type A2A_ENVELOPE_MEDIA_TYPE); the
 * receiving agent answers with one A2A Message carrying a TRANSPORT ACKNOWLEDGEMENT (the local
 * runtime's disposition). No A2A Task is created. A2A message/context ids are transport ids
 * only: the replay key is the signed envelope's own message id, and the conversation is the one
 * named inside the signed envelope. An A2A response — even "accepted" — is not an agreement,
 * permission or settlement; those exist only as signed profile statements.
 *
 * Local-only boundaries:
 *  - listeners bind to 127.0.0.1 or ::1 only; the Host header must name that literal address
 *    (DNS-rebinding guard) and browser-originated requests (an `Origin` header) are refused;
 *  - peers are EXPLICITLY PINNED (`a2a-peers.json`: actor → loopback URL + access token) for an
 *    actor whose keys are already pinned in the trust store; there is no discovery, the client
 *    is built from a locally constructed card (no card fetch), requests go only to the pinned
 *    URL, redirects are refused;
 *  - the bearer token is a narrow LOCAL API-ACCESS mechanism for the listener. It is NOT the
 *    principal's authority and never substitutes for the signed envelope: every carried
 *    message is verified by the runtime exactly as for direct/email/MCP delivery;
 *  - bounded request bodies, response bodies and deadlines; only `SendMessage` is served;
 *  - SENDING is a consequential act decided at the moment of sending: `A2aDispatcher` passes
 *    every attempt through `AgentRuntime.transmit` (current mandate, revocations, approvals and
 *    policy module; durable intent/outcome records; identical, re-authorised resends only).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { AgentCard, type Message, type Part, Role } from "@a2a-js/sdk";
import {
  ClientFactory,
  JsonRpcTransportFactory,
  ServiceParameters,
  withA2AExtensions,
} from "@a2a-js/sdk/client";
import {
  AgentEvent,
  type AgentExecutor,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler } from "@a2a-js/sdk/server/express";
import express, { type NextFunction, type Request, type Response as Res } from "express";
import { z } from "zod";
import { type AgentHost, HostRefusal, type Json, MAX_INBOUND_BYTES } from "../host.js";
import type { TrustStoreData } from "../mechanisms/trust.js";
import { AWP, PILOT_PROFILE_VERSION } from "../profile/vocabulary.js";
import type { OutboundMessage } from "../runtime/agent.js";
import {
  type ProviderSendResult,
  type TransmitResult,
  wireDigest,
} from "../runtime/transmission.js";

/**
 * 0.2: every send goes through the runtime transmission boundary; acknowledgements are
 * validated strictly (closed vocabulary incl. `indeterminate`, deterministic ack id, exact
 * fields, matching ids). 0.1 accepted any string disposition.
 */
export const A2A_BINDING = "a2a-data-part/0.2";
/** The SDK and protocol this binding was built and tested against. */
export const A2A_SDK = { package: "@a2a-js/sdk", version: "1.2.1", protocolVersion: "1.0" };
export const A2A_ENVELOPE_MEDIA_TYPE = "application/vnd.awp.envelope+json";
export const A2A_ACK_MEDIA_TYPE = "application/vnd.awp.transport-ack+json";
export const A2A_EXTENSION_URI = `${AWP}a2a-envelope-carriage-0.1`;
export const A2A_CONFIG_FILE = "a2a.json";
export const A2A_PEERS_FILE = "a2a-peers.json";
export const A2A_JSONRPC_PATH = "/a2a/jsonrpc";
export const A2A_CARD_PATH = "/.well-known/agent-card.json";
/** Largest HTTP request body (one JSON-RPC request carrying one bounded envelope). */
export const MAX_A2A_BODY_BYTES = MAX_INBOUND_BYTES + 64 * 1024;
/** Largest HTTP response body the client reads (a transport acknowledgement). */
export const MAX_A2A_RESPONSE_BYTES = 64 * 1024;
/** Deadline for one outbound A2A request (connect + response). */
export const A2A_DEADLINE_MS = 10_000;
const TRANSPORT_ACK_NOTICE =
  "transport acknowledgement only: not an agreement, permission, approval or settlement";

const LOOPBACK = ["127.0.0.1", "::1"] as const;
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "a 256-bit base64url token");

const configSchema = z.strictObject({
  version: z.literal(1),
  host: z.enum(LOOPBACK),
  port: z.number().int().min(1024).max(65535),
  token,
});
export type A2aConfig = z.infer<typeof configSchema>;

const peerSchema = z.strictObject({ actor: z.string().min(8).max(512), url: z.string(), token });
const peersSchema = z.strictObject({
  version: z.literal(1),
  peers: z.array(peerSchema).max(32),
});
export type A2aPeer = z.infer<typeof peerSchema>;

const connectionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("awp-a2a-connection"),
  actor: z.string().min(8).max(512),
  url: z.string(),
  token,
  protocolVersion: z.literal("1.0"),
  binding: z.literal(A2A_BINDING),
  note: z.string().max(500).optional(),
});
export type A2aConnection = z.infer<typeof connectionSchema>;

function writePrivateJson(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

function hostLiteral(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Parse a PINNED peer endpoint: `http://127.0.0.1:PORT/a2a/jsonrpc` or `http://[::1]:PORT/…`
 * only — no names (no DNS), no credentials, query or fragment, no other path.
 */
export function loopbackEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("A2A endpoint is not a URL");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:") throw new Error("A2A endpoint must be http on loopback");
  if (!(LOOPBACK as readonly string[]).includes(host))
    throw new Error("A2A endpoint must be the literal loopback address 127.0.0.1 or [::1]");
  if (!url.port) throw new Error("A2A endpoint needs an explicit port");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("A2A endpoint must not carry credentials, a query or a fragment");
  if (url.pathname !== A2A_JSONRPC_PATH)
    throw new Error(`A2A endpoint path must be ${A2A_JSONRPC_PATH}`);
  return url;
}

// ------------------------------------------------------------------ local configuration

export function readA2aConfig(dir: string): A2aConfig | undefined {
  const path = join(dir, A2A_CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Configure this agent's loopback listener; the access token is kept unless `rotate`. */
export function configureA2a(
  dir: string,
  input: { host?: string; port: number; rotate?: boolean },
): A2aConfig {
  const previous = readA2aConfig(dir);
  const config = configSchema.parse({
    version: 1,
    host: input.host ?? "127.0.0.1",
    port: input.port,
    token: previous && !input.rotate ? previous.token : randomBytes(32).toString("base64url"),
  });
  writePrivateJson(join(dir, A2A_CONFIG_FILE), config);
  return config;
}

export function endpointOf(config: A2aConfig): string {
  return `http://${hostLiteral(config.host)}:${config.port}${A2A_JSONRPC_PATH}`;
}

/** The connection details a PEER's operator pins (exchanged out of band, like a card). */
export function connectionCard(config: A2aConfig, actor: string): A2aConnection {
  return {
    version: 1,
    kind: "awp-a2a-connection",
    actor,
    url: endpointOf(config),
    token: config.token,
    protocolVersion: "1.0",
    binding: A2A_BINDING,
    note: "local API access for this listener only; the token is not authority — every envelope is verified",
  };
}

export function readA2aPeers(dir: string): A2aPeer[] {
  const path = join(dir, A2A_PEERS_FILE);
  if (!existsSync(path)) return [];
  const peers = peersSchema.parse(JSON.parse(readFileSync(path, "utf8"))).peers;
  for (const p of peers) loopbackEndpoint(p.url);
  return peers;
}

/** Pin a peer's A2A endpoint. The actor's keys must already be pinned (trust is unchanged). */
export function pinA2aPeer(dir: string, trust: TrustStoreData, raw: unknown): A2aPeer {
  const c = connectionSchema.parse(raw);
  loopbackEndpoint(c.url);
  if (!trust.keys.some((k) => k.role === "actor" && k.subject === c.actor && k.party))
    throw new Error("pin the peer's card (keys) first; an A2A endpoint never establishes trust");
  const peer = { actor: c.actor, url: c.url, token: c.token };
  const peers = readA2aPeers(dir).filter((p) => p.actor !== c.actor);
  writePrivateJson(join(dir, A2A_PEERS_FILE), { version: 1, peers: [...peers, peer] });
  return peer;
}

// ------------------------------------------------------------------ Agent Card

/** An accurate local Agent Card: public identity and behaviour only (no keys, no paths). */
export function localAgentCard(host: AgentHost, url: string): AgentCard {
  const id = host.agent.rt.identity;
  return {
    name: `awp-pilot ${host.agent.role} agent (synthetic)`,
    description:
      "Local synthetic pilot agent. Accepts exactly one signed awp envelope per SendMessage in a data part " +
      `(${A2A_ENVELOPE_MEDIA_TYPE}) and replies with a transport acknowledgement (${A2A_ACK_MEDIA_TYPE}). ` +
      "Authority comes only from the verified signed envelope, never from this card, the A2A connection or its token. " +
      "No A2A tasks are created; an acknowledgement is not an agreement, permission or settlement.",
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" }],
    provider: undefined,
    version: PILOT_PROFILE_VERSION,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: A2A_EXTENSION_URI,
          description:
            "Carriage of awp signed envelopes (pilot profile) in one A2A data part; see the profile's A2A binding section.",
          required: true,
          params: {
            binding: A2A_BINDING,
            profileVersion: PILOT_PROFILE_VERSION,
            actor: id.actor,
            ...(id.party ? { party: id.party } : {}),
            envelopeMediaType: A2A_ENVELOPE_MEDIA_TYPE,
            ackMediaType: A2A_ACK_MEDIA_TYPE,
            maxEnvelopeBytes: MAX_INBOUND_BYTES,
          },
        },
      ],
    },
    securitySchemes: {
      localBearer: {
        scheme: {
          // biome-ignore lint/style/useNamingConvention: the A2A SDK's oneof discriminator
          $case: "httpAuthSecurityScheme",
          value: {
            description:
              "Local API access token exchanged out of band with the pinned peer's operator. Not the principal's authority.",
            scheme: "Bearer",
            bearerFormat: "opaque 256-bit",
          },
        },
      },
    },
    securityRequirements: [{ schemes: { localBearer: { list: [] } } }],
    defaultInputModes: [A2A_ENVELOPE_MEDIA_TYPE],
    defaultOutputModes: [A2A_ACK_MEDIA_TYPE],
    skills: [
      {
        id: "awp-envelope-delivery",
        name: "Deliver one signed awp envelope",
        description:
          "The runtime verifies signature, pinned keys, representation, policy, audience and replay before any effect.",
        tags: ["awp", "signed-envelope", "synthetic"],
        examples: [],
        inputModes: [A2A_ENVELOPE_MEDIA_TYPE],
        outputModes: [A2A_ACK_MEDIA_TYPE],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };
}

// ------------------------------------------------------------------ server

function dataPart(value: Json, mediaType: string): Part {
  return {
    // biome-ignore lint/style/useNamingConvention: the A2A SDK's oneof discriminator
    content: { $case: "data", value },
    mediaType,
    filename: "",
    metadata: undefined,
  };
}

/** The receiving side: extracts the envelope and hands it to the host's peer delivery. */
class EnvelopeCarrier implements AgentExecutor {
  constructor(
    private readonly host: AgentHost,
    private readonly log: (line: string) => void,
  ) {}

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const msg = ctx.userMessage;
    const reply = (body: Json) => {
      bus.publish(
        AgentEvent.message({
          messageId: ackMessageIdFor(msg.messageId),
          contextId: ctx.contextId,
          taskId: "",
          role: Role.ROLE_AGENT,
          parts: [
            dataPart(
              { transportMessageId: msg.messageId, ...body, notice: TRANSPORT_ACK_NOTICE },
              A2A_ACK_MEDIA_TYPE,
            ),
          ],
          metadata: undefined,
          extensions: [A2A_EXTENSION_URI],
          referenceTaskIds: [],
        }),
      );
      bus.finished();
    };
    const refuse = (reason: string) => reply({ disposition: "transport-refused", reason });
    // The SDK assigns every new request a server task id; a follow-up on an EXISTING task or a
    // reference to tasks is what this binding refuses (it never creates tasks).
    if (ctx.task || msg.referenceTaskIds.length > 0)
      return refuse("this binding does not use A2A tasks");
    const part = msg.parts[0];
    if (
      msg.parts.length !== 1 ||
      part?.content?.$case !== "data" ||
      part.mediaType !== A2A_ENVELOPE_MEDIA_TYPE
    )
      return refuse(`expected exactly one data part with media type ${A2A_ENVELOPE_MEDIA_TYPE}`);
    let data: string;
    try {
      data = JSON.stringify(part.content.value);
    } catch {
      return refuse("envelope is not JSON");
    }
    try {
      const report = await this.host.call(async () => {
        const r = await this.host.deliver({ format: "envelope", data, carrier: A2A_BINDING });
        if (r.step?.messageId)
          this.host.agent.rt.recordBindingEvent({
            type: "channel-observation",
            binding: A2A_BINDING,
            message: r.step.messageId,
            a2aMessageId: msg.messageId.slice(0, 128),
            note: "A2A transport id only; the replay key and authority come from the verified statement",
          });
        return r;
      });
      const step = report.step;
      return reply({
        disposition: step?.disposition ?? "rejected",
        ...(step?.reason
          ? { reason: step.reason }
          : report.input?.bindingOutcome && report.input.bindingOutcome !== "ok"
            ? { reason: report.input.bindingOutcome }
            : {}),
        ...(step?.messageId ? { messageId: step.messageId } : {}),
      });
    } catch (error) {
      const detail = (error as Error).message.slice(0, 200);
      // Admission refusals (busy, shutting down) happen before the runtime saw the message;
      // any other failure happened DURING processing, so its outcome is unknown.
      if (error instanceof HostRefusal) {
        this.log(`a2a delivery refused: ${detail}`);
        return refuse(detail);
      }
      this.log(`a2a delivery failed during processing: ${detail}`);
      return reply({ disposition: "indeterminate", reason: detail });
    }
  }

  async cancelTask(): Promise<void> {
    // No tasks are created by this binding.
  }
}

export interface A2aListener {
  readonly url: string;
  readonly cardUrl: string;
  close(): Promise<void>;
}

/** Start the loopback A2A listener for this host's agent. */
export async function startA2aServer(
  host: AgentHost,
  config: A2aConfig,
  log: (line: string) => void,
  options: {
    /** Observes EVERY request before any check or parsing (evidence/tests: what arrived). */
    onRequest?: (request: { method: string; path: string; bytes: number }) => void;
  } = {},
): Promise<A2aListener> {
  const cfg = configSchema.parse(config);
  const authority = `${hostLiteral(cfg.host)}:${cfg.port}`;
  const url = `http://${authority}${A2A_JSONRPC_PATH}`;
  const card = localAgentCard(host, url);
  const expected = Buffer.from(`Bearer ${cfg.token}`);
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    new EnvelopeCarrier(host, log),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { validateInputModes: true },
  );
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  // Loopback-only guards, before anything is parsed.
  app.use((req: Request, res: Res, next: NextFunction) => {
    options.onRequest?.({
      method: req.method,
      path: req.path,
      // Declared body size (the request is not read here); 0 when absent.
      bytes: Number.parseInt(req.headers["content-length"] ?? "0", 10) || 0,
    });
    if (req.headers.host !== authority) {
      res.status(421).json({ error: "unexpected Host (loopback literal required)" });
      return;
    }
    if (req.headers.origin !== undefined) {
      res.status(403).json({ error: "browser-originated requests are refused" });
      return;
    }
    next();
  });
  app.use(
    A2A_CARD_PATH,
    agentCardHandler({
      agentCardProvider: async () => AgentCard.toJSON(card) as unknown as AgentCard,
      cache: { maxAge: 0 },
    }),
  );
  app.use(
    A2A_JSONRPC_PATH,
    (req: Request, res: Res, next: NextFunction) => {
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST only" });
        return;
      }
      const given = Buffer.from(req.headers.authorization ?? "");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="awp-pilot-local"');
        res.status(401).json({ error: "local API access token required" });
        return;
      }
      const length = Number(req.headers["content-length"]);
      if (!Number.isFinite(length)) {
        res.status(411).json({ error: "Content-Length required" });
        return;
      }
      if (length > MAX_A2A_BODY_BYTES) {
        res.status(413).json({ error: `request exceeds ${MAX_A2A_BODY_BYTES} bytes` });
        return;
      }
      next();
    },
    express.json({ limit: MAX_A2A_BODY_BYTES, type: "application/json" }),
    (req: Request, res: Res, next: NextFunction) => {
      const method = (req.body as { method?: unknown } | undefined)?.method;
      if (method !== "SendMessage") {
        res.status(200).json({
          jsonrpc: "2.0",
          id: (req.body as { id?: unknown } | undefined)?.id ?? null,
          error: { code: -32601, message: "only SendMessage is served by this binding" },
        });
        return;
      }
      next();
    },
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: async () => ({ isAuthenticated: true, userName: "pinned-local-peer" }),
    }),
  );
  app.use((_req: Request, res: Res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use((error: Error & { status?: number }, _req: Request, res: Res, _n: NextFunction) => {
    res.status(error.status && error.status < 500 ? error.status : 400).json({
      error: error.status === 413 ? "request too large" : "bad request",
    });
  });
  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(cfg.port, cfg.host, (error?: Error) =>
      error ? reject(error) : resolve(s),
    );
    s.once("error", reject);
  });
  server.requestTimeout = A2A_DEADLINE_MS * 3;
  server.headersTimeout = A2A_DEADLINE_MS;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  log(`a2a: listening on ${url} (loopback only; card at ${A2A_CARD_PATH})`);
  return {
    url,
    cardUrl: `http://${authority}${A2A_CARD_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// ------------------------------------------------------------------ client (dispatch)

/** What the client observed at the HTTP layer during one request (for outcome classification). */
export interface FetchObservation {
  /** The TCP connection was refused: no byte of the request left this process. */
  connectRefused?: boolean;
  /** HTTP status of the response, if one arrived. */
  status?: number;
}

/**
 * `fetch` restricted to ONE pinned loopback endpoint: adds the pinned access token, refuses
 * redirects, applies the deadline and reads at most MAX_A2A_RESPONSE_BYTES of the response.
 * `base` is the underlying fetch (tests inject faults there); `obs` receives observations.
 */
export function pinnedFetch(
  peer: A2aPeer,
  deadlineMs = A2A_DEADLINE_MS,
  obs: FetchObservation = {},
  base: typeof fetch = fetch,
): typeof fetch {
  const target = loopbackEndpoint(peer.url);
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href).href !== target.href)
      throw new Error("A2A request target is not the pinned peer endpoint");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${peer.token}`);
    const timeout = AbortSignal.timeout(deadlineMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await base(target, { ...init, headers, redirect: "error", signal });
    } catch (error) {
      const code = ((error as { cause?: { code?: unknown } }).cause?.code ?? "") as string;
      if (code === "ECONNREFUSED") obs.connectRefused = true;
      throw error;
    }
    obs.status = res.status;
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_A2A_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`A2A response exceeds ${MAX_A2A_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
    return new Response(Buffer.concat(chunks), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

/** A client-side card built ONLY from the pinned configuration (never fetched). */
function pinnedCard(peer: A2aPeer): AgentCard {
  return {
    name: `pinned peer ${peer.actor}`,
    description: "locally pinned A2A endpoint (not discovered)",
    supportedInterfaces: [
      { url: peer.url, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" },
    ],
    provider: undefined,
    version: "",
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: [A2A_ENVELOPE_MEDIA_TYPE],
    defaultOutputModes: [A2A_ACK_MEDIA_TYPE],
    skills: [],
    signatures: [],
  };
}

/** A deterministic A2A transport id for one signed message (retries reuse it). */
export function a2aMessageIdFor(awpMessageId: string): string {
  return `awp-${createHash("sha256").update(awpMessageId).digest("hex").slice(0, 32)}`;
}

/** The acknowledgement id a receiver MUST use for one A2A message (deterministic). */
export function ackMessageIdFor(a2aMessageId: string): string {
  return `ack-${createHash("sha256").update(a2aMessageId).digest("hex").slice(0, 32)}`;
}

/**
 * The closed acknowledgement vocabulary. Business-level (the receiver's RUNTIME processed the
 * signed message; this is a transport receipt, the disposition is the runtime's):
 * `accepted`, `duplicate`, `rejected`, `pending-approval`. Transport-level: `transport-refused`
 * (the listener did not hand it to the runtime — busy, shutting down, malformed carriage) and
 * `indeterminate` (processing failed part-way; the outcome is unknown).
 */
export const ACK_DISPOSITIONS = [
  "accepted",
  "duplicate",
  "rejected",
  "pending-approval",
  "transport-refused",
  "indeterminate",
] as const;
export type AckDisposition = (typeof ACK_DISPOSITIONS)[number];
const PROCESSED: ReadonlySet<string> = new Set([
  "accepted",
  "duplicate",
  "rejected",
  "pending-approval",
]);
/** Dispositions that name the processed message and so must carry its id. */
const NAMES_MESSAGE: ReadonlySet<string> = new Set(["accepted", "duplicate", "pending-approval"]);

export interface TransportAck {
  readonly disposition: AckDisposition;
  readonly reason?: string;
  readonly messageId?: string;
  readonly transportMessageId: string;
  readonly ackMessageId: string;
}

/**
 * What one send attempt established:
 *  - `processed`: a valid acknowledgement for THIS message says the peer runtime processed it
 *    (transport receipt; the business disposition is in `ack`);
 *  - `refused`: definitively NOT handed to the peer runtime (connection refused, the listener's
 *    HTTP refusal before parsing, or an explicit `transport-refused` acknowledgement);
 *  - `unknown`: anything else — timeout, lost or malformed reply, wrong/missing ids, unknown
 *    disposition, extra parts, a task, `indeterminate`. The request may have been processed.
 */
export type SendOutcome =
  | { readonly kind: "processed"; readonly ack: TransportAck }
  | { readonly kind: "refused"; readonly detail: string }
  | { readonly kind: "unknown"; readonly detail: string };

/** HTTP statuses our listener returns BEFORE parsing the body (nothing reached the runtime). */
const PRE_PROCESSING_REFUSALS: ReadonlySet<number> = new Set([401, 403, 405, 411, 413, 421]);

/**
 * Strictly validate a reply as THE acknowledgement for one A2A message: an agent Message (not
 * a Task) with the deterministic ack id, exactly one data part of the ack media type, exactly
 * the known fields, the matching transport id, a known disposition, and — where the
 * disposition names the processed message — the matching signed-message id.
 */
export function validateAck(
  result: unknown,
  expected: { a2aMessageId: string; awpMessageId: string },
): { ok: true; ack: TransportAck } | { ok: false; detail: string } {
  const bad = (detail: string) => ({ ok: false as const, detail });
  if (!result || typeof result !== "object") return bad("reply is not an object");
  const r = result as Partial<Message> & { status?: unknown; history?: unknown };
  if ("status" in r || "history" in r || "artifacts" in r)
    return bad("peer answered with an A2A task; this binding expects a message acknowledgement");
  if (r.role !== Role.ROLE_AGENT) return bad("reply is not an agent message");
  const ackId = ackMessageIdFor(expected.a2aMessageId);
  if (r.messageId !== ackId) return bad("acknowledgement id does not correspond to this message");
  if (!Array.isArray(r.parts) || r.parts.length !== 1)
    return bad("acknowledgement must have exactly one part");
  const part = r.parts[0];
  if (part?.content?.$case !== "data" || part.mediaType !== A2A_ACK_MEDIA_TYPE)
    return bad(`acknowledgement part must be data of ${A2A_ACK_MEDIA_TYPE}`);
  const v = part.content.value as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v))
    return bad("acknowledgement is not an object");
  const fields = v as Record<string, unknown>;
  const allowed = new Set(["transportMessageId", "disposition", "reason", "messageId", "notice"]);
  const extra = Object.keys(fields).filter((k) => !allowed.has(k));
  if (extra.length > 0) return bad(`acknowledgement has unknown fields: ${extra.join(", ")}`);
  if (fields.transportMessageId !== expected.a2aMessageId)
    return bad("acknowledgement transport id does not match this message");
  if (
    typeof fields.disposition !== "string" ||
    !(ACK_DISPOSITIONS as readonly string[]).includes(fields.disposition)
  )
    return bad("unknown acknowledgement disposition");
  if (
    fields.reason !== undefined &&
    (typeof fields.reason !== "string" || fields.reason.length > 300)
  )
    return bad("malformed acknowledgement reason");
  if (fields.notice !== undefined && typeof fields.notice !== "string")
    return bad("malformed acknowledgement notice");
  if (fields.messageId !== undefined && fields.messageId !== expected.awpMessageId)
    return bad("acknowledgement names a different signed message");
  if (NAMES_MESSAGE.has(fields.disposition) && fields.messageId !== expected.awpMessageId)
    return bad("acknowledgement does not name the signed message it acknowledges");
  return {
    ok: true,
    ack: {
      disposition: fields.disposition as AckDisposition,
      ...(typeof fields.reason === "string" ? { reason: fields.reason } : {}),
      ...(typeof fields.messageId === "string" ? { messageId: fields.messageId } : {}),
      transportMessageId: expected.a2aMessageId,
      ackMessageId: ackId,
    },
  };
}

/**
 * Send ONE signed envelope to ONE pinned peer and classify what that established. Never
 * throws for transport problems. This is the raw carrier: agents send only through
 * `A2aDispatcher`, which puts every attempt behind the runtime's transmission boundary.
 */
export async function sendEnvelope(
  peer: A2aPeer,
  out: Pick<OutboundMessage, "id" | "wire">,
  options: { deadlineMs?: number; fetch?: typeof fetch } = {},
): Promise<SendOutcome> {
  const deadlineMs = options.deadlineMs ?? A2A_DEADLINE_MS;
  const obs: FetchObservation = {};
  const factory = new ClientFactory({
    transports: [
      new JsonRpcTransportFactory({ fetchImpl: pinnedFetch(peer, deadlineMs, obs, options.fetch) }),
    ],
  });
  const client = await factory.createFromAgentCard(pinnedCard(peer));
  const message: Message = {
    messageId: a2aMessageIdFor(out.id),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [dataPart(out.wire as unknown as Json, A2A_ENVELOPE_MEDIA_TYPE)],
    metadata: undefined,
    extensions: [A2A_EXTENSION_URI],
    referenceTaskIds: [],
  };
  let result: unknown;
  try {
    result = await client.sendMessage(
      {
        tenant: "",
        message,
        configuration: {
          acceptedOutputModes: [A2A_ACK_MEDIA_TYPE],
          taskPushNotificationConfig: undefined,
          returnImmediately: false,
        },
        metadata: undefined,
      },
      {
        signal: AbortSignal.timeout(deadlineMs),
        // The receiver REQUIRES the carriage extension; the client declares it (A2A-Extensions).
        serviceParameters: ServiceParameters.create(withA2AExtensions(A2A_EXTENSION_URI)),
      },
    );
  } catch (error) {
    const detail = (error as Error).message.slice(0, 200);
    if (obs.connectRefused)
      return { kind: "refused", detail: "connection refused: the request was not sent" };
    if (obs.status !== undefined && PRE_PROCESSING_REFUSALS.has(obs.status))
      return {
        kind: "refused",
        detail: `the peer listener refused the request before processing (HTTP ${obs.status})`,
      };
    // A timeout or lost reply is NOT evidence that the peer did not process the message.
    return { kind: "unknown", detail: `no valid reply: ${detail}` };
  }
  const checked = validateAck(result, { a2aMessageId: message.messageId, awpMessageId: out.id });
  if (!checked.ok) return { kind: "unknown", detail: checked.detail };
  const ack = checked.ack;
  if (ack.disposition === "transport-refused")
    return {
      kind: "refused",
      detail: `the peer listener did not hand it to its runtime: ${ack.reason ?? "refused"}`,
    };
  if (!PROCESSED.has(ack.disposition))
    return { kind: "unknown", detail: `peer processing outcome unknown: ${ack.reason ?? ""}` };
  return { kind: "processed", ack };
}

/** Attempt bound per message for A2A (resends are idempotent at the receiver). */
export const A2A_MAX_ATTEMPTS = 20;

/**
 * Hands this agent's undelivered outbound messages to PINNED A2A peers — every attempt through
 * the runtime's transmission boundary (`AgentRuntime.transmit`): authentic outbox entry,
 * unexpired, the emission's action RE-AUTHORISED now (mandate, revocations, owner approvals,
 * the pinned policy module), a durable `attempting` record written before any byte leaves,
 * and the outcome recorded against the envelope id, the A2A message id and the peer's
 * acknowledgement id. A refusal means no request is made at all.
 *
 * Outcomes: `processed` → `sent` (transport receipt; the peer runtime's disposition is logged
 * separately — a business-level `rejected` is still delivered); `refused` → `not-sent`;
 * `unknown` → `uncertain`. An uncertain message is retried only by an IDENTICAL resend (the
 * receiver deduplicates by signed message id), re-authorised each time, never while a request
 * of this process is pending, and a refused resend leaves it uncertain.
 *
 * No lock is held across network I/O (neither the host's nor the runtime's), so two agents
 * sending to each other at once cannot deadlock. Order is kept per conversation: a message
 * that is not sent stops the later messages of its conversation until the next dispatch.
 */
export class A2aDispatcher {
  #running: Promise<Json> | undefined;
  #again = false;

  constructor(
    private readonly host: AgentHost,
    private readonly peers: readonly A2aPeer[],
    private readonly log: (line: string) => void,
    private readonly deadlineMs = A2A_DEADLINE_MS,
    /** Underlying fetch (fault injection in tests only). */
    private readonly baseFetch: typeof fetch = fetch,
  ) {
    for (const p of peers) loopbackEndpoint(p.url);
  }

  get pinned(): readonly { actor: string; url: string }[] {
    return this.peers.map((p) => ({ actor: p.actor, url: p.url }));
  }

  /** Coalescing background trigger (auto-dispatch); never runs inside the serial lock. */
  kick(): void {
    if (this.#running) {
      this.#again = true;
      return;
    }
    setImmediate(() => {
      this.dispatch().catch((error: Error) => this.log(`a2a dispatch: ${error.message}`));
    });
  }

  /** Resolves once no dispatch is running (used at shutdown; later kicks are not started). */
  async idle(): Promise<void> {
    this.#again = false;
    while (this.#running) await this.#running.catch(() => undefined);
  }

  /** Dispatch now (or join the running dispatch). */
  dispatch(toActor?: string): Promise<Json> {
    if (this.#running) return this.#running;
    const run = this.#dispatchOnce(toActor).finally(() => {
      this.#running = undefined;
      if (this.#again) {
        this.#again = false;
        this.kick();
      }
    });
    this.#running = run;
    return run;
  }

  async #dispatchOnce(toActor?: string): Promise<Json> {
    const byActor = new Map(this.peers.map((p) => [p.actor, p]));
    const queue = await this.host.call(async () =>
      this.host
        .undelivered(toActor)
        .filter((m) => m.toActor && byActor.has(m.toActor))
        .map((m) => ({
          id: m.id,
          wire: m.wire,
          toActor: m.toActor as string,
          kind: m.kind,
          conversation: m.conversation,
        })),
    );
    const rt = this.host.agent.rt;
    const delivered: Json[] = [];
    const failed: Json[] = [];
    const held = new Set<string>();
    for (const m of queue) {
      if (held.has(m.conversation)) {
        failed.push({ id: m.id, kind: m.kind, toActor: m.toActor, status: "held" });
        continue;
      }
      const peer = byActor.get(m.toActor) as A2aPeer;
      const a2aMessageId = a2aMessageIdFor(m.id);
      let outcome: SendOutcome | undefined;
      let result: TransmitResult;
      try {
        result = await rt.transmit(
          {
            messageId: m.id,
            binding: A2A_BINDING,
            externalId: a2aMessageId,
            wireDigest: wireDigest(m.wire),
          },
          {
            idempotentResend: true,
            maxAttempts: A2A_MAX_ATTEMPTS,
            send: async (): Promise<ProviderSendResult> => {
              outcome = await sendEnvelope(peer, m, {
                deadlineMs: this.deadlineMs,
                fetch: this.baseFetch,
              });
              if (outcome.kind === "processed")
                return {
                  outcome: "accepted",
                  providerRef: `${outcome.ack.ackMessageId}:${outcome.ack.disposition}`,
                };
              if (outcome.kind === "refused")
                return { outcome: "rejected", detail: outcome.detail };
              throw new Error(outcome.detail);
            },
          },
        );
      } catch (error) {
        result = { status: "uncertain", detail: (error as Error).message.slice(0, 200) };
      }
      if (result.status === "sent" || result.status === "duplicate") {
        // providerRef = "<ack message id>:<peer disposition>" (recorded with the transmission).
        const [ackMessageId, peerDisposition] = (result.providerRef ?? "").split(":");
        await this.host.call(async () => {
          await this.host.ack([m.id]);
          rt.recordBindingEvent({
            type: "binding-delivery",
            binding: A2A_BINDING,
            message: m.id,
            toActor: m.toActor,
            a2aMessageId,
            ...(ackMessageId ? { ackMessageId } : {}),
            ...(peerDisposition ? { peerDisposition } : {}),
            ...(outcome?.kind === "processed" && outcome.ack.reason
              ? { peerReason: outcome.ack.reason }
              : {}),
            note: "transport receipt from the pinned peer; the peer disposition is its runtime's, not an agreement",
          });
        });
        delivered.push({
          id: m.id,
          kind: m.kind,
          toActor: m.toActor,
          transmission: result.status,
          ...(peerDisposition ? { peerDisposition } : {}),
        });
      } else {
        held.add(m.conversation);
        const detail = "detail" in result ? result.detail : "";
        failed.push({
          id: m.id,
          kind: m.kind,
          toActor: m.toActor,
          status: result.status,
          ...(result.status === "refused" ? { reason: result.reason } : {}),
          detail,
        });
        this.log(`a2a: ${m.id} to ${m.toActor}: ${result.status} (${detail}); kept pending`);
      }
    }
    return { delivered, failed, binding: A2A_BINDING, notice: TRANSPORT_ACK_NOTICE };
  }
}
