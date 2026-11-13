// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  aggregateTaskStats,
  type EvidenceLedger,
  FileLedger,
  type LedgerEntry,
  runAuditCli,
  type TaskStatsReport,
  taskStatsCsv,
  taskStatsJson,
} from "@jeswr/agent-audit";
import { type Deps, login } from "@jeswr/agent-credentials";
import type { ControlStore } from "@jeswr/agent-executor";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
import type { ConnectorsJob } from "./connectors.js";
import { installLaunchd } from "./launchd.js";
import type { createLocalState } from "./local.js";
import { scrubLog } from "./logging.js";
import type { AuthenticatedComposition, Daemon } from "./types.js";

export interface CliIo {
  print(line: string): void;
  /** Stats diagnostics, separate from the machine-readable export on stdout. */
  stderr?(text: string): void;
  /** Read-only local evidence seam; the default reads FileLedger and its archives. */
  readLedger?(path: string): readonly LedgerEntry[];
  confirm(prompt: string): Promise<boolean>;
  signal: AbortSignal;
}
/** What a lazy composition is asked to include; `connectors` mirrors `awp run --connectors`. */
export interface CompositionRequest {
  readonly connectors: boolean;
}
export interface RunOptions {
  /** Opt into the scheduled connectors job (off by default). */
  readonly connectors?: boolean;
}
export interface CliHost {
  connectors?: ConnectorsJob["list"];
  run(signal: AbortSignal, options?: RunOptions): Promise<void>;
  once(signal?: AbortSignal, options?: RunOptions): Promise<void>;
  halt(): Promise<void>;
  /** True when HALT was cleared; false when it was already absent. */
  resume(): Promise<boolean>;
  status(): Promise<unknown>;
  accounts(): Promise<readonly { id: string; binding: string; enabled: boolean }[]>;
  login(profile: string): Promise<void>;
  stats(task?: string): Promise<TaskStatsReport>;
  audit(args: readonly string[], print: (line: string) => void): Promise<number>;
  install(confirm: CliIo["confirm"]): Promise<boolean>;
}
export interface CliHostOptions {
  /** Lazy authenticated owner-only read, independent of channel/model composition. */
  connectors?: ConnectorsJob["list"];
  /**
   * A composed daemon, or a lazy factory. The factory receives the CLI's opt-in request and
   * passes `connectors: { enabled: request.connectors }` to composeDaemon.
   */
  daemon: Daemon | ((request: CompositionRequest) => Promise<AuthenticatedComposition>);
  local: ReturnType<typeof createLocalState>;
  /** Same owner-proof-verifying control adapter as the executor; never parsed controls. */
  resumeAuthority?: { ownerWebId: string; controls: Pick<ControlStore, "listVerified"> };
  accounts: CliHost["accounts"];
  credentials: Deps;
  /** Explicit login only. The URL may contain OAuth state: open it, never log it. */
  openLoginUrl: (url: string) => Promise<void>;
  ledger: EvidenceLedger;
  launchCommand: readonly string[];
}
export function createCliHost(o: CliHostOptions): CliHost {
  async function execute(mode: "run" | "once", signal?: AbortSignal, options: RunOptions = {}) {
    const connectors = options.connectors === true;
    // A pre-composed daemon cannot be asked to opt in; fail closed instead of ignoring it.
    if (connectors && typeof o.daemon !== "function")
      throw new Error("Connectors job is not configured");
    const composition = typeof o.daemon === "function" ? await o.daemon({ connectors }) : undefined;
    const daemon = composition?.daemon ?? (o.daemon as Daemon);
    try {
      if (connectors && !composition?.connectors)
        throw new Error("Connectors job is not configured");
      if (mode === "once") await daemon.once(signal);
      else if (signal) await daemon.run(signal);
      else throw new Error("Run requires an abort signal");
    } finally {
      await composition?.close();
    }
  }
  return {
    connectors:
      o.connectors ??
      (async (signal) => {
        if (typeof o.daemon !== "function") throw new Error("Connectors job is not configured");
        const composition = await o.daemon({ connectors: true });
        try {
          if (!composition.connectors) throw new Error("Connectors job is not configured");
          return await composition.connectors.list(signal);
        } finally {
          await composition.close();
        }
      }),
    run: (signal, options) => execute("run", signal, options),
    once: (signal, options) => execute("once", signal, options),
    halt: () => o.local.halt(),
    resume: () =>
      o.local.resume(async (haltedAt) => {
        if (!o.resumeAuthority) return false;
        const { ownerWebId, controls } = o.resumeAuthority;
        const statements = await controls.listVerified(ownerWebId);
        const now = Date.now();
        const latest = statements
          .filter(
            (c) =>
              c.attributedTo === ownerWebId &&
              (c.kind === "Halt" || c.kind === "Resume") &&
              Date.parse(c.createdAt) <= now &&
              Date.parse(c.expires) > now,
          )
          .sort(
            (a, b) =>
              Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.kind === "Halt" ? -1 : 1),
          )[0];
        return latest?.kind === "Resume" && Date.parse(latest.createdAt) > haltedAt;
      }),
    status: () => o.local.status(),
    accounts: o.accounts,
    async login(profile) {
      await login(o.credentials, profile, { onUrl: o.openLoginUrl });
    },
    async stats(task) {
      return aggregateTaskStats(o.ledger.entries(), task);
    },
    audit: (args, print) => runAuditCli(args, print),
    install: (confirm) => installLaunchd({ command: o.launchCommand, confirm }),
  };
}
const usage =
  "Usage: awp run [--connectors] | once [--connectors] | halt | resume | status | accounts | connectors | login <profile> | stats [--ledger <events.jsonl>] [--task <id>] [--format json|csv] | audit <artifact> [--at <instant>] | install-launchd";
