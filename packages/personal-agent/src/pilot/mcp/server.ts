/**
 * Local MCP interface to ONE pilot agent, over stdio (official `@modelcontextprotocol/sdk`).
 *
 * Trust boundary: the local OS user who launches the process. There is no MCP network
 * listener and no MCP-level authentication; whoever can spawn this process with access to the
 * agent directory is its operator. Two concerns are kept apart:
 *
 *  1. OPERATOR tools/resources — inspect the profile, status, policy module and evidence; run
 *     the agent ROLE's narrow declared domain operations (e.g. `propose_meeting`,
 *     `start_prequalification`, `start_underwriting`); submit an approval SIGNED WITH THE OWNER
 *     KEY outside this process; list, acknowledge and (with A2A) dispatch reviewed outbound
 *     envelopes. Everything reuses the runtime/domain/service code through `AgentHost`; there
 *     is no second state machine. NOT exposed: shell or filesystem access, private keys,
 *     trust-store edits (pinning), approval without an owner signature, mandate changes, live
 *     provider sending.
 *
 *  2. The MCP COMMUNICATION BINDING (`mcp-tool/0.1`) — `deliver_inbound` carries a peer's
 *     signed logical message (an envelope, or the email MIME binding carried over MCP) into
 *     the runtime. Being connected to this process does NOT authenticate the represented
 *     peer: integrity, pinned keys, representation, policy, audience and replay checks run
 *     unchanged in `AgentRuntime.receive`, and invalid, tampered, oversized or mismatched
 *     messages are rejected before any effect. Callers cannot choose an actor identity:
 *     outbound messages are signed only by this agent's own key, and a proposal can only be
 *     addressed to an already pinned peer, whose party comes from the trust store.
 *
 * With `a2a`, the same process also runs the optional loopback A2A listener (`bindings/a2a.ts`)
 * against the same host, and dispatches outbound envelopes to PINNED A2A peers.
 *
 * Lifecycle: this process is the single runtime owner of the agent directory (state lock).
 * Calls are serialised. stdout carries only MCP messages; diagnostics go to stderr. On stdin
 * end, SIGINT or SIGTERM: new calls are refused, the A2A listener closes, accepted calls and a
 * running dispatch finish, the runtime closes and the lock is released; durable state survives.
 */
import { fstatSync, read } from "node:fs";
import type { Writable } from "node:stream";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  A2A_BINDING,
  type A2aDispatcher,
  type A2aListener,
  endpointOf,
  readA2aConfig,
} from "../bindings/a2a.js";
import {
  AgentHost,
  type Json,
  MAX_APPROVAL_BYTES,
  MAX_EVIDENCE,
  MAX_INBOUND_BYTES,
  MAX_LIST,
  MAX_QUEUED_CALLS,
  MAX_RESULT_BYTES,
  showReport,
} from "../host.js";
import { PILOT_PROFILE_VERSION } from "../profile/vocabulary.js";
import { agentDir } from "../setup.js";

export { MAX_INBOUND_BYTES, MAX_QUEUED_CALLS, MAX_RESULT_BYTES };
export const MCP_BINDING = "mcp-tool/0.1";
/** Largest single JSON-RPC line accepted on stdin (one MCP message). */
export const MAX_MCP_LINE_BYTES = 1024 * 1024;
/** Names reserved for the generic tools (a role operation may not shadow them). */
const GENERIC_TOOLS = new Set([
  "get_profile",
  "get_status",
  "get_evidence",
  "deliver_inbound",
  "submit_approval",
  "list_outbound",
  "ack_outbound",
  "dispatch_outbound",
]);

/** Refuse (and stop reading) any stdin line longer than `max` bytes — before buffering it. */
export class BoundedLines extends Transform {
  private current = 0;
  constructor(private readonly max: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0x0a) this.current = 0;
      else if (++this.current > this.max) {
        done(new Error(`MCP message exceeds ${this.max} bytes; closing`));
        return;
      }
    }
    done(null, chunk);
  }
}

