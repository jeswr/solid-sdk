// AUTHORED-BY Codex GPT-6.1-Sol
import type { ExecutionResult } from "@jeswr/site-executor";
import { describe, expect, it, vi } from "vitest";
import type { Fallback, TaskExecutor } from "../src/index.js";
import { runTask, scriptedPlanner } from "../src/index.js";
import { buy, modelFixture } from "./fixtures.js";

const noPath: ExecutionResult = { status: "no-path", requests: 0, observations: [], committed: [] };
describe("fallback task routing", () => {
  it.each([
    "ambiguous",
    "refused",
    "denied",
    "error",
    "done",
  ] as const)("never falls back on %s", async (status) => {
    const model = modelFixture();
    const executor: TaskExecutor = {
      model,
      planToRequests: () => ({ status: "no-path", requests: [] }),
      execute: async () => ({ ...noPath, status }),
    };
    const run = vi.fn<Fallback["run"]>(async () => {
      throw new Error("Must not run");
    });
    await runTask({
      model,
      executor,
      goal: "Test",
      planner: scriptedPlanner([{ kind: "act", turtle: buy }]),
      maxSteps: 1,
      approver: () => "deny",
      fallback: { run },
    });
    expect(run).toHaveBeenCalledTimes(0);
  });
  it.each(["effect", "missing"])("keeps no-path with known %s in the executor", async (known) => {
    const model = modelFixture();
    const executor: TaskExecutor = {
      model,
      planToRequests: () =>
        known === "effect"
          ? { status: "planned", effect: "payment", requests: [] }
          : { status: "no-path", requests: [], missing: ["name"] },
      execute: async () => (known === "effect" ? noPath : { ...noPath, missing: ["name"] }),
    };
    const run = vi.fn<Fallback["run"]>(async () => {
      throw new Error("Must not run");
    });
    const trace = await runTask({
      model,
      executor,
      goal: "Test",
      planner: scriptedPlanner([{ kind: "act", turtle: buy }]),
      maxSteps: 1,
      approver: () => "deny",
      fallback: { run },
    });
    expect(trace.steps[0]?.status).toBe("no-path");
    expect(run).toHaveBeenCalledTimes(0);
  });
});
