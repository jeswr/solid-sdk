// AUTHORED-BY Codex GPT-6
import type { AuditRecord, AuditWriter, LedgerEntry } from "@jeswr/agent-audit";

export interface TaskContext {
  readonly taskId: string;
  readonly conversation: string;
  readonly agent: string;
  readonly owner: string;
}
/** Structural subset of the gateway's ModelCall: no SDK or gateway dependency is needed. */
export type ModelCallCounters = Readonly<
  Required<
    Pick<
      AuditRecord,
      | "id"
      | "context"
      | "provider"
      | "model"
      | "inputTokens"
      | "outputTokens"
      | "toolCalls"
      | "latencyMs"
      | "retries"
    >
  >
>;

/** Runtime-owned instrumentation, with no authority, model invocation or send capability. */
export class TaskRecorder {
  private readonly context: TaskContext;
  constructor(
    context: TaskContext,
    private readonly writer: Pick<AuditWriter, "append">,
  ) {
    // Snapshot trusted runtime context; callers cannot later reassign a task's identity.
    this.context = {
      taskId: context.taskId,
      conversation: context.conversation,
      agent: context.agent,
      owner: context.owner,
    };
  }

  append(record: Omit<AuditRecord, keyof TaskContext>, at: string): Promise<LedgerEntry> {
    return this.writer.append({ ...record, ...this.context }, at);
  }

  /** Also accepts counters from GatewayError.calls; never copy a prompt or response. */
  modelCall(call: ModelCallCounters, at: string): Promise<LedgerEntry> {
    return this.append(
      {
        type: "model-call",
        id: call.id,
        context: call.context,
        provider: call.provider,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        toolCalls: call.toolCalls,
        latencyMs: call.latencyMs,
        retries: call.retries,
      },
      at,
    );
  }
}