function result(value: Json): {
  content: { type: "text"; text: string }[];
  structuredContent: Json;
  isError?: boolean;
} {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES)
    return {
      content: [{ type: "text", text: `result exceeds ${MAX_RESULT_BYTES} bytes` }],
      structuredContent: { error: "result-too-large" },
      isError: true,
    };
  return { content: [{ type: "text", text }], structuredContent: value };
}

function failure(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}

export interface McpServerOptions {
  readonly root: string;
  readonly name: string;
  readonly now: () => Date;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly log?: (line: string) => void;
  /** Resolves when the process should shut down (defaults: stdin end, SIGINT, SIGTERM). */
  readonly stopSignal?: Promise<void>;
  /** Also run the loopback A2A listener (`a2a.json`) and dispatch to pinned A2A peers. */
  readonly a2a?: { readonly autoDispatch?: boolean };
  /**
   * Also run the anonymous public carriage: a loopback listener if `public-http.json` is
   * configured (a public service), and dispatch to pinned public services (`public-peers.json`).
   */
  readonly public?: { readonly autoDispatch?: boolean };
}

/**
 * A FIFO/pipe file descriptor as a Readable that reports EOF: `read(2)` returning 0 means every
 * writer has closed. A non-blocking fd answers EAGAIN while no data is available; that is
 * retried after a short delay (the only polling, and only for FIFO stdin).
 */
export class FdReader extends Readable {
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly fd: number,
    private readonly retryMs = 25,
  ) {
    super({ highWaterMark: 64 * 1024 });
  }
  override _read(size: number): void {
    const buf = Buffer.allocUnsafe(Math.min(Math.max(size, 1), 64 * 1024));
    read(this.fd, buf, 0, buf.length, null, (error, n) => {
      if (this.destroyed) return;
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EAGAIN" || code === "EWOULDBLOCK") {
          this.timer = setTimeout(() => this._read(size), this.retryMs);
          return;
        }
        this.destroy(error);
        return;
      }
      this.push(n === 0 ? null : buf.subarray(0, n));
    });
  }
  override _destroy(error: Error | null, done: (e?: Error | null) => void): void {
    clearTimeout(this.timer);
    done(error);
  }
}

/**
 * The process's stdin as a stream that reliably reports EOF. On this platform Node's pipe
 * handle for a FIFO/pipe stdin does not emit `end` when the last writer closes (reproduced on
 * macOS with Node 25: a bare `process.stdin` reader never sees EOF), so a FIFO/pipe fd 0 is
 * read with `FdReader`. Sockets (e.g. an MCP client's spawned pipes) and TTYs use
 * `process.stdin`, which reports EOF correctly.
 */
export function eofSafeStdin(fd = 0): Readable {
  try {
    if (fstatSync(fd).isFIFO()) return new FdReader(fd);
  } catch {
    // fall back to process.stdin
  }
  return process.stdin;
}

export async function runMcpServer(options: McpServerOptions): Promise<number> {
  const log =
    options.log ??
    ((line: string) => process.stderr.write(`awp-pilot mcp[${options.name}]: ${line}\n`));
  const { openAgent } = await import("../cli.js");
  const now = options.now;
  const a2aConfig = options.a2a ? readA2aConfig(agentDir(options.root, options.name)) : undefined;
  if (options.a2a && !a2aConfig)
    throw new Error("no A2A listener configured for this agent; run `awp-pilot a2a-config` first");
  const pub = options.public ? await import("../bindings/public-http.js") : undefined;
  const publicConfig = pub?.readPublicConfig(agentDir(options.root, options.name));
  // The single runtime owner of this agent directory (throws if another process holds it).
  const a = await openAgent(options.root, options.name, now, {
    extraBindings: [
      { id: MCP_BINDING },
      ...(a2aConfig ? [{ id: A2A_BINDING, endpoint: endpointOf(a2aConfig) }] : []),
      ...(pub
        ? [
            {
              id: pub.PUBLIC_BINDING,
              ...(publicConfig ? { endpoint: pub.publicUrlOf(publicConfig) } : {}),
            },
          ]
        : []),
    ],
  });
  try {
    return await serveAgent(new AgentHost(a, now), options, log);
  } finally {
    // Always release the runtime (and its lock), also when recovery or connection failed.
    a.close();
    log("stopped; state saved and lock released");
  }
}