const statsUsage = "Usage: awp stats [--ledger <events.jsonl>] [--task <id>] [--format json|csv]";
const compositionRequired = "awp requires a trusted composition module (Node --import)";
function readLedger(path: string): readonly LedgerEntry[] {
  const ledger = new FileLedger(path);
  if (!existsSync(path) && ledger.segments().length === 0) throw new Error("Missing ledger");
  return ledger.entries();
}
async function runStats(rest: readonly string[], host: CliHost | undefined, io: CliIo) {
  if (rest.length === 1 && rest[0] === "--help") {
    io.print(statsUsage);
    return 0;
  }
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i] as string;
    const value = rest[i + 1];
    if (
      !["--ledger", "--task", "--format"].includes(key) ||
      options.has(key) ||
      value === undefined ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      stderr(`${statsUsage}\n`);
      return 2;
    }
    options.set(key, value);
  }
  const path = options.get("--ledger");
  const format = options.get("--format") ?? "json";
  if (!["json", "csv"].includes(format)) {
    stderr(`${statsUsage}\n`);
    return 2;
  }
  try {
    const task = options.get("--task");
    let report: TaskStatsReport;
    if (path !== undefined) report = aggregateTaskStats((io.readLedger ?? readLedger)(path), task);
    else if (host) report = await host.stats(task);
    else {
      stderr(`${compositionRequired}\n`);
      return 1;
    }
    const output = format === "csv" ? taskStatsCsv(report) : taskStatsJson(report);
    if (report.prunedThroughSeq !== null)
      stderr("Statistics include retained entries only (ledger prefix pruned).\n");
    if (report.unassignedEntries > 0)
      stderr(
        `Statistics report ${report.unassignedEntries} entries separately without a task ID.\n`,
      );
    // Exporters project only validated task labels and counters. Preserve JSON/CSV
    // newlines; CliIo.print (and the executable) supplies the final newline.
    io.print(output.slice(0, -1));
    return 0;
  } catch {
    // Storage/provider exceptions can contain paths, WebIDs or credentials.
    stderr("Unable to export task statistics.\n");
    return 1;
  }
}
/** Dispatch never opens a listener; only explicit login may use its PKCE loopback helper. */
export async function runCli(
  args: readonly string[],
  host: CliHost | undefined,
  io: CliIo,
): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "--help" && !rest.length) {
      io.print(usage);
      return 0;
    }
    if (command === "stats") return await runStats(rest, host, io);
    if (!host) {
      io.print(compositionRequired);
      return 1;
    }
    const connectorsFlag =
      (command === "run" || command === "once") && rest.length === 1 && rest[0] === "--connectors";
    if (rest.length && !connectorsFlag && !["login", "stats", "audit"].includes(command ?? "")) {
      io.print(usage);
      return 2;
    }
    switch (command) {
      case "connectors": {
        if (!host.connectors) throw new Error("Connectors job is not configured");
        const connections = await host.connectors(io.signal);
        if (connections.length > 1_000) throw new Error("Too many connections");
        for (const c of connections) {
          if (
            !["ok", "stale", "failing", "needs-reauth", "invalid-config"].includes(c.health) ||
            !(
              /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.connectorId) ||
              (c.health === "invalid-config" && c.connectorId === "-")
            ) ||
            !(
              /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(c.account) ||
              (c.health === "invalid-config" && c.account === "-")
            )
          )
            throw new Error("Invalid connector summary");
          io.print(
            `${c.connectorId} ${c.account} ${c.enabled ? "enabled" : "disabled"} ${c.health}`,
          );
        }
        break;
      }
      case "run":
        if (connectorsFlag) await host.run(io.signal, { connectors: true });
        else await host.run(io.signal);
        break;
      case "once":
        if (connectorsFlag) await host.once(io.signal, { connectors: true });
        else await host.once(io.signal);
        break;
      case "halt":
        await host.halt();
        io.print("halted");
        break;
      case "resume": {
        const cleared = await host.resume();
        io.print(
          `${cleared ? "local stop cleared" : "no local stop was present"}; signed controls and permissions still apply`,
        );
        break;
      }
      case "status":
        io.print(scrubLog(JSON.stringify(await host.status())));
        break;
      case "accounts": {
        const accounts = await host.accounts();
        // Whitelist both fields and syntax, never print handles or credential references.
        for (const account of accounts) {
          if (!/^[a-z0-9-]{1,40}$/.test(account.id) || !/^[a-z0-9-]{1,40}$/.test(account.binding))
            throw new Error("Invalid account summary");
          io.print(`${account.id} ${account.binding} ${account.enabled ? "enabled" : "disabled"}`);
        }
        break;
      }
      case "login":
        if (rest.length !== 1 || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(rest[0] ?? "")) {
          io.print(usage);
          return 2;
        }
        await host.login(rest[0] as string);
        io.print("login complete");
        break;
      case "audit":
        return await host.audit(rest, (line) => io.print(scrubLog(line)));
      case "install-launchd":
        io.print((await host.install(io.confirm)) ? "installed" : "cancelled");
        break;
      default:
        io.print(usage);
        return 2;
    }
    return 0;
  } catch {
    // Provider, auth and filesystem errors can contain paths, WebIDs and secret values.
    io.print("awp command failed; no authority granted");
    return 1;
  }
}
let configured: CliHost | undefined;
/** A trusted Node --import deployment module composes the host. No code paths come from pod data. */
export function configureCli(host: CliHost): void {
  if (configured) throw new Error("CLI host already configured");
  configured = host;
}
export async function runConfiguredCli(args: readonly string[], io: CliIo): Promise<number> {
  return runCli(args, configured, io);
}
