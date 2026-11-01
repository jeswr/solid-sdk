// AUTHORED-BY Codex GPT-6
import {
  AuditWriter,
  aggregateTaskStats,
  loadTrace,
  MemoryLedger,
  PodMirror,
} from "@jeswr/agent-audit";
import { createMemoryAuditPod } from "@jeswr/agent-audit/testing";
import type { ModelCallCounters, TaskContext } from "@jeswr/app-agent-daemon";
import { expect, it } from "vitest";
import { TaskRecorder } from "../src/instrumentation.js";

const AT = "2026-11-01T12:00:00.000Z";
const context: TaskContext = {
  taskId: "paper-mortgage-1",
  conversation: "urn:conversation:1",
  agent: "https://pod.example/agent#me",
  owner: "https://pod.example/profile#me",
};
function fixture() {
  const ledger = new MemoryLedger();
  const pod = createMemoryAuditPod();
  const writer = new AuditWriter(ledger, new PodMirror(pod.fetch, "https://pod.example/"));
  return { ledger, pod, recorder: new TaskRecorder(context, writer) };
}

it("propagates the conversation task to proposals and transmissions in the ledger and PROV mirror", async () => {
  const { ledger, pod, recorder } = fixture();
  await recorder.append({ type: "conversation", id: context.conversation }, AT);
  await recorder.append({ type: "proposal", id: "urn:proposal:1" }, AT);
  await recorder.append(
    { type: "transmission", id: "urn:transmission:1", proposal: "urn:proposal:1", status: "sent" },
    AT,
  );
  const entries = ledger.entries();
  expect(entries.map((e) => e.record.type)).toEqual(["conversation", "proposal", "transmission"]);
  for (const entry of entries) expect(entry.record).toMatchObject(context);
  expect((await loadTrace(pod.fetch, "https://pod.example/")).entries).toEqual(entries);
  expect(aggregateTaskStats(entries).tasks.map((task) => task.taskId)).toEqual([context.taskId]);
});

it("projects only gateway counters, including failed-call counters, into the assigned task", async () => {
  const { ledger, recorder } = fixture();
  const call = {
    id: "urn:model-call:1",
    context: "proposer",
    provider: "anthropic",
    model: "claude-test",
    inputTokens: 40,
    outputTokens: 10,
    tokens: { input: 40, output: 10 },
    toolCalls: 1,
    latencyMs: 25,
    retries: 2,
    prompt: "SYNTHETIC_PRIVATE_PROMPT",
    response: "SYNTHETIC_PRIVATE_RESPONSE",
    taskId: "model-selected-task",
    conversation: "urn:model-selected-conversation",
  } as const;
  const counters: ModelCallCounters = call;
  await recorder.modelCall(counters, AT);
  // GatewayError.calls uses the same structural counters, even after a provider failure.
  await recorder.modelCall(
    { ...call, id: "urn:model-call:failed", inputTokens: 0, outputTokens: 0, toolCalls: 0 },
    AT,
  );
  await recorder.append(
    {
      type: "tool-call",
      id: "urn:tool-call:1",
      modelCall: call.id,
      tool: "pod_read",
      latencyMs: 5,
    },
    AT,
  );
  await recorder.append(
    {
      type: "decision",
      id: "urn:decision:1",
      proposal: "urn:proposal:1",
      decision: "confirm-required",
    },
    AT,
  );
  expect(ledger.entries()[0]?.record).toEqual({
    ...context,
    type: "model-call",
    id: call.id,
    context: "proposer",
    provider: "anthropic",
    model: "claude-test",
    inputTokens: 40,
    outputTokens: 10,
    toolCalls: 1,
    latencyMs: 25,
    retries: 2,
  });
  expect(JSON.stringify(ledger.entries())).not.toContain("SYNTHETIC_PRIVATE");
  expect(aggregateTaskStats(ledger.entries()).tasks[0]).toMatchObject({
    taskId: context.taskId,
    modelCalls: 2,
    toolCalls: 1,
    tokens: 50,
    inputTokens: 40,
    outputTokens: 10,
    humanInterrupts: 1,
    retries: 4,
  });
});

it("snapshots trusted context and prevents event fields from overriding it", async () => {
  const { ledger, pod } = fixture();
  const mutable = { ...context };
  const writer = new AuditWriter(ledger, new PodMirror(pod.fetch, "https://pod.example/"));
  const recorder = new TaskRecorder(mutable, writer);
  mutable.taskId = "changed";
  mutable.conversation = "urn:changed";
  const event = {
    type: "proposal",
    id: "urn:proposal:1",
    taskId: "forged",
    conversation: "urn:forged",
    agent: "urn:forged:agent",
    owner: "urn:forged:owner",
  } as const;
  await recorder.append(event, AT);
  expect(ledger.entries()[0]?.record).toMatchObject(context);
});

it("preserves audit validation and fail-closed mirror errors", async () => {
  const { ledger, recorder } = fixture();
  expect(() =>
    recorder.append({ type: "tool-call", id: "urn:tool:1", tool: "private arguments" }, AT),
  ).toThrow();
  expect(ledger.entries()).toEqual([]);
  const writer = new AuditWriter(
    ledger,
    new PodMirror(async () => {
      throw new Error("synthetic I/O failure");
    }, "https://pod.example/"),
  );
  const unavailable = new TaskRecorder(context, writer);
  await expect(unavailable.append({ type: "proposal", id: "urn:proposal:1" }, AT)).rejects.toThrow(
    "synthetic I/O failure",
  );
  expect(ledger.entries()).toHaveLength(1);
  expect(ledger.entries()[0]?.record).toMatchObject(context);
});