async function serveAgent(
  host: AgentHost,
  options: McpServerOptions,
  log: (line: string) => void,
): Promise<number> {
  const a = host.agent;
  const recovered = await a.rt.recover();
  host.addInterface({
    binding: MCP_BINDING,
    transport: "stdio (local process; trust boundary = the local OS user)",
    notAuthentication:
      "connecting to this server does not authenticate any peer; every inbound message is verified by the runtime",
  });

  let listener: A2aListener | undefined;
  let dispatcher: A2aDispatcher | undefined;
  let publicListener: import("../bindings/public-http.js").PublicListener | undefined;
  let publicDispatcher: import("../bindings/public-http.js").PublicDispatcher | undefined;
  const pub = options.public ? await import("../bindings/public-http.js") : undefined;
  const publicConfig = pub?.readPublicConfig(a.dir);

  const guarded =
    <A>(fn: (args: A) => Promise<Json>) =>
    async (args: A) =>
      host
        .call(async () => result(await fn(args)))
        .catch((error: Error) => {
          log(`tool error: ${error.message}`);
          return failure(error.message.slice(0, 500));
        });

  const server = new McpServer(
    { name: "awp-pilot-agent", version: PILOT_PROFILE_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        `Local operator interface to one synthetic pilot agent (role: ${a.role}). Use get_profile/get_status/get_evidence to inspect; ` +
        "the role's operations to start synthetic domain actions with PINNED peers within the owner mandate; " +
        "submit_approval for an approval signed with the owner key outside this server (awp-pilot sign-approval); " +
        "list_outbound/ack_outbound (and dispatch_outbound with A2A) for reviewed signed envelopes; deliver_inbound to hand " +
        "this agent a peer's signed message (it is verified; connection is not authentication). Nothing is sent to any provider.",
    },
  );

  server.registerTool(
    "get_profile",
    {
      title: "Agent profile",
      description:
        "Identity, role, implementation description (configurations, bindings, selected policy module), pinned peers, role operations, local interfaces.",
      annotations: { readOnlyHint: true },
    },
    guarded(async () => host.profile()),
  );

  server.registerTool(
    "get_status",
    {
      title: "Agent status",
      description:
        "Policy-module availability, mandate status, conversations, approvals pending, effects, provider transmissions and role-specific status (payload-free).",
      annotations: { readOnlyHint: true },
    },
    guarded(async () => host.status()),
  );

  server.registerTool(
    "get_evidence",
    {
      title: "Evidence ledger",
      description:
        "Hash-chain verification of this agent's ledger and its most recent records (optionally one record type).",
      inputSchema: {
        type: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(MAX_EVIDENCE).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async (args: { type?: string; limit?: number }) => host.evidence(args)),
  );

  // The role's declared domain operations (operator-side only; never reachable by peers).
  for (const op of host.operations) {
    if (GENERIC_TOOLS.has(op.name)) throw new Error(`role operation ${op.name} shadows a tool`);
    server.registerTool(
      op.name,
      {
        title: op.title,
        description: op.description,
        ...(op.input ? { inputSchema: op.input } : {}),
        ...(op.readOnly ? { annotations: { readOnlyHint: true } } : {}),
      },
      guarded(async (args: Record<string, unknown>) => host.runOperation(op.name, args ?? {})),
    );
  }

  server.registerTool(
    "submit_approval",
    {
      title: "Submit an owner-signed approval",
      description:
        "Hand the runtime ONE approval statement (compact JWS) signed with the OWNER key outside this server " +
        "(e.g. `awp-pilot sign-approval`). The runtime verifies the owner signature and that it binds to the exact pending action.",
      inputSchema: { approval: z.string().min(16).max(MAX_APPROVAL_BYTES) },
    },
    guarded(async (args: { approval: string }) => host.submitApproval(args.approval)),
  );

  server.registerTool(
    "deliver_inbound",
    {
      title: "Deliver a peer message (MCP binding)",
      description:
        "Hand this agent ONE signed peer message: an awp envelope (JSON text), or the email MIME binding as a Gmail raw JSON or RFC 5322 text. " +
        "The runtime verifies signature, pinned keys, representation, policy, audience and replay before any effect.",
      inputSchema: {
        format: z.enum(["envelope", "gmail-json", "eml"]),
        data: z.string().min(2).max(MAX_INBOUND_BYTES),
      },
    },
    guarded(async (args: { format: "envelope" | "gmail-json" | "eml"; data: string }) =>
      showReport(await host.deliver({ ...args, carrier: MCP_BINDING })),
    ),
  );

  server.registerTool(
    "list_outbound",
    {
      title: "Reviewed outbound envelopes not yet acknowledged",
      description:
        "Signed outbound messages this agent produced that have not been acknowledged as handed to a carrier (survives restarts). " +
        "Byte-bounded pages: pass `nextCursor` back as `cursor`.",
      inputSchema: {
        cursor: z.string().min(3).max(512).optional(),
        limit: z.number().int().min(1).max(MAX_LIST).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async (args: { cursor?: string; limit?: number }) => host.listOutbound(args)),
  );

  server.registerTool(
    "ack_outbound",
    {
      title: "Acknowledge hand-off",
      description:
        "Record that these outbound messages were handed to a carrier (e.g. delivered to the peer's interface). Unacknowledged ones stay listed.",
      inputSchema: { ids: z.array(z.string().min(3).max(512)).min(1).max(MAX_LIST) },
    },
    guarded(async (args: { ids: string[] }) => host.ack(args.ids)),
  );

  if (options.a2a || options.public) {
    server.registerTool(
      "dispatch_outbound",
      {
        title: "Dispatch outbound messages to pinned peers (A2A / public carriage)",
        description:
          "Send undelivered messages addressed to peers with a PINNED loopback endpoint (A2A for represented peers; " +
          "the anonymous public carriage for public services), optionally one actor — each re-authorised at send time. " +
          "A peer's transport acknowledgement is not an agreement, permission or settlement.",
        inputSchema: { toActor: z.string().min(8).max(512).optional() },
      },
      async (args: { toActor?: string }) => {
        if (host.closing) return failure("server is shutting down; call refused");
        if (!dispatcher && !publicDispatcher) return failure("no peer endpoints are pinned");
        try {
          // The A2A result keeps its phase-7 shape at the top level; the public carriage's
          // result is added under `public`.
          const out: Json = dispatcher ? { ...(await dispatcher.dispatch(args.toActor)) } : {};
          if (publicDispatcher) out.public = await publicDispatcher.dispatch(args.toActor);
          return result(out);
        } catch (error) {
          return failure((error as Error).message.slice(0, 500));
        }
      },
    );
  }

  // Resources obey the same result bound (and the same serialisation) as tools.
  const resource = (build: () => Json) => async (uri: URL) =>
    host.call(async () => {
      const r = result(build());
      if (r.isError) throw new Error(r.content[0]?.text ?? "result too large");
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: r.content[0]?.text ?? "" }],
      };
    });
  server.registerResource(
    "profile",
    "awp://agent/profile",
    { title: "Agent profile", mimeType: "application/json" },
    resource(() => host.profile()),
  );
  server.registerResource(
    "status",
    "awp://agent/status",
    { title: "Agent status", mimeType: "application/json" },
    resource(() => host.status()),
  );

  const stdin = options.stdin ?? eofSafeStdin();
  const bounded = new BoundedLines(MAX_MCP_LINE_BYTES);
  const transport = new StdioServerTransport(bounded, options.stdout ?? process.stdout);
  let stopReason = "unknown";
  const stopped = new Promise<void>((resolve) => {
    const stop = (why: string) => () => {
      stopReason = why;
      resolve();
    };
    stdin.once("end", stop("stdin closed"));
    stdin.once("close", stop("stdin closed"));
    bounded.once("error", (e: Error) => {
      log(e.message);
      stop("oversized message")();
    });
    transport.onclose = stop("transport closed");
    if (options.stopSignal) options.stopSignal.then(stop("stop requested"));
    else {
      process.once("SIGINT", stop("SIGINT"));
      process.once("SIGTERM", stop("SIGTERM"));
    }
  });
  stdin.pipe(bounded);
  try {
    if (options.a2a) {
      const a2a = await import("../bindings/a2a.js");
      const config = readA2aConfig(a.dir);
      if (!config) throw new Error("A2A configuration disappeared");
      const peers = a2a.readA2aPeers(a.dir);
      if (peers.length > 0) {
        dispatcher = new a2a.A2aDispatcher(host, peers, log);
        if (options.a2a.autoDispatch) {
          const d = dispatcher;
          host.onOutbound(() => d.kick());
        }
      }
      listener = await a2a.startA2aServer(host, config, log);
      host.addInterface({
        binding: A2A_BINDING,
        transport: `A2A ${a2a.A2A_SDK.protocolVersion} JSON-RPC on loopback (${a2a.A2A_SDK.package} ${a2a.A2A_SDK.version})`,
        endpoint: listener.url,
        agentCard: listener.cardUrl,
        pinnedPeers: dispatcher?.pinned ?? [],
        autoDispatch: Boolean(options.a2a.autoDispatch),
        notAuthentication:
          "the local access token grants only API access to this listener; every carried envelope is verified by the runtime",
      });
      // Anything already waiting for a pinned A2A peer (e.g. after a restart) goes out now.
      if (dispatcher && options.a2a.autoDispatch) dispatcher.kick();
    }
    if (options.public && pub) {
      const peers = pub.readPublicPeers(a.dir);
      if (peers.length > 0) {
        publicDispatcher = new pub.PublicDispatcher(host, peers, log);
        // Replies received before an interruption are processed now (idempotently), whether or
        // not new requests are dispatched automatically.
        const recovered = await publicDispatcher.recover();
        if (recovered.length > 0)
          log(`public: recovered ${recovered.length} retained reply set(s)`);
        if (options.public.autoDispatch) {
          const d = publicDispatcher;
          host.onOutbound(() => d.kick());
          d.kick();
        }
      }
      if (publicConfig) publicListener = await pub.startPublicServer(host, publicConfig, log);
      host.addInterface({
        binding: pub.PUBLIC_BINDING,
        transport: "anonymous public carriage over HTTP on loopback (no token, no principal)",
        ...(publicListener ? { endpoint: publicListener.url } : {}),
        pinnedPublicServices: publicDispatcher?.pinned ?? [],
        notAuthentication:
          "requests are anonymous and unsigned; responses are signed by the service's pinned key",
      });
      if (publicDispatcher && options.public.autoDispatch) publicDispatcher.kick();
    }
    await server.connect(transport);
    log(
      `ready: actor ${a.rt.identity.actor}; role ${a.role}; policy module ${a.policy.module} (${a.rt.policyModule().status}); ` +
        `recovered ${recovered.outbound?.length ?? 0} outbound; pid ${process.pid}`,
    );
    await stopped;
    // Stop accepting work first (atomically), stop reading, then drain what was accepted.
    host.stopAccepting();
    stdin.unpipe(bounded);
    log(`stopping (${stopReason}); draining ${host.pending} accepted call(s)`);
    await listener?.close();
    listener = undefined;
    await publicListener?.close();
    publicListener = undefined;
    await dispatcher?.idle();
    await publicDispatcher?.idle();
    await host.drain();
    // Let responses for calls refused during shutdown reach the transport.
    await new Promise((r) => setImmediate(r));
  } finally {
    host.stopAccepting();
    stdin.unpipe(bounded);
    await listener?.close().catch(() => undefined);
    await publicListener?.close().catch(() => undefined);
    await dispatcher?.idle().catch(() => undefined);
    await publicDispatcher?.idle().catch(() => undefined);
    await host.drain().catch(() => undefined);
    await server.close().catch(() => undefined);
    if (stdin !== process.stdin && stdin !== options.stdin) stdin.destroy();
  }
  return 0;
}
