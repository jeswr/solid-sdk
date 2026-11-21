// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
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
import type { IntroductionCard } from "@jeswr/agent-reference";
import { constants, existsSync } from "fs";
import { open } from "fs/promises";
import { join } from "path";
import { installGateMandate, readGateStatus } from "./gate.js";
import { initGate, pinPeer } from "./gate-setup.js";
import { installLaunchd } from "./launchd.js";
import { type createLocalState, createProcessLease } from "./local.js";
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
  /** True when HALT was cleared; false when it was already absent. */
  resume(): Promise<boolean>;
  status(): Promise<unknown>;
  accounts(): Promise<readonly { id: string; binding: string; enabled: boolean }[]>;
  login(profile: string): Promise<void>;
  stats(task?: string): Promise<TaskStatsReport>;
  audit(args: readonly string[], print: (line: string) => void): Promise<number>;
  install(confirm: CliIo["confirm"]): Promise<boolean>;
  gate?(args: readonly string[], io: CliIo): Promise<number>;
}
export interface CliHostOptions {
  daemon: Daemon | (() => Promise<AuthenticatedComposition>);
  local: ReturnType<typeof createLocalState>;
  /** Same owner-proof-verifying control adapter as the executor; never parsed controls. */
  resumeAuthority?: { ownerWebId: string; controls: Pick<ControlStore, "listVerified"> };
  accounts: CliHost["accounts"];
  credentials: Deps;
  /** Explicit login only. The URL may contain OAuth state: open it, never log it. */
  openLoginUrl: (url: string) => Promise<void>;
  ledger: EvidenceLedger;
  launchCommand: readonly string[];
  gate?: { stateDirectory: string; agentWebId: string; ownerWebId: string };
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
    ...(o.gate ? { gate: gateCommand(o.gate) } : {}),
  };
}
const usage =
  "Usage: awp run | once | halt | resume | status | accounts | login <profile> | stats [--ledger <events.jsonl>] [--task <id>] [--format json|csv] | audit <artifact> [--at <instant>] | install-launchd | gate";
const statsUsage = "Usage: awp stats [--ledger <events.jsonl>] [--task <id>] [--format json|csv]";
const gateUsage =
  "Usage: awp gate init --owner-dir <dir> | pin <card.json> | mandate <mandate.jws> | status";
const compositionRequired = "awp requires a trusted composition module (Node --import)";

async function readCard(path: string): Promise<IntroductionCard> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 * 1024) throw new Error("Invalid introduction card");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}

function gateCommand(options: NonNullable<CliHostOptions["gate"]>): NonNullable<CliHost["gate"]> {
  const directory = join(options.stateDirectory, "gate");
  return async (args, io) => {
    const [operation, value, ownerDir] = args;
    let release: (() => Promise<void>) | undefined;
    async function confirm(prompt: string) {
      if (!(await io.confirm(prompt))) return false;
      release = await createProcessLease(options.stateDirectory).acquire();
      return true;
    }
    try {
      if (operation === "status" && args.length === 1) {
        const status = await readGateStatus(directory);
        io.print(JSON.stringify(status));
        return status.ledger.ok ? 0 : 1;
      }
      if (operation === "init" && value === "--owner-dir" && ownerDir && args.length === 3) {
        const created = await initGate({ ...options, directory, ownerDir, confirm });
        io.print(created ? "Inbound gate initialized" : "cancelled");
        return 0;
      }
      if (operation === "pin" && value && args.length === 2) {
        const pinned = await pinPeer({
          directory,
          card: await readCard(value),
          confirm,
          print: (line) => io.print(line),
        });
        io.print(pinned ? "Peer pinned" : "cancelled");
        return 0;
      }
      if (operation === "mandate" && value && args.length === 2) {
        release = await createProcessLease(options.stateDirectory).acquire();
        await installGateMandate({
          directory,
          path: value,
          identity: { actor: options.agentWebId, party: options.ownerWebId },
        });
        io.print("Gate mandate installed");
        return 0;
      }
      io.print(gateUsage);
      return 2;
    } finally {
      await release?.();
    }
  };
}
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
    if (command === "gate" && rest.length === 1 && rest[0] === "--help") {
      io.print(gateUsage);
      return 0;
    }
    if (!host) {
      io.print(compositionRequired);
      return 1;
    }
    if (command === "gate") {
      if (!host.gate) throw new Error("Gate configuration required");
      return await host.gate(rest, io);
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
