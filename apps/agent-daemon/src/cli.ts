// AUTHORED-BY Codex GPT-6.1-Sol
import { type EvidenceLedger, runAuditCli } from "@jeswr/agent-audit";
import { type Deps, login } from "@jeswr/agent-credentials";
import { installLaunchd } from "./launchd.js";
import type { createLocalState } from "./local.js";
import { scrubLog } from "./logging.js";
import type { AuthenticatedComposition, Daemon } from "./types.js";

export interface CliIo {
  print(line: string): void;
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
  stats(task?: string): Promise<unknown>;
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
      const calls = o.ledger
        .entries()
        .filter(
          (entry) =>
            entry.record.type === "model-call" && (!task || entry.record.proposal === task),
        );
      return {
        calls: calls.length,
        tokens: calls.reduce(
          (n, entry) => n + ("tokens" in entry.record ? (entry.record.tokens ?? 0) : 0),
          0,
        ),
      };
    },
    audit: (args, print) => runAuditCli(args, print),
    install: (confirm) => installLaunchd({ command: o.launchCommand, confirm }),
  };
}
const usage =
  "Usage: awp run | once | halt | status | accounts | login <profile> | stats [--task <id>] | audit <artifact> [--at <instant>] | install-launchd";
/** Dispatch never opens a listener; only explicit login may use its PKCE loopback helper. */
export async function runCli(args: readonly string[], host: CliHost, io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "--help" && !rest.length) {
      io.print(usage);
      return 0;
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
      case "stats":
        if (rest.length && !(rest.length === 2 && rest[0] === "--task" && rest[1])) {
          io.print(usage);
          return 2;
        }
        io.print(scrubLog(JSON.stringify(await host.stats(rest[1]))));
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
  if (args.length === 1 && args[0] === "--help") {
    io.print(usage);
    return 0;
  }
  if (!configured) {
    io.print("awp requires a trusted composition module (Node --import)");
    return 1;
  }
  return runCli(args, configured, io);
}
