// AUTHORED-BY Codex GPT-6.1-Sol
import { readSiteModel, selectionWitnesses, writeSiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { buildFlow } from "../src/demonstrations.js";
import { heuristicLabeller } from "../src/labeller.js";
import { buildOperation } from "../src/operations.js";
import { proposeExtraction } from "../src/profile.js";
import { learnFilterSelections } from "../src/selection.js";
import { clusterRequests, matchRequest } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { learnDemonstratedForm } from "../src/write-learning.js";

const origin = "https://shop.test",
  s = "https://schema.org/";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fictional fixture value");
  return value;
}
const recorded = (extra: Partial<RecordedRequest>): RecordedRequest => ({
  seq: 1,
  phase: "demonstration",
  demonstration: "delete-own-product",
  method: "GET",
  url: `${origin}/rows?namespace=products&search=EX-42&paging[current]=3&paging[pageSize]=25`,
  resourceType: "xhr",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "application/json",
  bodySample: '{"items":[{"id":"42","sku":"EX-42","name":"Example Widget"}],"totalRecords":1}',
  ...extra,
});
async function fixture(
  body = "excluded=false&filters%5Bplaceholder%5D=true&search=EX-42&namespace=products",
  readNamespace = "products",
) {
  const reads = recorded({
    url: `${origin}/rows?namespace=${readNamespace}&search=EX-42&paging[current]=3&paging[pageSize]=25`,
  });
  const writes = recorded({
    seq: 2,
    method: "POST",
    url: `${origin}/products/massDelete`,
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    postData: body,
    status: 302,
    bodySample: undefined,
    contentType: "text/html",
  });
  const usedIds = new Set<string>();
  const ctx = {
    modelId: "urn:fixture",
    learnedAt: "2026-11-13T00:00:00Z",
    derivedFrom: [],
    usedIds,
    sessionCookies: [],
    method: "demonstration" as const,
  };
  const candidates = clusterRequests([reads, writes], origin).map((c) => learnDemonstratedForm(c));
  const operations = await Promise.all(
    candidates.map(async (c) => {
      const extraction = c.method === "GET" ? proposeExtraction(c) : undefined;
      return buildOperation(c, await heuristicLabeller.label(c), {
        ...ctx,
        ...(extraction ? { extraction } : {}),
      });
    }),
  );
  const write = required(operations.find((op) => op.effect !== "read"));
  const learned = learnFilterSelections(operations, ctx.modelId, usedIds);
  return { ...learned, operations, write, ctx, candidates, reads, writes };
}

it("marks a recorded filter-selected mass write with a flow-only identity and matching grid bindings", async () => {
  const f = await fixture();
  const selected = required(f.selections.get(f.write.id));
  expect(f.write.actionType).toBe(`${s}DeleteAction`);
  expect(selectionWitnesses(f.write)).toHaveLength(1);
  expect(selected.flow.steps).toEqual([
    { operation: selected.read.id, bind: expect.objectContaining({ search: "$input.search" }) },
    {
      operation: f.write.id,
      bind: { search: "$input.search", [selected.witness]: `$step0.${s}identifier` },
    },
  ]);
  expect(selected.flow.inputs.find((p) => p.name === "search")).toMatchObject({
    path: [`${s}query`],
    required: true,
  });
  expect(
    selected.flow.inputs.find((p) => decodeURIComponent(p.name) === "paging[current]")?.default,
  ).toBe("1");
  expect(f.write.request.bodyTemplate).not.toContain(selected.witness);
  const model = {
    id: f.ctx.modelId,
    site: origin,
    version: "1",
    generatedAt: f.ctx.learnedAt,
    operations: f.operations,
    flows: [selected.flow],
  };
  const roundTrip = readSiteModel(await writeSiteModel(model));
  expect(
    selectionWitnesses(required(roundTrip.operations.find((op) => op.id === f.write.id))),
  ).toHaveLength(1);
  expect(roundTrip.flows[0]?.steps).toEqual(selected.flow.steps);
});

it("retains a demonstrated resolver and shares the original filter in a compound Flow", async () => {
  const f = await fixture();
  const steps = [f.reads, f.writes].map((request) => {
    const c = required(f.candidates.find((c) => c.method === request.method));
    const op = required(f.operations.find((op) => op.request.method === request.method));
    return { request, operation: op, values: required(matchRequest(c, request)) };
  });
  const { flow, warnings } = buildFlow({ name: "delete-own-product" }, steps, {
    ...f.ctx,
    selections: f.selections,
  });
  expect(warnings).toEqual([]);
  expect(flow?.steps).toHaveLength(2);
  expect(flow?.steps[1]?.bind.search).toBe(flow?.steps[0]?.bind.search);
  expect(Object.values(flow?.steps[1]?.bind ?? {})).toContain(`$step0.${s}identifier`);
});

it("does not mark explicitly selected IDs as filter-selected", async () => {
  const f = await fixture("selected%5B0%5D=42&search=EX-42&namespace=products");
  expect(f.selections.size).toBe(0);
  expect(selectionWitnesses(f.write)).toEqual([]);
});

it("fails closed when the only grid read belongs to another resource", async () => {
  const f = await fixture(undefined, "orders");
  expect(f.selections.size).toBe(0);
  expect(selectionWitnesses(f.write)).toHaveLength(1);
  expect(f.warnings).toEqual([expect.stringContaining("no unique matching identity read")]);
});

it("marks even an empty demonstrated search as a dynamic selection instead of fixing an all-items write", async () => {
  const f = await fixture(
    "excluded=false&filters%5Bplaceholder%5D=true&search=&namespace=products",
  );
  const selection = required(f.selections.get(f.write.id));
  expect(selectionWitnesses(f.write)).toHaveLength(1);
  expect(selection.flow.inputs.find((p) => p.name === "search")).toMatchObject({ required: true });
  expect(new URLSearchParams(f.write.request.bodyTemplate).get("search")).toBe("{search}");
});

it("keeps witnessed nested filters dynamic, including a non-search selector", async () => {
  const r = recorded({
    method: "POST",
    url: `${origin}/products/massDelete`,
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    postData:
      "filters%5Bsku%5D=EX-42&filters%5Bplaceholder%5D=true&excluded=false&namespace=products",
  });
  const c = learnDemonstratedForm(required(clusterRequests([r], origin)[0]));
  expect(c.params.map((p) => p.name)).toContain("filters.sku");
  expect(new URLSearchParams(c.bodyTemplate).get("filters[sku]")).toBe("{filters.sku}");
});
