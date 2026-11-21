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
import { redactOutput } from "../src/session-tokens.js";
import {
  captureVerificationEvidence,
  fetchVerificationEvidence,
} from "../src/verification-evidence.js";
import { playwrightReplayer } from "../src/verify.js";
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

it("retains credentials discovered beyond the sample limit in discarded evidence bodies", async () => {
  const f = fixture();
  const secret = "evidence-only-credential-secret";
  vi.stubGlobal("fetch", async () =>
    Response.json({ ...JSON.parse(body()), credentials: { access_token: secret } }),
  );
  await fetchVerificationEvidence([f.write, f.read], f.context, f.recorder);
  expect(f.recorder.secrets).toContain(secret);
  expect(f.recorder.trace.at(-1)?.bodySample).toBeUndefined();
  expect(JSON.stringify(f.recorder.trace)).not.toContain(secret);
});

const hiddenSecret = "hidden-source-response-credential";
const hiddenBody = `<main><h1>Missing widget</h1><p>${hiddenSecret}</p>${" ".repeat(BODY_LIMIT + 100)}<input type="hidden" name="csrf_token" value="${hiddenSecret}"></main>`;

it.each([
  "json",
  "script",
  "large script",
])("resolves external %s selector candidates using final witnesses without exempting credentials", (format) => {
  const recorder = new Recorder(origin);
  const selector = 'input[name="csrf_token"]';
  const unproven = 'input[name="unknown_token"]';
  const fields = { csrfSelector: selector, tokenSelector: unproven };
  recorder.recordReplay({
    method: "GET",
    url: `${origin}/config`,
    resourceType: format.includes("script") ? "script" : "xhr",
    contentType: format === "json" ? "application/json" : "application/javascript",
    bodySample:
      format === "json"
        ? JSON.stringify(fields)
        : `${format === "large script" ? `/*${"x".repeat(512 * 1024)}*/` : ""}window.config=${JSON.stringify(fields)};`,
  });
  expect(recorder.finalSecrets([])).toContain(selector);
  recorder.recordReplay({
    method: "GET",
    url: `${origin}/form`,
    resourceType: "document",
    contentType: "text/html",
    bodySample: `<input type="hidden" name="csrf_token" value="${hiddenSecret}">`,
  });
  expect(recorder.finalSecrets([])).toEqual(
    new Set([
      hiddenSecret,
      unproven,
      ...(format === "large script" ? [JSON.stringify(unproven).slice(1, -1)] : []),
    ]),
  );
  // A real credential can have the same lexical value as the proven locator.
  recorder.recordReplay({
    method: "GET",
    url: `${origin}/token`,
    resourceType: "xhr",
    contentType: "application/json",
    bodySample: JSON.stringify({ csrf_token: selector }),
  });
  expect(recorder.finalSecrets([])).toContain(selector);
});

it("retains runtime values and numeric source spellings for deferred selector credentials", () => {
  const recorder = new Recorder(origin);
  recorder.responseBody("window.csrfSelector=0xCAFE;", {
    url: `${origin}/config.js`,
    resourceType: "script",
    contentType: "application/javascript",
  });
  expect(recorder.finalSecrets([])).toEqual(new Set(["51966", "0xCAFE"]));
});

it.each([
  "json",
  "script",
])("scans complete %s credential sources beyond the sample limit", (format) => {
  const recorder = new Recorder(origin);
  const body =
    format === "json"
      ? JSON.stringify({
          padding: "x".repeat(BODY_LIMIT + 100),
          nested: { csrf_token: hiddenSecret },
        })
      : `/*${"x".repeat(BODY_LIMIT + 100)}*/window.csrf_token="${hiddenSecret}";`;
  recorder.recordReplay({
    method: "GET",
    url: `${origin}/source`,
    resourceType: format,
    contentType: format === "json" ? "application/json" : "text/plain",
    bodySample: body,
  });
  expect(recorder.secrets).toEqual(new Set([hiddenSecret]));
  expect(recorder.trace[0]?.bodySample).not.toContain("csrf_token");
});

it("scans only the byte-bounded prefix of an oversized response", async () => {
  const recorder = new Recorder(origin);
  const laterSecret = "beyond-evidence-cap-credential";
  const metadata = { url: `${origin}/source`, resourceType: "document", contentType: "text/html" };
  const prefix = hiddenBody + "é".repeat(VERIFICATION_EVIDENCE_LIMIT / 2);
  await expect(
    recorder.readResponseBody(
      new Response(`${prefix}<input type="hidden" name="csrf_token" value="${laterSecret}">`),
      metadata,
    ),
  ).rejects.toThrow("byte limit");
  expect(recorder.secrets).toEqual(new Set([hiddenSecret]));
  expect(recorder.trace).toEqual([]);
});

