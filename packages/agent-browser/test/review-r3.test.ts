// AUTHORED-BY Codex GPT-6
import { InMemorySessions } from "@jeswr/site-executor";
import { parseActionRequest } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { createTaskExecutor, runTask, scriptedPlanner } from "../src/index.js";
import { buy, modelFixture } from "./fixtures.js";

type Transport = NonNullable<Parameters<typeof createTaskExecutor>[0]["fetch"]>;

describe("r3 task commitment memory", () => {
  it.each([
    "500",
    "reset",
    "timeout",
    "extraction",
    "400",
  ])("#5 blocks uncertain repeats but allows a failed 4xx (%s)", async (mode) => {
    const model = modelFixture();
    const pay = model.operations[2];
    if (!pay) throw new Error("Missing fixture");
    pay.session = "none";
    const transport = vi.fn<Transport>(async (_url, init) => {
      if (init?.method === "GET")
        return Response.json({
          items: [
            {
              url: "https://shop.test/product/104",
              name: "Trail Runner sneakers",
              price: "20",
              currency: "GBP",
            },
          ],
        });
      if (mode === "reset") throw new Error("reset");
      if (mode === "timeout") return await new Promise(() => {});
      return new Response("charged", { status: mode === "500" ? 500 : mode === "400" ? 400 : 200 });
    });
    const executor = createTaskExecutor({
      model,
      fetch: transport,
      sessions: new InMemorySessions(),
      maxExecutionMs: mode === "timeout" ? 200 : 5000,
    });
    const trace = await runTask({
      goal: "Pay once",
      model,
      executor,
      approver: () => ({ limit: 20 }),
      maxSteps: 2,
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        { kind: "act", turtle: buy },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual([
      "error",
      mode === "400" ? "error" : "repeat-blocked",
    ]);
    expect(trace.steps[0]?.observations).toContain(mode === "400" ? "sab:Failed" : "sab:Uncertain");
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      mode === "400" ? 2 : 1,
    );
  });

  it("#5 permits host recovery only for explicitly listed fingerprints", async () => {
    const model = modelFixture();
    const pay = model.operations[2];
    if (!pay) throw new Error("Missing fixture");
    pay.session = "none";
    const transport = vi.fn<Transport>(async (_url, init) =>
      init?.method === "GET"
        ? Response.json({
            items: [
              {
                url: "https://shop.test/product/104",
                name: "Trail Runner sneakers",
                price: "20",
                currency: "GBP",
              },
            ],
          })
        : new Response("charged", { status: 500 }),
    );
    const executor = createTaskExecutor({
      model,
      fetch: transport,
      sessions: new InMemorySessions(),
    });
    const fingerprint = executor
      .planToRequests(
        parseActionRequest(
          `@prefix schema: <https://schema.org/> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . ${buy}`,
        ),
      )
      .requests.at(-1)?.fingerprint;
    expect(fingerprint).toBeTruthy();
    const trace = await runTask({
      goal: "Recover payment",
      model,
      executor,
      approver: () => "approve",
      maxSteps: 2,
      allowRetryOf: fingerprint ? [fingerprint] : [],
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        { kind: "act", turtle: buy },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual(["error", "error"]);
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
});
