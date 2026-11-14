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
  ["ok false", { items: [], ok: false, message: "query temporarily unavailable" }, {}, false],
  ["success false", { items: [], success: false }, {}, false],
  ["exception", { items: [], exception: "query temporarily unavailable" }, {}, false],
  ["validationErrors", { items: [], validationErrors: ["invalid filter"] }, {}, false],
  ["error", { items: [], error: "unavailable" }, {}, false],
  ["errors", { items: [], errors: ["unavailable"] }, {}, false],
  ["status fail", { items: [], status: "fail" }, {}, false],
  ["changed envelope", { items: [], message: "query temporarily unavailable" }, {}, false],
  ["missing success key", { items: [] }, { ok: true }, false],
  ["matching success envelope", { items: [], ok: true }, { ok: true }, true],
  ["matching bare envelope", { items: [] }, {}, true],
  ["error only on approval retry", { items: [] }, {}, true],
  ["nested changed inner envelope", { data: { items: [], message: "unavailable" } }, {}, false],
  ["nested changed outer envelope", { data: { items: [] }, message: "unavailable" }, {}, false],
  ["nested matching envelope", { data: { items: [] } }, {}, true],
])("r11 exhaustion requires the first-page success envelope: %s", async (_name, probe, firstExtra, accepted) => {
  const kind = "page",
    start = 0,
    continuation = 1,
    empty = true;
  const query = (position: number) =>
    `${origin}/products?search=EX&excluded=false&${kind}=${position}&limit=25`;
  const firstPage = (items: ReturnType<typeof row>[]) =>
    _name.startsWith("nested") ? { data: { items } } : { items, ...firstExtra };
  const records = [
    record({ url: query(start), bodySample: JSON.stringify(firstPage([row(42)])) }),
    record({
      seq: 1,
      url: query(continuation),
      bodySample: JSON.stringify(firstPage(empty ? [] : [row(43)])),
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
  let retry = false;
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
      return Response.json(
        position === String(start)
          ? firstPage([row(42)])
          : retry && _name === "error only on approval retry"
            ? { items: [], ok: false, message: "query temporarily unavailable" }
            : probe,
      );
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
  expect(result.status, JSON.stringify(result)).toBe(accepted ? "needs-approval" : "refused");
  if (accepted && result.approval) {
    retry = true;
    gate.approve(result.approval.id);
    expect((await executor.execute(request, { approvalId: result.approval.id })).status).toBe(
      _name === "error only on approval retry" ? "refused" : "done",
    );
  } else expect(result.errorKind).toBe("ambiguous-target");
  expect(writes).toBe(accepted && _name !== "error only on approval retry" ? 1 : 0);
});

it.each([
  "",
  "/data",
  "/data/result",
  "/a~1b/~0payload",
])("r11 checks failure markers on every envelope ancestor (%s)", async (prefix) => {
  const { extract } = await import("@jeswr/site-executor");
  const segments = prefix
    .split("/")
    .slice(1)
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  const wrap = (value: unknown) => segments.reduceRight((v, key) => ({ [key]: v }), value);
  const ex = {
    format: "json" as const,
    itemPath: `${prefix}/items`,
    itemType: `${SCHEMA}Product`,
    fields: [],
  };
  for (const failure of [
    { ok: false },
    { exception: "unavailable" },
    { validationErrors: ["bad"] },
    { status: "fail" },
  ]) {
    const output = await extract(ex, JSON.stringify(wrap({ items: [], ...failure })), {
      baseUrl: origin,
      redact: (s) => s,
    });
    expect(output.collectionState).toBe("invalid");
  }
  const output = await extract(ex, JSON.stringify(wrap({ items: [] })), {
    baseUrl: origin,
    redact: (s) => s,
  });
  expect(output.collectionState).toBe("empty");
});

it("r11 retains exhaustion envelope keys only for an actual first-page collection", async () => {
  const { extract } = await import("@jeswr/site-executor");
  const extraction = {
    format: "json" as const,
    itemType: `${SCHEMA}Product`,
    fields: [{ property: `${SCHEMA}identifier`, path: "/id" }],
  };
  const options = { baseUrl: origin, redact: (s: string) => s };
  expect(
    (await extract(extraction, JSON.stringify(row(42)), options)).envelopeKeys,
  ).toBeUndefined();
  expect((await extract(extraction, JSON.stringify([row(42)]), options)).envelopeKeys).toEqual([]);
});
