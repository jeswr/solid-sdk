// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "@jeswr/agent-model";
import { type AuditRecord, type LedgerEntry, taskIdSchema } from "./records.js";
import { CHAIN_SCOPE, verifyLedger } from "./verify.js";

export interface LatencyStats {
  readonly samples: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}
export interface TaskStats {
  readonly taskId: string;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly tokens: number;
  readonly tokenBreakdownCalls: number;
  readonly modelLatencyMs: LatencyStats;
  readonly toolLatencyMs: LatencyStats;
  readonly humanInterrupts: number;
  readonly retries: number;
  readonly refusals: number;
}
export interface TaskStatsReport {
  readonly version: 1;
  readonly scope: string;
  readonly prunedThroughSeq: number | null;
  readonly unassignedEntries: number;
  readonly unassigned: Omit<TaskStats, "taskId">;
  readonly tasks: readonly TaskStats[];
}

function sum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error("Task statistics exceed safe integer range");
  return result;
}
/** Nearest-rank percentiles; absent measurements are excluded, not replaced by zero. */
function latency(values: number[]): LatencyStats {
  values.sort((a, b) => a - b);
  const rank = (p: number) => values[Math.ceil(p * values.length) - 1] ?? null;
  return { samples: values.length, p50: rank(0.5), p95: rank(0.95), p99: rank(0.99) };
}

function aggregate(taskId: string, records: readonly AuditRecord[]): TaskStats {
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let tokens = 0;
  let tokenBreakdownCalls = 0;
  let retries = 0;
  let refusals = 0;
  let standaloneTools = 0;
  const models = new Map<string, number>();
  const tools = new Map<string, number>();
  const modelLatencies: number[] = [];
  const toolLatencies: number[] = [];
  const approvals = new Set<string>();
  const callIds = new Set<string>();
  for (const r of records) {
    if (r.type === "model-call" || r.type === "tool-call") {
      if (callIds.has(r.id)) throw new Error("Duplicate call identity in task statistics");
      callIds.add(r.id);
      retries = sum(retries, r.retries ?? 0);
      if (r.latencyMs !== undefined)
        (r.type === "model-call" ? modelLatencies : toolLatencies).push(r.latencyMs);
    }
    if (r.type === "model-call") {
      modelCalls++;
      const split = r.inputTokens !== undefined && r.outputTokens !== undefined;
      if ((r.inputTokens !== undefined || r.outputTokens !== undefined) && !split)
        throw new Error("Incomplete token breakdown in task statistics");
      const total = sum(r.inputTokens ?? 0, r.outputTokens ?? 0);
      if (split && r.tokens !== undefined && r.tokens !== total)
        throw new Error("Inconsistent token total in task statistics");
      inputTokens = sum(inputTokens, r.inputTokens ?? 0);
      outputTokens = sum(outputTokens, r.outputTokens ?? 0);
      tokens = sum(tokens, r.tokens ?? total);
      if (split) tokenBreakdownCalls++;
      models.set(r.id, r.toolCalls ?? 0);
    }
    if (r.type === "tool-call") {
      if (r.modelCall === undefined) standaloneTools++;
      else tools.set(r.modelCall, sum(tools.get(r.modelCall) ?? 0, 1));
    }
    if (r.type === "decision" && r.decision === "confirm-required")
      approvals.add(r.proposal ?? r.id);
    if (r.status === "refused" || r.decision === "prohibited" || r.decision === "refuse-all")
      refusals++;
  }
  let toolCalls = standaloneTools;
  // Gateway summaries count requested tools; detail entries may cover only some of them.
  // Take the larger count per producing model call, then include standalone executions.
  for (const id of new Set([...models.keys(), ...tools.keys()]))
    toolCalls = sum(toolCalls, Math.max(models.get(id) ?? 0, tools.get(id) ?? 0));
  return {
    taskId,
    modelCalls,
    toolCalls,
    inputTokens,
    outputTokens,
    tokens,
    tokenBreakdownCalls,
    modelLatencyMs: latency(modelLatencies),
    toolLatencyMs: latency(toolLatencies),
    humanInterrupts: approvals.size,
    retries,
    refusals,
  };
}

/** Read-only aggregation of verified retained evidence, never an authorization verdict. */
export function aggregateTaskStats(
  entries: readonly LedgerEntry[],
  taskId?: string,
): TaskStatsReport {
  if (taskId !== undefined) taskIdSchema.parse(taskId);
  // Use the same detached JSON values for validation and aggregation. Accessors must
  // not substitute unverified task labels or counters after the integrity check.
  const snapshot = JSON.parse(canonicalJson(entries)) as LedgerEntry[];
  const chain = verifyLedger(snapshot);
  if (!chain.ok) throw new Error("Ledger integrity failure");
  const tasks = new Map<string, AuditRecord[]>();
  const unassigned: AuditRecord[] = [];
  for (const { record } of snapshot) {
    if (record.type === "ledger-checkpoint") continue;
    if (record.taskId === undefined) {
      unassigned.push(record);
      continue;
    }
    if (taskId !== undefined && record.taskId !== taskId) continue;
    const records = tasks.get(record.taskId) ?? [];
    records.push(record);
    tasks.set(record.taskId, records);
  }
  const { taskId: _unassignedId, ...unassignedStats } = aggregate("", unassigned);
  return {
    version: 1,
    scope: CHAIN_SCOPE,
    prunedThroughSeq: chain.prunedThroughSeq ?? null,
    unassignedEntries: unassigned.length,
    unassigned: unassignedStats,
    tasks: [...tasks.keys()].sort().map((id) => aggregate(id, tasks.get(id) as AuditRecord[])),
  };
}

/** Stable flat columns, including retention/assignment limits on every row. */
export function taskStatsCsv(report: TaskStatsReport): string {
  const columns = [
    "taskId",
    "modelCalls",
    "toolCalls",
    "inputTokens",
    "outputTokens",
    "tokens",
    "tokenBreakdownCalls",
    "modelLatencySamples",
    "modelLatencyP50Ms",
    "modelLatencyP95Ms",
    "modelLatencyP99Ms",
    "toolLatencySamples",
    "toolLatencyP50Ms",
    "toolLatencyP95Ms",
    "toolLatencyP99Ms",
    "humanInterrupts",
    "retries",
    "refusals",
    "prunedThroughSeq",
    "unassignedEntries",
  ];
  const cell = (value: string | number | null) =>
    value === null ? "" : `"${String(value).replaceAll('"', '""')}"`;
  // An empty task label distinguishes the legacy/unassigned summary from task rows.
  const groups = [
    ...report.tasks,
    ...(report.unassignedEntries > 0 ? [{ taskId: "", ...report.unassigned }] : []),
  ];
  const rows = groups.map((t) =>
    [
      t.taskId,
      t.modelCalls,
      t.toolCalls,
      t.inputTokens,
      t.outputTokens,
      t.tokens,
      t.tokenBreakdownCalls,
      t.modelLatencyMs.samples,
      t.modelLatencyMs.p50,
      t.modelLatencyMs.p95,
      t.modelLatencyMs.p99,
      t.toolLatencyMs.samples,
      t.toolLatencyMs.p50,
      t.toolLatencyMs.p95,
      t.toolLatencyMs.p99,
      t.humanInterrupts,
      t.retries,
      t.refusals,
      report.prunedThroughSeq,
      report.unassignedEntries,
    ]
      .map(cell)
      .join(","),
  );
  return `${[columns.join(","), ...rows].join("\r\n")}\r\n`;
}

export function taskStatsJson(report: TaskStatsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
