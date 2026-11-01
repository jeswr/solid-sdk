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
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
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
export interface CliHost {
  run(signal: AbortSignal): Promise<void>;
  once(signal?: AbortSignal): Promise<void>;
  halt(): Promise<void>;
  status(): Promise<unknown>;
  accounts(): Promise<readonly { id: string; binding: string; enabled: boolean }[]>;
  login(profile: string): Promise<void>;
  stats(task?: string): Promise<TaskStatsReport>;
  audit(args: readonly string[], print: (line: string) => void): Promise<number>;
  install(confirm: CliIo["confirm"]): Promise<boolean>;
}
export interface CliHostOptions {
  daemon: Daemon | (() => Promise<AuthenticatedComposition>);
  local: ReturnType<typeof createLocalState>;
  accounts: CliHost["accounts"];
  credentials: Deps;
  /** Explicit login only. The URL may contain OAuth state: open it, never log it. */
  openLoginUrl: (url: string) => Promise<void>;
  ledger: EvidenceLedger;
  launchCommand: readonly string[];
}
export function createCliHost(o: CliHostOptions): CliHost {
  async function execute(mode: "run" | "once", signal?: AbortSignal) {
    const composition = typeof o.daemon === "function" ? await o.daemon() : undefined;
    const daemon = composition?.daemon ?? (o.daemon as Daemon);
    try {
      if (mode === "once") await daemon.once(signal);
      else if (signal) await daemon.run(signal);
      else throw new Error("Run requires an abort signal");
    } finally {
      await composition?.close();
    }
  }
  return {
    run: (signal) => execute("run", signal),
    once: (signal) => execute("once", signal),
    halt: () => o.local.halt(),
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
  "Usage: awp run | once | halt | status | accounts | login <profile> | stats [--ledger <events.jsonl>] [--task <id>] [--format json|csv] | audit <artifact> [--at <instant>] | install-launchd";
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
      stderr(`Statistics exclude ${report.unassignedEntries} entries without a task ID.\n`);
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
    if (rest.length && !["login", "stats", "audit"].includes(command ?? "")) {
      io.print(usage);
      return 2;
    }
    switch (command) {
      case "run":
        await host.run(io.signal);
        break;
      case "once":
        await host.once(io.signal);
        break;
      case "halt":
        await host.halt();
        io.print("halted");
        break;
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
