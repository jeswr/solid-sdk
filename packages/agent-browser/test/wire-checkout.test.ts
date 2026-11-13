// AUTHORED-BY Codex GPT-6
import { InMemorySessions } from "@jeswr/site-executor";
import { readSiteModel, type SiteModel, writeSiteModel } from "@jeswr/site-model";
import {
  buildFlow,
  buildOperation,
  candidateFromForm,
  clusterRequests,
  heuristicLabeller,
  matchRequest,
  mergeCandidates,
  parseForms,
  proposeExtraction,
  type RecordedRequest,
} from "@jeswr/site-profiler";
import { expect, it, vi } from "vitest";
import { createTaskExecutor, runTask, scriptedPlanner } from "../src/index.js";

type Transport = NonNullable<Parameters<typeof createTaskExecutor>[0]["fetch"]>;
const origin = "https://shop.test";

it("Rule W executes the learned test-shop checkout with delivery and csrf_token for GBP 20.00", async () => {
  const total = { url: `${origin}/checkout`, totalPaymentDue: "20.00", currency: "GBP" };
  const formHtml =
    '<form method="post" action="/checkout"><input type="hidden" name="csrf_token" value="token-secret"><select name="delivery"><option selected>standard</option><option>express</option></select></form>';
  const record = (
    method: string,
    path: string,
    extra: Partial<RecordedRequest> = {},
  ): RecordedRequest => ({
    seq: 0,
    phase: "demonstration",
    method,
    url: `${origin}${path}`,
    resourceType: "xhr",
    requestHeaders: {},
    cookieNames: ["sid"],
    status: 200,
    contentType: "application/json",
    ...extra,
  });
  const requests = [
    record("GET", "/api/products/104", {
      bodySample: JSON.stringify({
        url: `${origin}/product/104`,
        sku: "TRAIL",
        price: "20.00",
        currency: "GBP",
      }),
    }),
    record("POST", "/api/cart/items", {
      postData: '{"sku":"TRAIL","qty":1}',
      requestHeaders: { "content-type": "application/json" },
    }),
    record("GET", "/api/checkout?delivery=standard", { bodySample: JSON.stringify(total) }),
    record("POST", "/checkout", {
      postData: "delivery=standard&csrf_token=[redacted]",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      status: 303,
    }),
  ];
  const form = parseForms(formHtml, `${origin}/checkout`)[0];
  if (!form) throw new Error("Missing checkout form");
  const candidates = mergeCandidates([
    ...clusterRequests(requests, origin),
    candidateFromForm(form, `${origin}/checkout`),
  ]);
  const ctx = {
    modelId: "urn:learned-shop",
    learnedAt: "2026-11-13T10:00:00Z",
    derivedFrom: [],
    usedIds: new Set<string>(),
    sessionCookies: ["sid"],
  };
  const operations = await Promise.all(
    candidates.map(async (candidate) =>
      buildOperation(candidate, await heuristicLabeller.label(candidate), {
        ...ctx,
        method: "demonstration",
        extraction: proposeExtraction(candidate),
      }),
    ),
  );
  const steps = requests.map((request) => {
    const candidate = candidates.find((c) => matchRequest(c, request));
    const operation = operations.find(
      (op) =>
        op.request.urlTemplate === candidate?.urlTemplate && op.request.method === request.method,
    );
    if (!candidate || !operation) throw new Error("Missing learned operation");
    return { request, operation, values: matchRequest(candidate, request) ?? {} };
  });
  const { flow, warnings } = buildFlow({ name: "buy" }, steps, ctx);
  expect(warnings).toEqual([]);
  if (!flow) throw new Error("Missing learned buy flow");
  const learned: SiteModel = {
    id: ctx.modelId,
    site: origin,
    version: "1",
    generatedAt: ctx.learnedAt,
    operations,
    flows: [flow],
  };
  const model = readSiteModel(await writeSiteModel(learned));
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: [
      { name: "sid", value: "session-secret", domain: "shop.test", path: "/", secure: true },
    ],
  });
  const transport = vi.fn<Transport>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/products/104")
      return Response.json({
        url: `${origin}/product/104`,
        sku: "TRAIL",
        price: "20.00",
        currency: "GBP",
      });
    if (url.pathname === "/api/checkout") {
      expect(url.searchParams.get("delivery")).toBe("standard");
      return Response.json(total);
    }
    if (url.pathname === "/checkout" && init?.method === "GET") return new Response(formHtml);
    if (url.pathname === "/checkout") {
      const body = new URLSearchParams(String(init?.body));
      expect([...body].sort()).toEqual([
        ["csrf_token", "token-secret"],
        ["delivery", "standard"],
      ]);
    }
    return Response.json({});
  });
  const approver = vi.fn(() => ({ limit: 20 }));
  const trace = await runTask({
    goal: "Buy one item",
    model,
    executor: createTaskExecutor({ model, sessions, fetch: transport }),
    approver,
    planner: scriptedPlanner([
      {
        kind: "act",
        turtle: `[] a schema:BuyAction; schema:object <${origin}/product/104>; schema:price "20"; schema:priceCurrency "GBP".`,
      },
      { kind: "answer", text: "Bought it." },
    ]),
  });
  expect(trace.steps[0]?.status, trace.steps[0]?.error).toBe("done");
  expect(approver).toHaveBeenCalledTimes(2);
  expect(
    trace.steps[0]?.approvals?.every((approval) => approval.summary.includes("for GBP 20.00")),
  ).toBe(true);
  expect(
    transport.mock.calls.filter(
      ([input, init]) => new URL(String(input)).pathname === "/checkout" && init?.method === "POST",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(trace)).not.toContain("token-secret");
});
