// AUTHORED-BY Codex GPT-6.1-Sol
import { InMemorySessions } from "@jeswr/site-executor";
import {
  type ActionRequest,
  SAB,
  SCHEMA,
  type SiteModel,
  validateSiteModel,
} from "@jeswr/site-model";
import type { RecordedRequest } from "@jeswr/site-profiler";
import { describe, expect, it, vi } from "vitest";
import { candidatesFromTrace, learnFallback } from "../src/fallback/learn.js";

const origin = "https://shop.test";
const model: SiteModel = {
  id: "urn:shop:model",
  site: origin,
  version: "0.1.0",
  generatedAt: "2026-11-13T00:00:00.000Z",
  operations: [],
  flows: [],
};
const request: ActionRequest = {
  node: "urn:request",
  types: [`${SCHEMA}ViewAction`],
  values: () => [],
};
const entry = (seq: number, changes: Partial<RecordedRequest> = {}): RecordedRequest => ({
  seq,
  phase: "crawl",
  method: "GET",
  url: `${origin}/orders`,
  resourceType: "document",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "application/json",
  bodySample: JSON.stringify({ items: [{ orderNumber: "5010", total: "18.50", currency: "GBP" }] }),
  ...changes,
});
const candidates = (trace: RecordedRequest[], approved = new Set<number>()) =>
  candidatesFromTrace(trace, origin, [], approved, (s) => s);

describe("fallback learning admission", () => {
  it("excludes aborted, off-origin, unapproved and unsuccessful traffic and unwitnessed forms", () => {
    const trace = [
      entry(0, { blocked: true }),
      entry(1, { url: "https://elsewhere.test/orders" }),
      entry(2, { status: 500 }),
      entry(3, { method: "POST" }),
      entry(4, {
        contentType: "text/html",
        bodySample:
          '<form method="post" action="/address"><input name="streetAddress"><button>Save</button></form>',
      }),
    ];
    expect(candidates(trace).every((c) => c.method === "GET")).toBe(true);
    expect(
      candidates(trace)
        .flatMap((c) => c.samples)
        .map((r) => r.seq),
    ).toEqual([4]);
  });
  it("turns repeated per-session URL tokens into cookie-backed slots, never constants or inputs", () => {
    const token = "opaque-session-material-12345";
    const trace = [
      entry(0, { url: `${origin}/data/${token}/orders?session=${token}` }),
      entry(1, { url: `${origin}/data/${token}/orders?session=${token}` }),
    ];
    const learned = candidatesFromTrace(
      trace,
      origin,
      [{ name: "sid", value: token }],
      new Set(),
      (s) => s,
    );
    const candidate = learned[0];
    expect(candidate?.urlTemplate).toContain("{sessionPath");
    expect(candidate?.params).toEqual([]);
    expect(candidate?.csrf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: { kind: "cookie", name: "sid" } }),
      ]),
    );
    expect(JSON.stringify(learned)).not.toContain(token);
  });
  it("only admits a read after the executor replay extracts at least one item", async () => {
    const proposed = candidates([entry(0)]);
    const transport = vi.fn(async () =>
      Response.json({ items: [{ orderNumber: "5010", total: "18.50", currency: "GBP" }] }),
    );
    const result = await learnFallback({
      model,
      request,
      sessions: new InMemorySessions(),
      transport,
      driver: { candidates: async () => structuredClone(proposed) },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.proposed).toHaveLength(1);
    expect(result.proposed[0]?.provenance).toMatchObject({
      method: "fallback",
      attempts: 1,
      successes: 1,
    });
    expect(result.observations[0]?.itemCount).toBe(1);
    expect(validateSiteModel(result.model)).toEqual([]);
    expect(model.operations).toEqual([]);
  });
  it.each([
    200, 500,
  ])("rejects a read whose replay extracts nothing or fails (HTTP %s)", async (status) => {
    const proposed = candidates([entry(0)]);
    const transport = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await learnFallback({
      model,
      request,
      sessions: new InMemorySessions(),
      transport,
      driver: { candidates: async () => structuredClone(proposed) },
    });
    expect(result.proposed).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("replay");
  });
  it("admits only an approved write, removes demonstrated personal values, never verifies it, and infers no flow", async () => {
    const trace = [
      entry(0, {
        contentType: "text/html",
        bodySample:
          '<form method="post" action="/account/address"><input type="hidden" name="csrf_token" value="session-csrf-example"><input name="streetAddress" required><button>Save address</button></form>',
      }),
      entry(1, {
        url: `${origin}/account/address`,
        method: "POST",
        status: 303,
        bodySample: undefined,
        contentType: "text/html",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        postData: "streetAddress=12+Example+Lane&csrf_token=%5Bredacted%5D",
      }),
    ];
    const proposed = candidates(trace, new Set([1]));
    const transport = vi.fn(async () => {
      throw new Error("Writes must never be replayed");
    });
    const result = await learnFallback({
      model,
      request: { ...request, types: [`${SCHEMA}UpdateAction`] },
      sessions: new InMemorySessions(),
      transport,
      driver: { candidates: async () => structuredClone(proposed) },
    });
    expect(result.proposed).toHaveLength(1);
    expect(result.proposed[0]?.effect).toBe("irreversible-write");
    expect(result.proposed[0]?.label).toBe("Update address");
    expect(result.proposed[0]?.inputs[0]?.path).toEqual([`${SAB}streetAddress`]);
    expect(result.proposed[0]?.provenance.lastVerified).toBeUndefined();
    expect(JSON.stringify(result.model)).not.toContain("12 Example Lane");
    expect(JSON.stringify(result.model)).not.toContain("session-csrf-example");
    expect(result.model.flows).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(0);
  });
});

