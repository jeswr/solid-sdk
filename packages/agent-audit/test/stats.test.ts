// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { MemoryLedger, verifyLedger } from "../src/ledger.js";
import { type AuditRecord, checkedRecord, seal } from "../src/records.js";
import { aggregateTaskStats, taskStatsCsv, taskStatsJson } from "../src/stats.js";
import { AT, required } from "./fixture.js";

const base = {
  agent: "https://example.org/agent#me",
  owner: "https://example.org/owner#me",
  taskId: "task-a",
  conversation: "urn:conversation:1",
} as const;
function fixture() {
  const ledger = new MemoryLedger();
  const append = (id: string, type: AuditRecord["type"], fields: Partial<AuditRecord> = {}) =>
    ledger.append({ ...base, id: `urn:event:${id}`, type, ...fields }, AT);
  append("b", "conversation", { taskId: "task-b" });
  append("conversation", "conversation");
  append("proposal", "proposal");
  append("m1", "model-call", {
    inputTokens: 100,
    outputTokens: 20,
    tokens: 120,
    toolCalls: 3,
    latencyMs: 10,
    retries: 1,
  });
  append("m2", "model-call", { tokens: 50, toolCalls: 1, latencyMs: 30, retries: 0 });
  append("m3", "model-call", { inputTokens: 0, outputTokens: 0, latencyMs: 0 });
  append("t1", "tool-call", { modelCall: "urn:event:m1", latencyMs: 5, retries: 2 });
  append("t2", "tool-call", { modelCall: "urn:event:m1", latencyMs: 0, status: "refused" });
  append("t3", "tool-call", { modelCall: "urn:event:m2" });
  append("t4", "tool-call", { modelCall: "urn:event:missing-model", latencyMs: 15, retries: 1 });
  append("t5", "tool-call", { latencyMs: 10 });
  append("t6", "tool-call");
  append("d1", "decision", { decision: "confirm-required", proposal: "urn:event:proposal" });
  append("d2", "decision", { decision: "confirm-required", proposal: "urn:event:proposal" });
  append("d3", "decision", { decision: "confirm-required" });
  append("approval", "approval-seen");
  append("deny", "decision", { decision: "prohibited", status: "refused" });
  append("halt", "decision", { decision: "refuse-all" });
  append("transmission", "transmission", { status: "refused" });
  ledger.append({ type: "ingest", id: "urn:legacy", agent: base.agent, owner: base.owner }, AT);
  return ledger;
}

it("aggregates tasks in stable order without double-counting gateway tool summaries", () => {
  const ledger = fixture();
  const before = ledger.entries();
  const report = aggregateTaskStats(before);
  expect(report).toMatchObject({ version: 1, prunedThroughSeq: null, unassignedEntries: 1 });
  expect(report.scope).toContain("tail truncation");
  expect(report.tasks).toEqual([
    {
      taskId: "task-a",
      modelCalls: 3,
      toolCalls: 7,
      inputTokens: 100,
      outputTokens: 20,
      tokens: 170,
      tokenBreakdownCalls: 2,
      modelLatencyMs: { samples: 3, p50: 10, p95: 30, p99: 30 },
      toolLatencyMs: { samples: 4, p50: 5, p95: 15, p99: 15 },
      humanInterrupts: 2,
      retries: 4,
      refusals: 4,
    },
    {
      taskId: "task-b",
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      tokenBreakdownCalls: 0,
      modelLatencyMs: { samples: 0, p50: null, p95: null, p99: null },
      toolLatencyMs: { samples: 0, p50: null, p95: null, p99: null },
      humanInterrupts: 0,
      retries: 0,
      refusals: 0,
    },
  ]);
  expect(before).toEqual(ledger.entries());
  expect(aggregateTaskStats(before, "task-a").tasks).toEqual(report.tasks.slice(0, 1));
  expect(aggregateTaskStats(before, "missing").tasks).toEqual([]);
  expect(aggregateTaskStats([]).tasks).toEqual([]);
  expect(() => aggregateTaskStats([], "free text")).toThrow();
});

it("exports golden CSV and lossless JSON without prompts, identities or record references", async () => {
  const report = aggregateTaskStats(fixture().entries());
  await expect(taskStatsCsv(report)).toMatchFileSnapshot("fixtures/stats.csv");
  expect(JSON.parse(taskStatsJson(report))).toEqual(report);
  for (const output of [taskStatsCsv(report), taskStatsJson(report)]) {
    expect(output).not.toContain(base.agent);
    expect(output).not.toContain(base.owner);
    expect(output).not.toContain(base.conversation);
    expect(output).not.toContain("urn:event:");
  }
  expect(taskStatsCsv(aggregateTaskStats([])).split("\r\n")).toHaveLength(2);
  const escaped = { ...report, tasks: [{ ...required(report.tasks[0]), taskId: 'a,"b' }] };
  expect(taskStatsCsv(escaped)).toContain('"a,""b"');
});

