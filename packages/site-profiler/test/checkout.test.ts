// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { buildFlow } from "../src/demonstrations.js";
import { proposeJsonExtraction } from "../src/extraction.js";
import { parseForms } from "../src/forms.js";
import { heuristicLabeller } from "../src/labeller.js";
import { buildOperation } from "../src/operations.js";
import { proposeExtraction } from "../src/profile.js";
import {
  candidateFromForm,
  clusterRequests,
  matchRequest,
  mergeCandidates,
} from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { s, sab } from "../src/util.js";
import { verifyOperations } from "../src/verify.js";

it("recognises the checkout total as one order rather than its product lines", () => {
  const ex = proposeJsonExtraction({
    url: "https://shop.test/checkout",
    totalPaymentDue: "20.00",
    currency: "GBP",
    items: [{ sku: "TRAIL", price: "20" }],
  });
  expect(ex?.itemType).toBe(s("Order"));
  expect(ex?.itemPath).toBeUndefined();
  expect(ex?.fields.some((f) => f.property === s("totalPaymentDue"))).toBe(true);
});

it("learns, verifies and retains a checkout total between the last write and payment with shared delivery", async () => {
  const origin = "https://shop.test";
  const totalBody = JSON.stringify({
    url: `${origin}/checkout`,
    totalPaymentDue: "20.00",
    currency: "GBP",
  });
  function record(
    method: string,
    path: string,
    extra: Partial<RecordedRequest> = {},
  ): RecordedRequest {
    return {
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
    };
  }
  const requests = [
    record("GET", "/api/checkout?delivery=canvas", {
      phase: "probe",
      status: 400,
      bodySample: '{"error":"unknown_delivery"}',
    }),
    record("GET", "/api/search?q=canvas"),
    record("GET", "/api/checkout?delivery=standard", { phase: "crawl", bodySample: totalBody }),
    // This earlier total must not substitute for evidence after the basket write.
    record("GET", "/api/checkout?delivery=standard", { bodySample: totalBody }),
    record("POST", "/api/cart/items", {
      postData: '{"sku":"TRAIL","qty":1}',
      requestHeaders: { "content-type": "application/json" },
    }),
    record("GET", "/api/checkout?delivery=standard", { bodySample: totalBody }),
    record("POST", "/checkout", {
      postData: "delivery=standard",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      status: 303,
    }),
  ];
  const form = parseForms(
    '<form method="post" action="/checkout"><select name="delivery"><option selected>standard</option><option>express</option></select></form>',
    `${origin}/checkout`,
  )[0];
  if (!form) throw new Error("missing payment form");
  const candidates = mergeCandidates([
    ...clusterRequests(requests, origin),
    candidateFromForm(form, `${origin}/checkout`),
  ]);
  const now = () => new Date("2026-11-13T10:00:00Z");
  const ctx = {
    modelId: "urn:model",
    learnedAt: now().toISOString(),
    derivedFrom: [],
    usedIds: new Set<string>(),
    sessionCookies: ["sid"],
  };
  const operations = await Promise.all(
    candidates.map(async (c) =>
      buildOperation(c, await heuristicLabeller.label(c), {
        ...ctx,
        method: "demonstration",
        extraction: proposeExtraction(c),
      }),
    ),
  );
  const calls: string[] = [];
  const verified = await verifyOperations(operations, {
    now,
    haveSession: true,
    recordedRequests: requests,
    replayer: {
      async get(url, { signedIn }) {
        calls.push(url);
        return {
          status: signedIn ? (url.includes("delivery=canvas") ? 400 : 200) : 401,
          body: totalBody,
        };
      },
    },
  });
  expect(verified.warnings).toEqual([]);
  expect(calls).not.toContain(`${origin}/api/checkout?delivery=canvas`);
  const steps = requests
    .filter((r) => r.phase === "demonstration")
    .flatMap((request) => {
      const candidate = candidates.find((c) => matchRequest(c, request));
      const operation = verified.operations.find(
        (op) =>
          op.request.urlTemplate === candidate?.urlTemplate && op.request.method === request.method,
      );
      return candidate && operation
        ? [{ request, operation, values: matchRequest(candidate, request) ?? {} }]
        : [];
    });
  const { flow, warnings } = buildFlow({ name: "buy" }, steps, ctx);
  expect(warnings).toEqual([]);
  expect(
    flow?.steps.map(
      (step) => verified.operations.find((op) => op.id === step.operation)?.request.urlTemplate,
    ),
  ).toEqual([
    `${origin}/api/cart/items`,
    `${origin}/api/checkout{?delivery}`,
    `${origin}/checkout`,
  ]);
  expect(flow?.steps[1]?.bind.delivery).toBe("$input.delivery");
  expect(flow?.steps[2]?.bind.delivery).toBe("$input.delivery");
  expect(flow?.inputs.find((p) => p.name === "delivery")).toMatchObject({
    path: [sab("delivery")],
    example: "standard",
    default: "standard",
    options: ["standard", "express"],
  });
});