it("browser fingerprints equal executor fingerprints for typed form lexicals and session slots", async () => {
  const { browserWriteFingerprint } = await import("../src/fallback/fingerprint.js");
  const { compileOperation, requestFingerprint } = await import("@jeswr/site-executor");
  const { buildOperation, parseForms } = await import("@jeswr/site-profiler");
  const token = "opaque-session-material-12345";
  const form = parseForms(
    '<form method="post" action="/data/opaque-session-material-12345/address"><input type="number" name="qty"><input type="hidden" name="csrf_token" value="csrf-example"><button>Save</button></form>',
    `${origin}/address`,
  );
  const write = entry(1, {
    url: `${origin}/data/${token}/address`,
    method: "POST",
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    postData: "qty=01&csrf_token=csrf-example",
    bodySample: undefined,
  });
  const tokens = new Map([[token, { kind: "cookie" as const, name: "sid" }]]);
  const fingerprint = browserWriteFingerprint(write, origin, form, tokens);
  // The same operation learned from the full recorded run, with the CSRF page as evidence.
  const source = entry(0, {
    url: `${origin}/address`,
    contentType: "text/html",
    bodySample:
      '<form method="post" action="/data/opaque-session-material-12345/address"><input type="number" name="qty"><input type="hidden" name="csrf_token" value="csrf-example"><button>Save</button></form>',
  });
  const cs = candidatesFromTrace(
    [source, write, { ...write, seq: 2 }],
    origin,
    [{ name: "sid", value: token }],
    new Set([1, 2]),
    (s) => s,
  );
  const candidate = cs.find((c) => c.method === "POST");
  expect(candidate).toBeDefined();
  if (!candidate) return;
  const operation = buildOperation(
    candidate,
    {
      actionType: `${SCHEMA}UpdateAction`,
      label: "Save",
      effect: "irreversible-write",
      confidence: 0.3,
    },
    {
      modelId: model.id,
      learnedAt: model.generatedAt,
      derivedFrom: [],
      method: "fallback",
      usedIds: new Set(),
      sessionCookies: [],
    },
  );
  expect(fingerprint).toBe(requestFingerprint(compileOperation(operation, { qty: "1" }, origin)));
});

it("executor-verifies a token-slotted read with the session and returns a valid token-free model", async () => {
  const token = "opaque-session-material-12345";
  const trace = [
    entry(0, { url: `${origin}/data/${token}/orders?session=${token}` }),
    entry(1, { url: `${origin}/data/${token}/orders?session=${token}` }),
  ];
  const proposed = candidatesFromTrace(
    trace,
    origin,
    [{ name: "sid", value: token }],
    new Set(),
    (s) => s,
  );
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: [{ name: "sid", value: token, domain: "shop.test", path: "/", hostOnly: true }],
  });
  const transport = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toContain(`/data/${token}/orders?session=${token}`);
    return Response.json({ items: [{ orderNumber: "5010", total: "18.50", currency: "GBP" }] });
  });
  const result = await learnFallback({
    model,
    request,
    sessions,
    transport,
    driver: { candidates: async () => structuredClone(proposed) },
  });
  expect(result.proposed, JSON.stringify(result.rejected)).toHaveLength(1);
  expect(result.proposed[0]?.request.urlTemplate).toContain("{sessionPath");
  expect(result.proposed[0]?.inputs).toEqual([]);
  expect(validateSiteModel(result.model)).toEqual([]);
  expect(JSON.stringify(result.model)).not.toContain(token);
});

it("learns the final verified read instead of introducing ambiguous intermediate reads", async () => {
  const proposed = candidates([entry(0, { url: `${origin}/earlier-orders` }), entry(1)]);
  const transport = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(`${origin}/orders`);
    return Response.json({ items: [{ orderNumber: "5010", total: "18.50", currency: "GBP" }] });
  });
  const result = await learnFallback({
    model,
    request,
    sessions: new InMemorySessions(),
    transport,
    driver: { candidates: async () => structuredClone(proposed) },
  });
  expect(result.proposed).toHaveLength(1);
  expect(result.proposed[0]?.request.urlTemplate).toBe(`${origin}/orders`);
  expect(result.model.version).toBe("0.1.1");
  expect(result.rejected[0]?.reason).toContain("Earlier navigation read");
  expect(transport).toHaveBeenCalledTimes(1);
});
