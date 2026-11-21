// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CredentialStore } from "@jeswr/agent-credentials";
import { DOCUMENT_MEDIA_TYPE, LEGACY_MEDIA_TYPE } from "@jeswr/agent-reference/wire/carriage";
import { createServer, IncomingMessage, type Server, type ServerResponse } from "http";
import type { Socket } from "net";
import { isAbsolute } from "path";
import {
  createDirectHttpReceiver,
  createGateReceiver,
  isBuiltInA2aReceiver,
  MAX_A2A_BODY,
} from "./cloud-receivers.js";
import type { Gate } from "./gate.js";
import { createLocalState, createProcessLease } from "./local.js";
import type { Daemon } from "./types.js";

/** Explicitly cloud-capable bindings only; linked-device and process bindings stay local. */
const cloudBindings = new Set([
  "a2a",
  "direct",
  "email-mime",
  "gmail",
  "graph-mail",
  "graph-teams",
  "slack",
  "matrix",
  "github",
  "discord",
  "telegram",
  "bluesky",
  "mastodon",
  "public-http",
]);
const MAX_BODY = 64 * 1024;
const MAX_INFLIGHT = 64;
export interface CloudContext {
  readonly store: CredentialStore;
  readonly local: ReturnType<typeof createLocalState>;
  /** Pass to createDaemon. The cloud owner retains the file lease through inbound drain too. */
  readonly lease: ReturnType<typeof createProcessLease>;
  /** ACA resolves Key Vault references with the UAMI. Keys never enter the file store. */
  apiKey(provider: "anthropic" | "openai"): string;
}
export interface A2aRequest {
  readonly body: Uint8Array;
  readonly headers: IncomingMessage["headers"];
  readonly signal: AbortSignal;
}
export type CloudReceiver = (
  request: A2aRequest,
) => Promise<{ status: number; body: string; headers?: Readonly<Record<string, string>> }>;
export type CloudComposition = {
  readonly daemon: Daemon;
  /** All ingest and executor binding IDs in the trusted composition. */
  readonly bindings: readonly string[];
  close(): Promise<void>;
} & (
  | {
      /** Use the same leased gate as the daemon for both HTTP entrances. */
      readonly gate: Pick<Gate, "receiveCarriage">;
      /** Optional trusted receive-only A2A adapter, subject to the same ingress bounds. */
      readonly a2a?: CloudReceiver;
    }
  | { readonly gate?: undefined; readonly a2a: CloudReceiver }
);
export type CloudFactory = (context: CloudContext) => Promise<CloudComposition>;

