// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ExecutionResult } from "@jeswr/site-executor";
import { approvalDigest, effectiveEffect, matchRequest, summarise } from "@jeswr/site-executor";
import { parseActionRequest, renderCatalogue } from "@jeswr/site-model";
import { budgetHistory, plainText, promptFor } from "./planner.js";
import { orderObservations, readQuads, writeQuads } from "./rdf.js";
import type {
  ApprovalDecision,
  PlannerHistory,
  RunTaskOptions,
  TaskTrace,
  TraceStep,
} from "./types.js";

const failure = (error: string): ExecutionResult => ({
  status: "error",
  error,
  observations: [],
  requests: 0,
});

function permits(decision: ApprovalDecision, result: ExecutionResult): boolean {
  if (decision === "approve") return true;
  if (decision === "deny") return false;
  const amount = Number(result.approval?.amount);
  return (
    result.approval?.amount !== undefined &&
    Boolean(result.approval.currency) &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    Number.isFinite(decision.limit) &&
    decision.limit >= 0 &&
    amount <= decision.limit
  );
}

export async function runTask(options: RunTaskOptions): Promise<TaskTrace> {
  const { executor, planner, approver } = options;
  const maxSteps = options.maxSteps ?? 12;
  const budget = options.observationBudget ?? 12_000;
  const maxApprovals = options.maxApprovals ?? 25;
  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 0 ||
    !Number.isSafeInteger(budget) ||
    budget < 0 ||
    !Number.isSafeInteger(maxApprovals) ||
    maxApprovals < 1
  )
    throw new Error("Invalid task bounds.");
  const redact = (text: string) => executor.redact?.(text) ?? text;
  const history: PlannerHistory[] = [];
  const completed = new Map<string, string>();
  const start = performance.now();
  const trace: TaskTrace = {
    format: "agent-browser-trace/0.1",
    goal: redact(options.goal),
    outcome: "maxSteps",
    steps: [],
    promptTokensEstimate: 0,
    elapsedMs: 0,
  };
  for (let index = 0; index < maxSteps; index++) {
    const began = performance.now();
    const input = budgetHistory(
      {
        goal: redact(options.goal),
        catalogue: redact(renderCatalogue(options.model)),
        history: history.map((h) => ({
          ...h,
          request: redact(h.request),
          observations: redact(h.observations),
          ...(h.error ? { error: redact(h.error) } : {}),
        })),
        ...(options.persona ? { persona: redact(options.persona) } : {}),
      },
      budget,
    );
    const step: TraceStep = {
      index: index + 1,
      kind: "error",
      promptTokensEstimate: Math.ceil(promptFor(input).length / 4),
      status: "error",
      statuses: [],
      observations: "",
      elapsedMs: 0,
    };
    trace.steps.push(step);
    trace.promptTokensEstimate += step.promptTokensEstimate;
    try {
      const output = await planner.next(input);
      step.kind = output.kind;
      if (output.kind === "answer" || output.kind === "ask") {
        step.status = output.kind;
        step.statuses.push(output.kind);
        trace.outcome = output.kind;
        trace.text = redact(output.kind === "answer" ? output.text : output.question);
        break;
      }
      step.request = redact(output.turtle);
      let result: ExecutionResult;
      let request: ReturnType<typeof parseActionRequest>;
      try {
        // Parse and serialise, so missing conventional prefix declarations are accepted.
        request = parseActionRequest(writeQuads(readQuads(output.turtle)));
      } catch {
        result = failure(
          "Could not parse the RDF action. Return exactly one schema.org Action node with typed inputs.",
        );
        step.statuses.push(result.status);
        step.error = result.error;
        history.push({
          request: step.request,
          status: result.status,
          observations: "",
          error: result.error,
        });
        continue;
      }
      // Resolve with the executor's matching rules: RDF node labels, property order,
      // omitted defaults and an item's SKU/IRI spelling do not change the action.
      let action: { digest: string; summary: string } | undefined;
      try {
        const match = matchRequest(executor.model, request);
        if (match.kind === "match") {
          const effect = effectiveEffect(executor.model, match.flow, match.operation);
          if (effect !== "read")
            action = {
              digest: approvalDigest({
                site: executor.model.site,
                modelVersion: executor.model.version,
                target: match.target,
                effect,
                inputs: match.inputs,
              }),
              summary: `${summarise(request, match.target, executor.model.site, {})} (${Object.entries(
                match.inputs,
              )
                .map(([name, value]) => `${name}=${value}`)
                .join(", ")})`,
            };
        }
      } catch {
        // Invalid/unmatched actions still go to the executor for its normal safe error.
      }
      const previous = action && completed.get(action.digest);
      if (!options.allowRepeats && previous !== undefined) {
        step.status = "repeat-blocked";
        step.statuses.push(step.status);
        step.error = plainText(
          redact(
            `already done in this task: ${previous}; ask the person if they really want another`,
          ),
        );
        history.push({
          request: step.request,
          status: step.status,
          observations: "",
          error: step.error,
        });
        continue;
      }
      try {
        result = await executor.execute(request);
      } catch {
        result = failure("Executor failed to execute the action.");
      }
      step.statuses.push(result.status);
      let approvalCount = 0;
      while (result.status === "needs-approval" && result.approval) {
        if (approvalCount++ >= maxApprovals) {
          result = failure("Approval limit reached; do not assume the action completed.");
          step.statuses.push(result.status);
          break;
        }
        // Keep the original request and approval id for the retry; the planner cannot edit either.
        const approval = result.approval;
        let decision: ApprovalDecision;
        try {
          decision = await approver(structuredClone(approval));
        } catch {
          decision = "deny";
        }
        const allowed = permits(decision, result);
        step.approval = {
          summary: redact(approval.summary),
          decision:
            typeof decision === "string"
              ? decision
              : Number.isFinite(decision.limit)
                ? { limit: decision.limit }
                : "deny",
          outcome: allowed ? "approved" : "denied",
        };
        step.approvals ??= [];
        step.approvals.push(step.approval);
        if (!allowed) {
          executor.reject?.(approval.id);
          result = {
            status: "denied",
            observations: [],
            requests: 0,
            error: "The user denied this action.",
          };
        } else {
          executor.approve?.(approval.id);
          try {
            result = await executor.execute(request, { approvalId: approval.id });
          } catch {
            result = failure(
              "Executor failed to execute the approved action; do not assume it was completed.",
            );
          }
        }
        step.statuses.push(result.status);
      }
      step.status = result.status;
      if (result.status === "done" && action) completed.set(action.digest, action.summary);
      step.observations = orderObservations(result.observations.map((o) => redact(o.turtle)));
      if (result.error) step.error = plainText(redact(result.error));
      if (result.candidates?.length)
        step.error = `Ambiguous action: ${plainText(redact(result.candidates.join(", ")))}`;
      history.push({
        request: step.request,
        status: step.status,
        observations: step.observations,
        ...(step.error ? { error: step.error } : {}),
      });
    } catch {
      step.error = "Planner failed to return a valid action, answer or question.";
      step.statuses.push("error");
      history.push({ request: "", status: "error", observations: "", error: step.error });
    } finally {
      step.elapsedMs = Math.round(performance.now() - began);
    }
  }
  trace.elapsedMs = Math.round(performance.now() - start);
  // Also cover values learned from refreshed cookies during the final execution.
  // Redact data values, never the JSON's structural keys, enums or delimiters.
  trace.goal = redact(trace.goal);
  if (trace.text !== undefined) trace.text = redact(trace.text);
  for (const step of trace.steps) {
    if (step.request !== undefined) step.request = redact(step.request);
    if (step.error !== undefined) step.error = redact(step.error);
    step.observations = redact(step.observations);
    for (const approval of step.approvals ?? []) approval.summary = redact(approval.summary);
  }
  return trace;
}