it.each([
  false,
  true,
])("discovers secrets before raw replay sample truncation (oversized=%s)", (oversized) => {
  const recorder = new Recorder(origin);
  const entry = recorder.recordReplay({
    method: "GET",
    url: `${origin}/products/42`,
    resourceType: "replay",
    status: 404,
    contentType: "text/html",
    bodySample: hiddenBody + (oversized ? " ".repeat(VERIFICATION_EVIDENCE_LIMIT) : ""),
  });
  expect(recorder.secrets).toEqual(new Set([hiddenSecret]));
  expect(entry.bodyTruncated).toBe(true);
  if (oversized) {
    expect(entry.bodySample).toBeUndefined();
    expect(entry.responsePageFailure).toBe(true);
    expect(entry.notFoundEvidence).toBeUndefined();
    expect(entry.verificationEvidence).toBeUndefined();
  } else {
    expect(entry.bodySample).toContain(hiddenSecret);
    expect(entry.bodySample).not.toContain("csrf_token");
  }
  expect(JSON.stringify(redactOutput(recorder.trace, recorder.secrets))).not.toContain(
    hiddenSecret,
  );
});

it.each([
  "complete",
  "oversized",
  "early",
  "broken",
])("scans the bounded evidence prefix even when a response is %s", async (mode) => {
  const f = fixture();
  vi.stubGlobal("fetch", async () => {
    const value =
      hiddenBody + (mode === "oversized" ? " ".repeat(VERIFICATION_EVIDENCE_LIMIT) : "");
    let sent = false;
    return new Response(
      mode === "broken"
        ? new ReadableStream({
            pull(controller) {
              if (sent) controller.error(new Error("Fictional stream failure"));
              else {
                sent = true;
                controller.enqueue(Buffer.from(value));
              }
            },
          })
        : value,
      {
        status: 404,
        headers: {
          "content-type": "text/html",
          ...(mode === "early" ? { "content-length": "8000000" } : {}),
          ...(mode === "oversized" ? { "content-length": String(Buffer.byteLength(value)) } : {}),
        },
      },
    );
  });
  await fetchVerificationEvidence([f.write, f.read], f.context, f.recorder);
  expect(f.recorder.secrets).toEqual(new Set([hiddenSecret]));
  const evidence = f.recorder.trace.filter((r) => r.resourceType === "verification-evidence");
  expect(evidence).toHaveLength(mode === "complete" ? 1 : 0);
  expect(evidence[0]?.bodySample).toBeUndefined();
  expect(JSON.stringify(redactOutput(f.recorder.trace, f.recorder.secrets))).not.toContain(
    hiddenSecret,
  );
});

it("scans anonymous replay responses before returning or sampling them", async () => {
  const recorder = new Recorder(origin);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(hiddenBody, {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
  );
  const replayer = playwrightReplayer({} as BrowserContext, recorder, "verify");
  const response = await replayer.get(`${origin}/products/42`, { signedIn: false });
  expect(response.body).toBe(hiddenBody);
  expect(recorder.secrets).toEqual(new Set([hiddenSecret]));
  expect(recorder.trace[0]?.bodyTruncated).toBe(true);
  expect(recorder.trace[0]?.bodySample).not.toContain("csrf_token");
  expect(JSON.stringify(redactOutput(recorder.trace, recorder.secrets))).not.toContain(
    hiddenSecret,
  );
});

it.each([
  false,
  true,
])("scans complete CSRF preparation before token extraction (oversized=%s)", async (oversized) => {
  const recorder = new Recorder(origin);
  const get = vi.fn(async (url: string) => {
    const body =
      url === `${origin}/csrf`
        ? hiddenBody + (oversized ? " ".repeat(VERIFICATION_EVIDENCE_LIMIT) : "")
        : "<main>Example</main>";
    return {
      body: async () => Buffer.from(body),
      status: () => 200,
      url: () => url,
      headers: () => ({ "content-type": "text/html" }),
      headersArray: () => [],
    };
  });
  const context = { request: { get }, cookies: async () => [] } as unknown as BrowserContext;
  const replayer = playwrightReplayer(context, recorder, "verify");
  const run = replayer.get(`${origin}/products/42`, {
    signedIn: true,
    csrf: [
      {
        source: {
          kind: "html",
          urlTemplate: `${origin}/csrf`,
          selector: 'input[name="csrf_token"]',
          attribute: "value",
        },
        target: { kind: "query", name: "csrf" },
      },
    ],
  });
  if (oversized) {
    await expect(run).rejects.toThrow("byte limit");
    expect(get).toHaveBeenCalledOnce();
    expect(recorder.trace).toEqual([]);
  } else {
    await run;
    expect(get).toHaveBeenCalledTimes(2);
  }
  expect(recorder.secrets).toEqual(new Set([hiddenSecret]));
  expect(JSON.stringify(redactOutput(recorder.trace, recorder.secrets))).not.toContain(
    hiddenSecret,
  );
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
