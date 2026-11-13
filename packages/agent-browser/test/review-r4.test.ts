// AUTHORED-BY Codex GPT-6
import { InMemorySessions, type SessionProvider } from "@jeswr/site-executor";
import { parseActionRequest } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { createTaskExecutor, runTask, scriptedPlanner } from "../src/index.js";
import { buy, modelFixture } from "./fixtures.js";

type Transport = NonNullable<Parameters<typeof createTaskExecutor>[0]["fetch"]>;
const request = () =>
  parseActionRequest(
    `@prefix schema: <https://schema.org/> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . ${buy}`,
  );

function fixture(uncertain: boolean) {
  const model = modelFixture();
  const pay = model.operations[2];
  if (!pay) throw new Error("Missing fixture");
  pay.session = "none";
  let refreshFailure = false;
  const store = new InMemorySessions();
  const sessions: SessionProvider = {
    get: async (...args) => {
      if (refreshFailure) {
        refreshFailure = false;
        throw new Error("private store secret");
      }
      return store.get(...args);
    },
    update: (...args) => store.update(...args),
  };
  const transport = vi.fn<Transport>(async (_url, init) => {
    if (init?.method === "GET")
      return Response.json({
        items: [{ url: "https://shop.test/product/104", price: "20", currency: "GBP" }],
      });
    refreshFailure = true;
    return uncertain ? new Response("charged", { status: 500 }) : Response.json({ order: "42" });
  });
  return { model, transport, executor: createTaskExecutor({ model, fetch: transport, sessions }) };
}

describe("r4 post-execution refresh", () => {
  it.each([
    false,
    true,
  ])("#5 preserves executor results and reports refresh failure separately (uncertain=%s)", async (uncertain) => {
    const { executor } = fixture(uncertain);
    const first = await executor.execute(request());
    executor.approve?.(first.approval?.id ?? "");
    const result = await executor.execute(request(), { approvalId: first.approval?.id });
    expect(result.status).toBe(uncertain ? "error" : "done");
    expect(result.committed).toHaveLength(1);
    expect(result.outcome?.status).toBe(uncertain ? "uncertain" : "completed");
    expect(result).toMatchObject({
      refreshError: "Session secret refresh failed after execution.",
    });
    expect(JSON.stringify(result)).not.toContain("private store secret");
  });

  it.each([
    false,
    true,
  ])("#5 blocks repeats after a post-execution refresh failure (uncertain=%s)", async (uncertain) => {
    const { executor, model, transport } = fixture(uncertain);
    const trace = await runTask({
      goal: "Buy once",
      executor,
      model,
      approver: () => "approve",
      maxSteps: 2,
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        { kind: "act", turtle: buy },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual([
      uncertain ? "error" : "done",
      "repeat-blocked",
    ]);
    expect(trace.steps[0]).toMatchObject({
      refreshError: "Session secret refresh failed after execution.",
    });
    expect(trace.steps[0]?.observations).toContain(uncertain ? "sab:Uncertain" : "sab:Completed");
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