it("computes nearest-rank p50, p95 and p99 from only observed call latencies", () => {
  const ledger = new MemoryLedger();
  for (let i = 100; i > 0; i--)
    ledger.append({ ...base, type: "model-call", id: `urn:call:${i}`, latencyMs: i }, AT);
  ledger.append({ ...base, type: "model-call", id: "urn:call:missing" }, AT);
  ledger.append(
    { ...base, type: "receipt", id: "urn:receipt:1", latencyMs: 9999, retries: 99 },
    AT,
  );
  expect(required(aggregateTaskStats(ledger.entries()).tasks[0])).toMatchObject({
    modelCalls: 101,
    modelLatencyMs: { samples: 100, p50: 50, p95: 95, p99: 99 },
    retries: 0,
  });
});

it("includes tool details when summaries are missing or undercounted", () => {
  const ledger = new MemoryLedger();
  ledger.append({ ...base, type: "model-call", id: "urn:m:1" }, AT);
  for (let i = 0; i < 2; i++)
    ledger.append({ ...base, type: "tool-call", id: `urn:t:${i}`, modelCall: "urn:m:1" }, AT);
  ledger.append({ ...base, type: "model-call", id: "urn:m:2", toolCalls: 5 }, AT);
  expect(required(aggregateTaskStats(ledger.entries()).tasks[0]).toolCalls).toBe(7);
});

it("reports retained-prefix pruning and rejects corrupt evidence even outside the selected task", () => {
  const entries = fixture().entries();
  const first = required(entries[0]);
  const second = required(entries[1]);
  const checkpoint = seal(3, AT, second.hash, {
    type: "ledger-checkpoint",
    lastPrunedSeq: 1,
    lastPrunedHash: first.hash,
  });
  const retained = [second, checkpoint];
  expect(verifyLedger(retained).ok).toBe(true);
  const report = aggregateTaskStats(retained);
  expect(report.prunedThroughSeq).toBe(1);
  expect(report.tasks).toHaveLength(1);
  expect(taskStatsCsv(report)).toContain(',"1","0"\r\n');
  expect(() => aggregateTaskStats([{ ...first, hash: second.hash }], "missing")).toThrow(
    "integrity",
  );
  expect(() => aggregateTaskStats(entries.slice(1))).toThrow("integrity");
});

it.each(
  [
    [{ inputTokens: 1 }],
    [{ outputTokens: 1 }],
    [{ tokens: 4, inputTokens: 1, outputTokens: 2 }],
    [{ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }],
    [{ tokens: Number.MAX_SAFE_INTEGER }, { tokens: 1 }],
    [{ retries: Number.MAX_SAFE_INTEGER }, { retries: 1 }],
    [{ toolCalls: Number.MAX_SAFE_INTEGER }, { toolCalls: 1 }],
  ].map((fields) => ({ fields })),
)("rejects incomplete, inconsistent or overflowing counters: $fields", ({ fields }) => {
  const ledger = new MemoryLedger();
  for (const [i, counters] of fields.entries())
    ledger.append({ ...base, type: "model-call", id: `urn:m:${i}`, ...counters }, AT);
  expect(() => aggregateTaskStats(ledger.entries())).toThrow();
});

it("rejects duplicate call identities rather than publishing inflated statistics", () => {
  const ledger = new MemoryLedger();
  for (let i = 0; i < 2; i++)
    ledger.append({ ...base, type: "model-call", id: "urn:duplicate" }, AT);
  expect(() => aggregateTaskStats(ledger.entries())).toThrow("Duplicate call identity");
});

it("rejects accessors and non-JSON evidence before reading unverified statistics", () => {
  const entry = required(fixture().entries()[0]);
  let reads = 0;
  const substituted = { ...entry };
  Object.defineProperty(substituted, "record", {
    enumerable: true,
    get() {
      reads++;
      return entry.record;
    },
  });
  expect(() => aggregateTaskStats([substituted])).toThrow("canonicalisable");
  expect(reads).toBe(0);
  expect(() => aggregateTaskStats([{ ...entry, hidden: undefined }] as never)).toThrow();
});

it("keeps instrumentation bounded and body-free at the ledger boundary", () => {
  const record = { ...base, type: "tool-call", id: "urn:tool:1", tool: "pod_read" };
  expect(checkedRecord(record)).toEqual(record);
  for (const fields of [
    { taskId: "user prompt" },
    { taskId: "" },
    { taskId: "paper\n" },
    { taskId: "a".repeat(129) },
    { conversation: "not-an-iri" },
    { modelCall: "https://user:secret@example.org/" },
    { inputTokens: -1 },
    { outputTokens: 1.5 },
    { latencyMs: Infinity },
    { tool: "free text" },
    { tool: "pod_read\n" },
    { arguments: { secret: "not allowed" } },
    { prompt: "not allowed" },
    { result: "not allowed" },
  ])
    expect(() => checkedRecord({ ...record, ...fields })).toThrow();
});
