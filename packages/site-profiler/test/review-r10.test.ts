// AUTHORED-BY Codex GPT-6.1-Sol
import { createApprovalGate, createExecutor, InMemorySessions } from "@jeswr/site-executor";
import { readSiteModel, SCHEMA, writeSiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { heuristicLabeller } from "../src/labeller.js";
import { buildOperation } from "../src/operations.js";
import { proposeExtraction } from "../src/profile.js";
import { learnFilterSelections } from "../src/selection.js";
import { clusterRequests } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { learnDemonstratedForm } from "../src/write-learning.js";

const origin = "https://shop.test";
const record = (changes: Partial<RecordedRequest>): RecordedRequest => ({
  seq: 0,
  phase: "demonstration",
  method: "GET",
  url: origin,
  resourceType: "xhr",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "application/json",
  ...changes,
});
const row = (id: number) => ({ id: String(id), sku: `EX-${id}`, name: `Example Widget ${id}` });

it.each([
  ["page", 0, 1, false],
  ["page", 1, 2, false],
  ["offset", 0, 1, false],
  ["page", 0, 1, true],
  ["offset", 0, 1, true],
  ["page", 3, 4, true],
])("r10 preserves learned %s start %s and probes observed continuation %s (empty=%s)", async (kind, start, continuation, empty) => {
  const query = (position: number) =>
    `${origin}/products?search=EX&excluded=false&${kind}=${position}&limit=25`;
  const records = [
    record({ url: query(start), bodySample: JSON.stringify({ items: [row(42)] }) }),
    record({
      seq: 1,
      url: query(continuation),
      bodySample: JSON.stringify({ items: empty ? [] : [row(43)] }),
    }),
    record({
      seq: 2,
      method: "POST",
      url: `${origin}/products/massDelete`,
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      postData: "search=EX&excluded=false",
      status: 302,
      contentType: "text/html",
    }),
  ];
  const ctx = {
    modelId: "urn:fixture",
    learnedAt: "2026-11-13T00:00:00Z",
    derivedFrom: [],
    usedIds: new Set<string>(),
    sessionCookies: [],
    method: "demonstration" as const,
  };
  const candidates = clusterRequests(records, origin).map((c) => learnDemonstratedForm(c));
  const operations = await Promise.all(
    candidates.map(async (c) =>
      buildOperation(c, await heuristicLabeller.label(c), {
        ...ctx,
        extraction: c.method === "GET" ? proposeExtraction(c) : undefined,
      }),
    ),
  );
  const { selections } = learnFilterSelections(operations, ctx.modelId, ctx.usedIds);
  const selection = [...selections.values()][0];
  if (!selection) throw new Error("Missing selection fixture");
  expect(selection.flow.inputs.find((p) => p.name === kind)?.default).toBe(String(start));
  const model = readSiteModel(
    await writeSiteModel({
      id: ctx.modelId,
      site: origin,
      version: "1",
      generatedAt: ctx.learnedAt,
      operations,
      flows: [selection.flow],
    }),
  );
  const gate = createApprovalGate();
  const positions: string[] = [];
  let writes = 0;
  const executor = createExecutor({
    model,
    gate,
    sessions: new InMemorySessions(),
    fetch: async (input, init) => {
      if (init?.method === "POST") {
        writes++;
        return new Response("saved");
      }
      const position = new URL(String(input)).searchParams.get(kind) ?? "missing";
      positions.push(position);
      return Response.json({
        items:
          position === String(start)
            ? [row(42)]
            : position === String(continuation)
              ? empty
                ? []
                : [row(43)]
              : [],
      });
    },
  });
  const request = {
    node: "urn:delete",
    types: [`${SCHEMA}DeleteAction`],
    values: (path: string[]) =>
      path[0] === `${SCHEMA}query`
        ? ["EX"]
        : path[0] === "https://jeswr.org/ns/site-action#excluded"
          ? ["false"]
          : [],
  };
  const result = await executor.execute(request);
  const complete = empty && start !== 3;
  expect(result.status, JSON.stringify({ result, flow: selection.flow })).toBe(
    complete ? "needs-approval" : "refused",
  );
  expect(positions).toEqual(start === 3 ? ["3"] : [String(start), String(continuation)]);
  if (result.approval) {
    gate.approve(result.approval.id);
    expect((await executor.execute(request, { approvalId: result.approval.id })).status).toBe(
      "error",
    );
    expect(positions).toEqual([
      String(start),
      String(continuation),
      String(start),
      String(continuation),
    ]);
  } else expect(result.errorKind).toBe("ambiguous-target");
  expect(writes).toBe(complete ? 1 : 0);
});

it("r10 refuses completeness when continuation was never witnessed", async () => {
  const c = clusterRequests(
    [
      record({
        url: `${origin}/products?search=EX&page=0`,
        bodySample: '{"items":[{"id":"42","name":"Example Widget"}]}',
      }),
    ],
    origin,
  )[0];
  if (!c) throw new Error("Missing fixture");
  const op = buildOperation(c, await heuristicLabeller.label(c), {
    modelId: "urn:fixture",
    usedIds: new Set(),
    learnedAt: "2026-11-13T00:00:00Z",
    derivedFrom: [],
    method: "crawl",
    sessionCookies: [],
    extraction: proposeExtraction(c),
  });
  expect(op.inputs.find((p) => p.name === "page")).toMatchObject({ default: "0" });
  expect(op.inputs.find((p) => p.name === "page")?.description).toBeUndefined();
});
