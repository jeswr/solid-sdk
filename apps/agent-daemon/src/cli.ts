// AUTHORED-BY Codex GPT-6
import {
  aggregateTaskStats,
  FileLedger,
  type LedgerEntry,
  taskStatsCsv,
  taskStatsJson,
} from "@jeswr/agent-audit";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";

export interface StatsCliIO {
  readonly readLedger: (path: string) => readonly LedgerEntry[];
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}
const USAGE = "Usage: awp stats --ledger <events.jsonl> [--task <id>] [--format json|csv]\n";
const defaults: StatsCliIO = {
  readLedger(path) {
    const ledger = new FileLedger(path);
    if (!existsSync(path) && ledger.segments().length === 0) throw new Error("Missing ledger");
    return ledger.entries();
  },
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

/** A-045 stats command only. Host lifecycle commands belong to the daemon composition task. */
export function runAwpCli(args: readonly string[], injected: Partial<StatsCliIO> = {}): number {
  const io = { ...defaults, ...injected };
  if (
    (args.length === 1 && args[0] === "--help") ||
    (args.length === 2 && args[0] === "stats" && args[1] === "--help")
  ) {
    io.stdout(USAGE);
    return 0;
  }
  const options = new Map<string, string>();
  if (args[0] !== "stats") {
    io.stderr(USAGE);
    return 1;
  }
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i] as string;
    const value = args[i + 1];
    if (
      !["--ledger", "--task", "--format"].includes(key) ||
      options.has(key) ||
      value === undefined ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      io.stderr(USAGE);
      return 1;
    }
    options.set(key, value);
  }
  const path = options.get("--ledger");
  const format = options.get("--format") ?? "json";
  if (path === undefined || !["json", "csv"].includes(format)) {
    io.stderr(USAGE);
    return 1;
  }
  try {
    const report = aggregateTaskStats(io.readLedger(path), options.get("--task"));
    const output = format === "csv" ? taskStatsCsv(report) : taskStatsJson(report);
    if (report.prunedThroughSeq !== null)
      io.stderr("Statistics include retained entries only (ledger prefix pruned).\n");
    if (report.unassignedEntries > 0)
      io.stderr(`Statistics exclude ${report.unassignedEntries} entries without a task ID.\n`);
    io.stdout(output);
    return 0;
  } catch {
    // Storage/provider failures can contain paths, WebIDs or secrets. Never echo them.
    io.stderr("Unable to export task statistics.\n");
    return 1;
  }
}
