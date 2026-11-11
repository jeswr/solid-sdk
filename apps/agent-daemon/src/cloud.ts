// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { CredentialStore } from "@jeswr/agent-credentials";
import { createServer, type IncomingMessage, type Server } from "http";
import { isAbsolute } from "path";
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
export interface CloudComposition {
  readonly daemon: Daemon;
  /** All ingest and executor binding IDs in the trusted composition. */
  readonly bindings: readonly string[];
  /** Verify peer authentication and signed envelopes before durable ingestion. Never send here. */
  readonly a2a: (request: A2aRequest) => Promise<{ status: number; body: string }>;
  close(): Promise<void>;
}
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

/** TLS terminates at ACA ingress; this server exposes only the explicit A2A receiver and probes. */
function listener(composition: CloudComposition, signal: AbortSignal) {
  const pending = new Set<Promise<void>>();
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000 }, (req, res) => {
    const respond = (status: number, body = "") => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
    };
    if (signal.aborted) return respond(503);
    if (req.method === "GET" && (req.url === "/livez" || req.url === "/readyz"))
      return respond(200, '{"ready":true}');
    if (req.url !== "/a2a") return respond(404);
    if (req.method !== "POST") return respond(405);
    if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
      return respond(415);
    const length = Number(req.headers["content-length"] ?? 0);
    if (!Number.isFinite(length) || length > MAX_BODY) return respond(413);
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!refused) respond(413);
        refused = true;
        chunks.length = 0;
      } else if (!refused) chunks.push(chunk);
    });
    req.on("error", () => {
      if (!res.writableEnded) respond(400);
    });
    req.on("end", () => {
      if (refused || signal.aborted) {
        if (!res.writableEnded) respond(503);
        return;
      }
      if (pending.size >= MAX_INFLIGHT) return respond(503);
      const task = Promise.resolve()
        .then(() => composition.a2a({ body: Buffer.concat(chunks), headers: req.headers, signal }))
        .then((result) => {
          if (
            !Number.isInteger(result.status) ||
            result.status < 200 ||
            result.status > 599 ||
            Buffer.byteLength(result.body) > MAX_BODY
          )
            return respond(500);
          respond(result.status, result.body);
        })
        .catch(() => respond(503))
        .finally(() => pending.delete(task));
      pending.add(task);
    });
  });
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = MAX_INFLIGHT;
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
    if (
      composition.bindings.some((id) => !cloudBindings.has(id)) ||
      !composition.bindings.includes("a2a") ||
      typeof composition.a2a !== "function"
    )
      throw new Error("Cloud requires A2A and cloud-capable bindings");
    if (signal.aborted) return;
    const inbound = listener(composition, controller.signal);
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
