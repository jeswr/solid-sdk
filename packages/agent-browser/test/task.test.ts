// AUTHORED-BY Codex GPT-6.1-Sol
import { approvalFor, type ExecutionResult, type Executor } from "@jeswr/site-executor";
import { describe, expect, it, vi } from "vitest";
import { runTask, scriptedPlanner, type TaskExecutor } from "../src/index.js";
import { buy, modelFixture, observations, search } from "./fixtures.js";

const model = modelFixture();
const done: ExecutionResult = { status: "done", observations: [], requests: 1 };
const pending: ExecutionResult = {
  status: "needs-approval",
  observations: [],
  requests: 0,
  approval: approvalFor(
    {
      site: model.site,
      target: {
        kind: "operation",
        id: model.operations[2]?.id ?? "",
        label: "Buy",
        actionType: "https://schema.org/BuyAction",
      },
      effect: "payment",
      inputs: { id: "104" },
      amount: "20.00",
      currency: "GBP",
      summary: "Buy Trail Runner sneakers for GBP 20.00 on shop.test",
      digest: "bound",
    },
    "approval-1",
  ),
};
function executorFor(execute: Executor["execute"]): TaskExecutor {
  return {
    model,
    execute,
    planToRequests: () => ({ status: "planned", requests: [] }),
    approve: vi.fn(() => true),
    reject: vi.fn(() => true),
  };
}

describe("runTask", () => {
  it("redacts data without corrupting JSON structure when a secret is a delimiter", async () => {
    const executor = executorFor(vi.fn());
    executor.redact = (text) => text.replaceAll('"', "[redacted]");
    const trace = await runTask({
      goal: 'Find "',
      model,
      executor,
      approver: () => "deny",
      planner: scriptedPlanner([{ kind: "answer", text: 'Quoted " answer' }]),
    });
    expect(trace.format).toBe("agent-browser-trace/0.1");
    expect(trace.text).toBe("Quoted [redacted] answer");
    expect(JSON.parse(JSON.stringify(trace)).outcome).toBe("answer");
  });
  it("retries exactly the approved RDF action with its approval id and reports timing/tokens", async () => {
    const execute = vi
      .fn<Executor["execute"]>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(done);
    const executor = executorFor(execute);
    const approver = vi.fn(() => "approve" as const);
    const trace = await runTask({
      goal: "Buy",
      executor,
      model,
      approver,
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        { kind: "answer", text: "Purchased." },
      ]),
    });
    expect(trace.format).toBe("agent-browser-trace/0.1");
    expect(trace.outcome).toBe("answer");
    expect(approver).toHaveBeenCalledWith(pending.approval);
    expect(executor.approve).toHaveBeenCalledWith("approval-1");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toBe(execute.mock.calls[0]?.[0]);
    expect(execute.mock.calls[1]?.[1]).toEqual({ approvalId: "approval-1" });
    expect(trace.steps[0]?.statuses).toEqual(["needs-approval", "done"]);
    expect(trace.promptTokensEstimate).toBe(
      trace.steps.reduce((n, s) => n + s.promptTokensEstimate, 0),
    );
    expect(trace.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    "deny",
    { limit: 19.99 },
    { limit: -1 },
    { limit: Number.NaN },
    { limit: Number.POSITIVE_INFINITY },
  ] as const)("denies without retrying for %j", async (decision) => {
    const execute = vi.fn<Executor["execute"]>().mockResolvedValue(pending);
    const executor = executorFor(execute);
    const trace = await runTask({
      goal: "Buy",
      executor,
      model,
      approver: () => decision,
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        { kind: "answer", text: "Denied." },
      ]),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(executor.reject).toHaveBeenCalledWith("approval-1");
    expect(trace.steps[0]?.status).toBe("denied");
  });

  it("allows an inclusive per-action cap and feeds the final result to the planner", async () => {
    const execute = vi
      .fn<Executor["execute"]>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(done);
    await runTask({
      goal: "Buy",
      model,
      executor: executorFor(execute),
      approver: () => ({ limit: 20 }),
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        (input) => {
          expect(input.history.at(-1)?.status).toBe("done");
          return { kind: "answer", text: "Done" };
        },
      ]),
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not consume an approval if the host mutates its callback copy", async () => {
    const execute = vi
      .fn<Executor["execute"]>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(done);
    await runTask({
      goal: "Buy",
      model,
      executor: executorFor(execute),
      maxSteps: 1,
      approver: (a) => {
        a.id = "forged";
        a.amount = "1";
        return "approve";
      },
      planner: scriptedPlanner([{ kind: "act", turtle: buy }]),
    });
    expect(execute.mock.calls[1]?.[1]).toEqual({ approvalId: "approval-1" });
    expect(pending.approval?.amount).toBe("20.00");
  });

  it("feeds parse and execution exceptions back as safe text and continues", async () => {
    const execute = vi
      .fn<Executor["execute"]>()
      .mockRejectedValue(new Error("password=secret Set-Cookie: sid=secret"));
    const trace = await runTask({
      goal: "Read",
      model,
      executor: executorFor(execute),
      approver: () => "deny",
      planner: scriptedPlanner([
        { kind: "act", turtle: "<html>bad" },
        (input) => {
          expect(input.history[0]?.error).toContain("Could not parse");
          expect(JSON.stringify(input)).not.toContain("<html");
          return { kind: "act", turtle: search };
        },
        (input) => {
          expect(input.history[1]?.error).toBe("Executor failed to execute the action.");
          return { kind: "ask", question: "Try again?" };
        },
      ]),
    });
    expect(trace.outcome).toBe("ask");
    expect(JSON.stringify(trace)).not.toContain("secret");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("stops at maxSteps, bounds history and redacts trace and planner inputs", async () => {
    const execute = vi.fn<Executor["execute"]>().mockResolvedValue({
      ...done,
      observations: [
        { operation: "search", status: 200, itemCount: 1, turtle: observations("sid-secret") },
      ],
    });
    const executor = executorFor(execute);
    executor.redact = (text) => text.replaceAll("sid-secret", "[redacted]");
    const trace = await runTask({
      goal: "Read sid-secret",
      model,
      executor,
      maxSteps: 3,
      observationBudget: 500,
      approver: () => "deny",
      planner: {
        async next(input) {
          expect(JSON.stringify(input)).not.toContain("sid-secret");
          expect(input.history.reduce((n, h) => n + h.observations.length, 0)).toBeLessThanOrEqual(
            500,
          );
          return { kind: "act", turtle: search };
        },
      },
    });
    expect(trace.outcome).toBe("maxSteps");
    expect(trace.steps).toHaveLength(3);
    expect(JSON.stringify(trace)).not.toContain("sid-secret");
  });

  it("fails closed on approver exceptions and stops immediately at an answer", async () => {
    const execute = vi.fn<Executor["execute"]>().mockResolvedValue(pending);
    const trace = await runTask({
      goal: "Buy",
      model,
      executor: executorFor(execute),
      approver: () => {
        throw new Error("secret");
      },
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        { kind: "answer", text: "Denied." },
        { kind: "act", turtle: buy },
      ]),
    });
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]?.status).toBe("denied");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