function configuration(env: NodeJS.ProcessEnv) {
  const directory = env.AGENT_CREDENTIAL_DIR;
  const port = Number(env.AGENT_A2A_PORT ?? "8080");
  if (
    env.AGENT_ENVIRONMENT !== "dev" ||
    env.AGENT_A2A_ENABLED !== "true" ||
    !directory ||
    !isAbsolute(directory) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Invalid cloud configuration");
  return { directory, port };
}

class CloudRequest extends IncomingMessage {
  bodyRead?: { remaining: number; overflow: () => void };

  override push(chunk: Buffer | null): boolean {
    if (chunk === null) return super.push(null);
    const bodyRead = this.bodyRead;
    if (!bodyRead) return false;
    // Check the parser's chunk before the stream can buffer or emit it.
    if (chunk.length > bodyRead.remaining) {
      bodyRead.overflow();
      return false;
    }
    bodyRead.remaining -= chunk.length;
    return super.push(chunk);
  }
}

function readBody(
  req: CloudRequest,
  limit: number,
  refuse: (status: number) => void,
  resolve: (body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  function finish(body?: Buffer) {
    req.bodyRead = undefined;
    req.off("data", data);
    req.off("end", end);
    req.off("error", error);
    req.off("close", close);
    chunks.length = 0;
    resolve(body);
  }
  function data(chunk: Buffer) {
    chunks.push(chunk);
    size += chunk.length;
  }
  function end() {
    finish(Buffer.concat(chunks, size));
  }
  function error() {
    refuse(400);
    finish();
  }
  function close() {
    finish();
  }
  req.bodyRead = {
    remaining: limit,
    overflow: () => {
      refuse(413);
      finish();
    },
  };
  req.once("end", end);
  req.once("error", error);
  req.once("close", close);
  req.on("data", data);
}

/** TLS terminates at ACA ingress. Both receiver paths share the same bounds and drain. */
function listener(a2a: CloudReceiver, gate: CloudComposition["gate"], signal: AbortSignal) {
  const pending = new Set<Promise<void>>();
  const closing = new WeakSet<Socket>();
  function handle(req: CloudRequest, res: ServerResponse, expectContinue = false) {
    const socket = req.socket;
    if (closing.has(socket)) return;
    const respond = (status: number, body = "", headers?: Readonly<Record<string, string>>) => {
      if (res.destroyed || res.writableEnded) return;
      for (const name of ["A2A-Version", "A2A-Extensions"]) {
        const value = headers?.[name];
        if (value !== undefined) res.setHeader(name, value);
      }
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
    };
    const refuse = (status: number) => {
      if (res.destroyed || res.writableEnded) return;
      closing.add(socket);
      // Mark the stream handled without consuming bytes so Node won't drain it on finish.
      req.read(0);
      // HTTP can resume the socket while finishing an already-buffered pipelined request.
      socket.on("resume", () => socket.pause());
      socket.pause();
      res.setHeader("Connection", "close");
      res.prependOnceListener("finish", () => {
        req.destroy();
        socket.destroy();
      });
      respond(status);
    };
    if (
      req.headers.expect !== undefined &&
      (!expectContinue || req.headers.expect.trim().toLowerCase() !== "100-continue")
    )
      return refuse(417);
    if (signal.aborted) return refuse(503);
    if (req.method === "GET" && (req.url === "/livez" || req.url === "/readyz"))
      return respond(200, '{"ready":true}');
    const direct = req.url === "/answerable" && gate;
    if (req.url !== "/a2a" && !direct) return refuse(404);
    if (req.method !== "POST") return refuse(405);
    if (pending.size >= MAX_INFLIGHT) return refuse(503);
    const mediaType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    let receive = a2a;
    if (direct) {
      if (mediaType !== DOCUMENT_MEDIA_TYPE && mediaType !== LEGACY_MEDIA_TYPE) return refuse(415);
      receive = createDirectHttpReceiver(direct, mediaType);
    } else if (mediaType !== "application/json") return refuse(415);
    const limit = isBuiltInA2aReceiver(receive) ? MAX_A2A_BODY : MAX_BODY;
    const length = Number(req.headers["content-length"] ?? 0);
    if (!Number.isFinite(length) || length > limit) return refuse(413);
    let resolveBody!: (body?: Buffer) => void;
    const received = new Promise<Buffer | undefined>((resolve) => {
      resolveBody = resolve;
    });
    const task = received
      .then(async (body) => {
        if (body === undefined) return;
        if (signal.aborted) return refuse(503);
        let result: Awaited<ReturnType<CloudReceiver>>;
        try {
          result = await receive({ body, headers: req.headers, signal });
        } catch {
          // TR-8 acknowledges only recorded decisions, regardless of the gate outcome.
          return respond(503);
        }
        if (
          !Number.isInteger(result.status) ||
          result.status < 200 ||
          result.status > 599 ||
          Buffer.byteLength(result.body) > MAX_BODY
        )
          return respond(500);
        respond(result.status, result.body, result.headers);
      })
      .catch(() => respond(500))
      .finally(() => pending.delete(task));
    pending.add(task);
    readBody(req, limit, refuse, resolveBody);
    if (expectContinue) res.writeContinue();
  }
  const server = createServer(
    { IncomingMessage: CloudRequest, maxHeaderSize: 8192, requestTimeout: 15_000 },
    handle,
  );
  server.on("checkExpectation", handle);
  server.on("checkContinue", (req, res) => handle(req, res, true));
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  // Leave room to deliver a 503 when active uploads occupy separate connections.
  server.maxConnections = MAX_INFLIGHT + 1;
  server.maxRequestsPerSocket = 100;
  return { server, drain: () => Promise.allSettled([...pending]) };
}

/** No environment-selected code or implicit host. The trusted preload owns all authority seams. */
export async function runCloud(
  factory: CloudFactory,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = configuration(env);
  if (signal.aborted) return;
  process.umask(0o077);
  const release = await createProcessLease(config.directory).acquire();
  let active = false;
  try {
    if (signal.aborted) return;
    await cloudSession(
      factory,
      {
        store: new CredentialStore({ dir: config.directory }),
        local: createLocalState(config.directory),
        lease: {
          async acquire() {
            if (active) throw new Error("Cloud daemon already active");
            active = true;
            return async () => {
              active = false;
            };
          },
        },
        apiKey(provider) {
          const key = env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"];
          if (!key || !/^[\x21-\x7e]{8,8192}$/.test(key)) throw new Error("Model key unavailable");
          return key;
        },
      },
      config.port,
      signal,
    );
  } finally {
    await release();
  }
}

async function cloudSession(
  factory: CloudFactory,
  context: CloudContext,
  port: number,
  signal: AbortSignal,
) {
  const composition = await factory(context);
  let server: Server | undefined;
  let drain: (() => Promise<unknown>) | undefined;
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    server?.close();
    server?.closeAllConnections();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const { gate } = composition;
    const a2a = composition.a2a ?? (gate && createGateReceiver(gate));
    if (
      composition.bindings.some((id) => !cloudBindings.has(id)) ||
      !composition.bindings.includes("a2a") ||
      typeof a2a !== "function" ||
      (gate !== undefined && typeof gate?.receiveCarriage !== "function")
    )
      throw new Error("Cloud requires A2A and cloud-capable bindings");
    if (signal.aborted) return;
    const inbound = listener(a2a, gate, controller.signal);
    server = inbound.server;
    drain = inbound.drain;
    await new Promise<void>((resolve, reject) => {
      const cancelled = () => reject(new Error("Cloud startup cancelled"));
      controller.signal.addEventListener("abort", cancelled, { once: true });
      server?.once("error", reject);
      server?.listen({ port, host: "0.0.0.0", signal: controller.signal }, () => {
        controller.signal.removeEventListener("abort", cancelled);
        resolve();
      });
    });
    await composition.daemon.run(controller.signal);
  } finally {
    stop();
    signal.removeEventListener("abort", stop);
    await drain?.();
    await composition.close();
  }
}

let configured: CloudFactory | undefined;
/** Register from a trusted image-baked Node --import preload, never from the pod. */
export function configureCloud(factory: CloudFactory): void {
  if (configured) throw new Error("Cloud host already configured");
  configured = factory;
}
export async function runConfiguredCloud(signal: AbortSignal): Promise<void> {
  if (!configured) throw new Error("Cloud requires a trusted composition module");
  await runCloud(configured, signal);
}
