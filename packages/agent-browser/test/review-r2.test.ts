// AUTHORED-BY Codex GPT-6
import { InMemorySessions } from "@jeswr/site-executor";
import type { Operation } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { createTaskExecutor, runTask, scriptedPlanner } from "../src/index.js";

type Transport = NonNullable<Parameters<typeof createTaskExecutor>[0]["fetch"]>;

import { buy, modelFixture } from "./fixtures.js";

const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
function fixture(payment = false) {
  const model = modelFixture();
  const base = model.operations[2];
  if (!base) throw new Error("Missing fixture operation");
  const op: Operation = {
    ...base,
    effect: payment ? "payment" : "irreversible-write",
    session: "none",
    inputs: [
      {
        name: "qty",
        path: [`${S}orderQuantity`],
        range: `${X}integer`,
        required: true,
        location: "body",
      },
      {
        name: "unused",
        path: [`${S}name`],
        range: `${X}string`,
        required: false,
        location: "body",
      },
      ...(payment
        ? [
            {
              name: "price",
              path: [`${S}price`],
              range: `${X}decimal`,
              required: false,
              default: "20",
              location: "body" as const,
            },
            {
              name: "currency",
              path: [`${S}priceCurrency`],
              range: `${X}string`,
              required: false,
              default: "GBP",
              location: "body" as const,
            },
          ]
        : []),
    ],
    request: {
      method: "POST",
      urlTemplate: "https://SHOP.test:443/checkout?z=2&a=1",
      contentType: "application/json",
      bodyTemplate: payment
        ? '{"qty":{qty},"price":{price},"currency":{currency}}'
        : '{"qty":{qty}}',
    },
    extraction: payment ? { format: "json", itemType: `${S}Order`, fields: [] } : undefined,
  };
  model.operations = [op];
  model.flows = [];
  return { model, op };
}
const action = (qty: string, extra = "") =>
  `[] a schema:BuyAction; schema:orderQuantity ${qty}${extra}.`;

describe("review r2 repeat guard", () => {
  it("blocks canonical duplicate writes with changed typed lexical and unused blank-node inputs", async () => {
    const { model } = fixture();
    const transport = vi.fn<Transport>(async () => Response.json({}));
    const executor = createTaskExecutor({
      model,
      fetch: transport,
      sessions: new InMemorySessions(),
    });
    const plan = vi.spyOn(executor, "planToRequests");
    const trace = await runTask({
      goal: "Create once",
      model,
      executor,
      approver: () => "approve",
      maxSteps: 2,
      planner: scriptedPlanner([
        { kind: "act", turtle: action("1") },
        {
          kind: "act",
          turtle: action('"+01"^^xsd:integer', '; schema:name [schema:name "unused"]'),
        },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual(["done", "repeat-blocked"]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it("blocks a successful charge with malformed JSON after an uncertain receipt", async () => {
    const { model } = fixture(true);
    const transport = vi.fn<Transport>(async () => new Response("malformed"));
    const executor = createTaskExecutor({
      model,
      fetch: transport,
      sessions: new InMemorySessions(),
    });
    const trace = await runTask({
      goal: "Pay once",
      model,
      executor,
      approver: () => ({ limit: 20 }),
      maxSteps: 2,
      planner: scriptedPlanner([
        { kind: "act", turtle: action("1") },
        { kind: "act", turtle: action("1") },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual(["error", "repeat-blocked"]);
    expect(trace.steps[0]?.observations).toContain("sab:Uncertain");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("checks response-bound fingerprints at the write boundary on a repeated flow", async () => {
    const { model, op } = fixture();
    const read: Operation = {
      ...op,
      id: "urn:read",
      actionType: `${S}ViewAction`,
      effect: "read",
      inputs: [],
      request: { method: "GET", urlTemplate: "https://shop.test/item" },
      extraction: {
        format: "json",
        itemType: `${S}Product`,
        fields: [{ property: `${S}identifier`, path: "/id" }],
      },
    };
    op.inputs = [{ name: "qty", path: [], range: `${X}integer`, required: true, location: "body" }];
    model.operations.push(read);
    model.flows = [
      {
        id: "urn:flow",
        actionType: `${S}BuyAction`,
        label: "Create",
        effect: "irreversible-write",
        provenance: op.provenance,
        inputs: [
          {
            name: "unused",
            path: [`${S}name`],
            range: `${X}string`,
            required: false,
            location: "body",
          },
        ],
        steps: [
          { operation: read.id, bind: {} },
          { operation: op.id, bind: { qty: "$step0.schema:identifier" } },
        ],
      },
    ];
    const transport = vi.fn<Transport>(async () => Response.json({ id: "1" }));
    const trace = await runTask({
      goal: "Create once",
      model,
      executor: createTaskExecutor({ model, fetch: transport, sessions: new InMemorySessions() }),
      approver: () => "approve",
      maxSteps: 2,
      planner: scriptedPlanner([
        { kind: "act", turtle: "[] a schema:BuyAction." },
        { kind: "act", turtle: '[] a schema:BuyAction; schema:name "unused".' },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual(["done", "repeat-blocked"]);
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each([
    "denial",
    "approval-limit",
  ])("retains intermediate committed writes after %s", async (stop) => {
    const { model, op } = fixture();
    model.flows = [
      {
        id: "urn:two",
        actionType: op.actionType,
        label: "Create twice",
        effect: op.effect,
        provenance: op.provenance,
        inputs: [],
        steps: [
          { operation: op.id, bind: { qty: "1" } },
          { operation: op.id, bind: { qty: "2" } },
        ],
      },
    ];
    const transport = vi.fn<Transport>(async () => Response.json({}));
    let approvals = 0;
    const trace = await runTask({
      goal: "Create",
      model,
      executor: createTaskExecutor({ model, fetch: transport, sessions: new InMemorySessions() }),
      approver: () => (++approvals === 1 ? "approve" : "deny"),
      maxSteps: 2,
      maxApprovals: stop === "approval-limit" ? 1 : 25,
      planner: scriptedPlanner([
        { kind: "act", turtle: "[] a schema:BuyAction." },
        { kind: "act", turtle: "[] a schema:BuyAction." },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual([
      stop === "denial" ? "denied" : "error",
      "repeat-blocked",
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("surfaces missing required inputs from an IRI-only Buy in planner history", async () => {
    const model = modelFixture();
    // This flow learns a search by product name, not a direct product lookup.
    for (const op of model.operations)
      if (op.actionType.endsWith("BuyAction")) op.actionType = `${S}PayAction`;
    const executor = createTaskExecutor({ model, sessions: new InMemorySessions() });
    const trace = await runTask({
      goal: "Buy",
      model,
      executor,
      approver: () => "deny",
      planner: scriptedPlanner([
        {
          kind: "act",
          turtle: buy.replace(/<https:\/\/shop.test\/product\/104> schema:name[^.]+\./, ""),
        },
        (input) => {
          expect(input.history[0]?.status).toBe("no-path");
          expect(input.history[0]?.error).toContain("name");
          return { kind: "ask", question: "Which product name?" };
        },
      ]),
    });
    expect(trace.outcome).toBe("ask");
    expect(trace.steps[0]?.error).toContain("Missing required inputs: name");
  });
});
