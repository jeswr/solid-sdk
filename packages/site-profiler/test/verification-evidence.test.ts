// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import {
  readVerificationBody,
  staleVerificationResponse,
  VERIFICATION_EVIDENCE_LIMIT,
} from "@jeswr/site-executor";
import { type Operation, SCHEMA } from "@jeswr/site-model";
import type { BrowserContext } from "playwright";
import { afterEach, expect, it, vi } from "vitest";
import { BODY_LIMIT, Recorder } from "../src/recorder.js";
import {
  captureVerificationEvidence,
  fetchVerificationEvidence,
} from "../src/verification-evidence.js";
import { learnWriteResponses } from "../src/write-responses.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

const origin = "https://shop.test";
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-14T00:00:00Z",
  confidence: 1,
  derivedFrom: [],
};
function fixture() {
  const recorder = new Recorder(origin);
  const cookies = [
    {
      name: "session",
      value: "fictional-session-secret",
      domain: "shop.test",
      path: "/",
      secure: true,
      httpOnly: true,
      expires: -1,
    },
  ];
  const context = {
    cookies: vi.fn(async () => cookies),
    addCookies: vi.fn(),
  } as unknown as BrowserContext;
  const read: Operation = {
    id: "urn:read",
    label: "Read product",
    actionType: `${SCHEMA}ViewAction`,
    effect: "read",
    session: "signed-in",
    provenance,
    inputs: [
      {
        name: "id",
        path: [],
        location: "path",
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
      },
    ],
    request: { method: "GET", urlTemplate: `${origin}/products/{id}` },
    extraction: {
      format: "json",
      itemType: `${SCHEMA}Product`,
      fields: [
        { property: `${SCHEMA}identifier`, path: "/id" },
        { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
        { property: `${SCHEMA}name`, path: "/name", untrusted: true },
        { property: `${SCHEMA}sku`, path: "/sku" },
      ],
    },
  };
  const write: Operation = {
    ...read,
    id: "urn:write",
    label: "Update product",
    effect: "irreversible-write",
    actionType: `${SCHEMA}UpdateAction`,
    request: {
      method: "POST",
      urlTemplate: `${origin}/products/save/{id}`,
      contentType: "application/x-www-form-urlencoded",
    },
    inputs: [
      { ...required(read.inputs[0]), path: [`${SCHEMA}object`, `${SCHEMA}identifier`] },
      {
        name: "name",
        path: [`${SCHEMA}object`, `${SCHEMA}name`],
        location: "form",
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
      },
    ],
    extraction: undefined,
  };
  recorder.phase = "demonstration";
  const before = recorder.recordReplay({
    method: "GET",
    url: `${origin}/products/42`,
    requestHeaders: {},
    demonstration: "edit",
    resourceType: "document",
    authenticationContext: recorder.authenticationContext({}, cookies),
    status: 200,
    contentType: "application/json",
    bodySample: '{"padding":"truncated',
    bodyTruncated: true,
  });
  recorder.recordReplay({
    demonstration: before.demonstration,
    authenticationContext: before.authenticationContext,
    cookieNames: [],
    resourceType: "document",
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    url: `${origin}/products/save/42`,
    postData: "name=Edited+widget",
    status: 303,
    bodySample: undefined,
    bodyTruncated: false,
  });
  recorder.phase = "verify";
  return { recorder, context, read, write };
}
const body = (size = BODY_LIMIT + 100) =>
  JSON.stringify({
    padding: "x".repeat(size),
    id: "42",
    url: `${origin}/products/42`,
    name: "Edited widget",
    sku: "fictional-42",
  });
afterEach(() => vi.unstubAllGlobals());

it.each([
  [{ Age: "0", "X-Cache": "MISS" }, false],
  [{ Age: "1" }, true],
  [{ Age: "unknown" }, true],
  [{ Age: "0", age: "0" }, true],
  [{ "X-Cache": "HIT" }, true],
  [{ "X-Cache-Hits": "1" }, true],
  [{ "X-Varnish": "stale" }, true],
] as const)("preserves cache rejection with raw repeated-cookie response headers: %j", (headers, stale) => {
  expect(
    staleVerificationResponse({
      ...headers,
      "set-cookie": "sid=fictional-secret\npref=fictional-preference",
    }),
  ).toBe(stale);
});

it("fetches large candidate evidence through the read gate in the demonstrated session without storing a body", async () => {
  const f = fixture();
  const authorize = vi.fn(async () => ({ kind: "allow" as const }));
  const transport = vi.fn(async (_input: unknown, init?: RequestInit) => {
    expect(authorize).toHaveBeenCalledOnce();
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("cookie")).toBe("session=fictional-session-secret");
    return new Response(body(), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", transport);
  await fetchVerificationEvidence([f.write, f.read], f.context, f.recorder, { authorize });
  const record = required(f.recorder.trace.at(-1));
  expect(record.resourceType).toBe("verification-evidence");
  expect(record.bodySample).toBeUndefined();
  expect(record.verificationEvidence?.items[0]?.[`${SCHEMA}name`]).toEqual(["Edited widget"]);
  expect(JSON.stringify(record)).not.toContain("fictional-session-secret");
  expect(JSON.stringify(record)).not.toContain('"padding"');
  expect(
    learnWriteResponses([f.write, f.read], f.recorder.trace, origin)[f.write.id]?.verification
      ?.changes,
  ).toEqual([{ input: "name", property: `${SCHEMA}name` }]);
});
it("does not read session cookies or send a request when the evidence read gate denies", async () => {
  const f = fixture();
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  await fetchVerificationEvidence([f.write, f.read], f.context, f.recorder, {
    authorize: async () => ({ kind: "deny", reason: "Fixture denial" }),
  });
  expect(transport).not.toHaveBeenCalled();
  expect(f.context.cookies).not.toHaveBeenCalled();
});
it.each([
  "oversized",
  "early",
  "cached",
  "authentication",
  "redirect",
])("does not learn invalid evidence: %s", async (mode) => {
  const f = fixture();
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(body(mode === "oversized" ? VERIFICATION_EVIDENCE_LIMIT : BODY_LIMIT + 100), {
        status: mode === "redirect" ? 302 : 200,
        headers: {
          "content-type": "application/json",
          ...(mode === "early" ? { "content-length": "8000000" } : {}),
          ...(mode === "cached" ? { age: "600" } : {}),
          ...(mode === "authentication" ? { "www-authenticate": "Bearer" } : {}),
          ...(mode === "redirect" ? { location: "/login" } : {}),
        },
      }),
  );
  await fetchVerificationEvidence([f.write, f.read], f.context, f.recorder);
  expect(
    learnWriteResponses([f.write, f.read], f.recorder.trace, origin)[f.write.id]?.verification,
  ).toBeUndefined();
});
it("keeps stored samples bounded while retaining only complete bounded extraction evidence", () => {
  const f = fixture();
  const record = required(f.recorder.trace[0]);
  captureVerificationEvidence(record, body(), f.read.extraction);
  expect(record.bodySample?.length).toBeLessThan(BODY_LIMIT);
  expect(record.verificationEvidence?.items[0]?.[`${SCHEMA}sku`]).toEqual(["fictional-42"]);
  const oversized = { ...record, verificationEvidence: undefined };
  captureVerificationEvidence(oversized, body(VERIFICATION_EVIDENCE_LIMIT), f.read.extraction);
  expect(oversized.verificationEvidence).toBeUndefined();
});
it("accepts the exact 8 MiB boundary and refuses an early valid JSON document", async () => {
  const complete = "x".repeat(VERIFICATION_EVIDENCE_LIMIT);
  expect((await readVerificationBody(new Response(complete))).length).toBe(
    VERIFICATION_EVIDENCE_LIMIT,
  );
  await expect(
    readVerificationBody(new Response('{"ok":true}', { headers: { "content-length": "100" } })),
  ).rejects.toThrow("ended early");
});

it("can use complete extracted evidence while its original JSON sample remains truncated", () => {
  const f = fixture();
  const before = required(f.recorder.trace[0]);
  captureVerificationEvidence(before, body(), f.read.extraction);
  expect(before.bodyTruncated).toBe(true);
  expect(before.bodySample).toBe('{"padding":"truncated');
  f.recorder.trace.push({ ...before, seq: 3 });
  expect(
    learnWriteResponses([f.write, f.read], f.recorder.trace, origin)[f.write.id]?.verification
      ?.changes,
  ).toEqual([{ input: "name", property: `${SCHEMA}name` }]);
});

it("does not pair even a matching leaf without a post-write read", () => {
  const f = fixture();
  captureVerificationEvidence(required(f.recorder.trace[0]), body(), f.read.extraction);
  expect(
    learnWriteResponses([f.write, f.read], f.recorder.trace, origin)[f.write.id]?.verification,
  ).toBeUndefined();
});

it.each([
  "fresh",
  "cached",
  "denied",
  "different envelope",
  "authentication",
])("learns collection absence through its evidence GET only when valid: %s", async (mode) => {
  const f = fixture();
  f.write.actionType = `${SCHEMA}DeleteAction`;
  f.write.request.urlTemplate = `${origin}/products/delete/{id}`;
  f.write.inputs = [required(f.write.inputs[0])];
  f.read.inputs = [{ ...required(f.read.inputs[0]), location: "query" }];
  f.read.request.urlTemplate = `${origin}/products/rows{?id}`;
  f.read.extraction = { ...required(f.read.extraction), itemPath: "/items", totalPath: "/total" };
  const before = required(f.recorder.trace[0]),
    write = required(f.recorder.trace[1]);
  before.url = `${origin}/products/rows?id=42`;
  write.url = `${origin}/products/delete/42`;
  write.postData = "";
  captureVerificationEvidence(
    before,
    JSON.stringify({
      padding: "x".repeat(BODY_LIMIT),
      total: 1,
      items: [{ id: "42", url: `${origin}/products/42`, name: "Original widget" }],
    }),
    f.read.extraction,
  );
  const transport = vi.fn(async () =>
    Response.json(
      {
        padding: "x".repeat(BODY_LIMIT),
        total: 0,
        items: [],
        ...(mode === "different envelope" ? { extra: true } : {}),
        ...(mode === "authentication" ? { status: "unauthenticated" } : {}),
      },
      { headers: mode === "cached" ? { age: "5" } : {} },
    ),
  );
  vi.stubGlobal("fetch", transport);
  const authorize = vi.fn(async () =>
    mode === "denied"
      ? { kind: "deny" as const, reason: "Fixture denial" }
      : { kind: "allow" as const },
  );
  await fetchVerificationEvidence([f.write, f.read], f.context, f.recorder, { authorize });
  expect(authorize).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledTimes(mode === "denied" ? 0 : 1);
  const policy = learnWriteResponses([f.write, f.read], f.recorder.trace, origin)[f.write.id];
  if (mode === "fresh") {
    expect(policy?.verification?.identityInput).toBe("id");
    const after = required(f.recorder.trace.at(-1));
    expect(after.bodySample).toBeUndefined();
    expect(after.verificationEvidence?.collection).toEqual({
      count: 0,
      envelope: [["items", "padding", "total"]],
    });
    expect(JSON.stringify(after)).not.toContain('"padding":"');
  } else expect(policy?.verification).toBeUndefined();
});
