// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { InMemorySessions, registerSecret, secretRedactor } from "@jeswr/site-executor";
import {
  type ActionRequest,
  SCHEMA,
  type SiteModel,
  validateSiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import { type EndpointCandidate, launchChromium, type RecordedRequest } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { containsCredential } from "../src/fallback/credential-scan.js";
import { candidatesFromTrace, learnFallback } from "../src/fallback/learn.js";
import { BrowserDriver } from "../src/index.js";

const token = "r7j4m8q2v9n5z3p6";
const origin = "https://shop.test";
const items = { items: [{ orderNumber: "5010", total: "18.50", currency: "GBP" }] };
const model = (site = origin): SiteModel => ({
  id: "urn:shop:model",
  site,
  version: "0.1.0",
  generatedAt: "2026-11-14T00:00:00.000Z",
  operations: [],
  flows: [],
});
const action = (method: string): ActionRequest => ({
  node: "urn:request",
  types: [`${SCHEMA}${method === "GET" ? "View" : "Update"}Action`],
  values: () => [],
});
const record = (seq: number, changes: Partial<RecordedRequest> = {}): RecordedRequest => ({
  seq,
  phase: "demonstration",
  method: "GET",
  url: `${origin}/orders`,
  resourceType: "xhr",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "application/json",
  bodySample: JSON.stringify(items),
  ...changes,
});
const credentialSource = record(0, {
  url: `${origin}/start`,
  resourceType: "document",
  contentType: "text/html",
  bodySample: `<meta name="csrf-token" content="${token}">`,
});

async function assertRejected(
  candidates: EndpointCandidate[],
  method: string,
  site = origin,
  secrets = new Set<string>(),
) {
  const transport = vi.fn(async () => Response.json(items));
  const learned = await learnFallback({
    model: model(site),
    request: action(method),
    sessions: new InMemorySessions(),
    transport,
    credentialContext: { secrets },
    driver: { candidates: async () => structuredClone(candidates) },
  });
  expect(transport).not.toHaveBeenCalled();
  expect(learned.proposed).toEqual([]);
  expect(learned.model.operations).toEqual([]);
  expect(learned.observations).toEqual([]);
  expect(learned.rejected).toContainEqual({
    candidate: "Learning candidate",
    reason: expect.stringContaining("session material"),
  });
  expect(validateSiteModel(learned.model)).toEqual([]);
  expect(JSON.stringify(learned)).not.toContain(token);
  expect(await writeSiteModel(learned.model)).not.toContain(token);
  return learned;
}

describe("fallback review r10 credential-bearing request strings", () => {
  const positions: [string, (value: string) => Partial<RecordedRequest>][] = [
    ["header name", (value) => ({ requestHeaders: { [`x-${value}`]: "1" } })],
    ["header value", (value) => ({ requestHeaders: { "x-display": value } })],
    ["omitted header name", (value) => ({ requestHeaders: { [`display-${value}`]: "1" } })],
    ["omitted header value", (value) => ({ requestHeaders: { "display-mode": value } })],
    ["query name", (value) => ({ url: `${origin}/orders?${value}=1` })],
    ["query value", (value) => ({ url: `${origin}/orders?q=prefix-${value}` })],
    ["path segment", (value) => ({ url: `${origin}/orders/prefix-${value}` })],
    ["fragment", (value) => ({ url: `${origin}/orders#prefix-${value}` })],
    [
      "form field name",
      (value) => ({
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        postData: new URLSearchParams([[value, "1"]]).toString(),
      }),
    ],
    [
      "form field value",
      (value) => ({
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        postData: new URLSearchParams([["display", value]]).toString(),
      }),
    ],
    [
      "JSON key",
      (value) => ({
        requestHeaders: { "content-type": "application/json" },
        postData: JSON.stringify({ [value]: "1" }),
      }),
    ],
    [
      "nested JSON key",
      (value) => ({
        requestHeaders: { "content-type": "application/json" },
        postData: JSON.stringify({ display: [{ nested: { [value]: "1" } }] }),
      }),
    ],
    [
      "nested JSON value",
      (value) => ({
        requestHeaders: { "content-type": "application/json" },
        postData: JSON.stringify({ display: [{ nested: [value] }] }),
      }),
    ],
  ];

  describe.each(["GET", "POST"])("%s learning", (method) => {
    it.each(
      positions,
    )("rejects a meta credential in a %s before replay or admission", async (_name, position) => {
      const candidates = candidatesFromTrace(
        [credentialSource, record(1, { method, ...position(token) })],
        origin,
        [],
        new Set(method === "POST" ? [1] : []),
        (text) => text,
      ).filter((candidate) => candidate.samples.some((sample) => sample.seq === 1));
      expect(candidates).toHaveLength(1);
      expect(JSON.stringify(candidates)).not.toContain(token);
      await assertRejected(candidates, method);
    });
  });

  it.each([
    ["percent", "%72%37j4m8q2v9n5z3p6"],
    ["nested percent", "%2572%2537j4m8q2v9n5z3p6"],
    ["JSON escapes", "\\u0072\\u0037j4m8q2v9n5z3p6"],
    ["HTML entities", "&#114;&#55;j4m8q2v9n5z3p6"],
    ["base64", Buffer.from(token).toString("base64")],
    ["base64url", Buffer.from(token).toString("base64url")],
  ])("rejects %s credentials in custom candidate keys on both learning paths", async (_name, encoded) => {
    const secrets = new Set<string>();
    registerSecret(secrets, token);
    for (const method of ["GET", "POST"]) {
      const candidates = candidatesFromTrace(
        [record(1, { method })],
        origin,
        [],
        new Set(method === "POST" ? [1] : []),
        (text) => text,
      );
      const candidate = candidates[0];
      if (!candidate) throw new Error("Missing candidate");
      candidate.headers[`x-${encoded}`] = "1";
      await assertRejected(candidates, method, origin, secrets);
    }
  });

  it("checks the method without echoing it in rejection metadata", async () => {
    const candidates = candidatesFromTrace([record(1)], origin, [], new Set(), (text) => text);
    const candidate = candidates[0];
    if (!candidate) throw new Error("Missing candidate");
    candidate.method = token as EndpointCandidate["method"];
    await assertRejected(candidates, token, origin, new Set([token]));
  });

  it.each([
    "samples",
    "examples",
    "method",
    "POST",
  ])("rejects a credential equal to %s without breaking rejection metadata", async (credential) => {
    const candidates = candidatesFromTrace(
      [
        { ...credentialSource, bodySample: `<meta name="csrf-token" content="${credential}">` },
        record(1, { method: "POST", requestHeaders: { [`x-${credential}`]: "1" } }),
      ],
      origin,
      [],
      new Set([1]),
      (text) => text,
    ).filter((candidate) => candidate.samples.some((sample) => sample.seq === 1));
    expect(candidates).toHaveLength(1);
    const learned = await assertRejected(candidates, "POST");
    expect(JSON.stringify(learned.rejected)).not.toContain(credential);
    expect(JSON.stringify(candidates)).not.toContain(`x-${credential}`);
  });

  it("scans object keys and values at every depth with the shared registration rules", () => {
    const secrets = new Set<string>();
    registerSecret(secrets, token);
    registerSecret(secrets, "a1b2");
    registerSecret(secrets, "abc");
    registerSecret(secrets, "space plus+credential");
    const redact = secretRedactor(secrets);
    for (const value of [
      { nested: [{ [token]: "1" }] },
      { nested: [{ value: token }] },
      { nested: [{ "x-a1b2": "1" }] },
      { "space+plus%2Bcredential": "1" },
      { "space%20plus+credential": "1" },
    ])
      expect(containsCredential(value, redact)).toBe(true);
    expect(containsCredential({ abc: "public", xa1b2y: "public" }, redact)).toBe(false);
  });

  it.each(["GET", "POST"])("continues to admit an ordinary %s candidate", async (method) => {
    const candidates = candidatesFromTrace(
      [credentialSource, record(1, { method, requestHeaders: { "x-mode": "compact" } })],
      origin,
      [],
      new Set(method === "POST" ? [1] : []),
      (text) => text,
    ).filter((candidate) => candidate.samples.some((sample) => sample.seq === 1));
    const transport = vi.fn(async () => Response.json(items));
    const learned = await learnFallback({
      model: model(),
      request: action(method),
      sessions: new InMemorySessions(),
      transport,
      driver: { candidates: async () => candidates },
    });
    expect(learned.proposed, JSON.stringify(learned.rejected)).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(method === "GET" ? 1 : 0);
    expect(learned.proposed[0]?.request.headers).toEqual({ "x-mode": "compact" });
  });
});

describe("fallback review r10 Chromium reproductions", () => {
  let server: Server;
  let site: string;
  const sent: {
    method: string;
    headers: typeof import("http").IncomingMessage.prototype.headers;
    body: string;
  }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://shop.test");
        if (url.pathname === "/orders") {
          sent.push({
            method: req.method ?? "",
            headers: req.headers,
            body: Buffer.concat(chunks).toString(),
          });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(items));
          return;
        }
        const variant = url.searchParams.get("variant");
        const method = variant === "get-header" ? "GET" : "POST";
        const header = variant?.endsWith("header") ? `xhr.setRequestHeader('x-${token}','1');` : "";
        const contentType =
          variant === "json-key" ? "application/json" : "application/x-www-form-urlencoded";
        const body =
          variant === "json-key"
            ? JSON.stringify({ [token]: "1" })
            : variant === "form-name"
              ? `${token}=1`
              : "x=1";
        res.setHeader("content-type", "text/html");
        res.end(
          `<meta name="csrf-token" content="${token}"><button onclick="const xhr=new XMLHttpRequest();xhr.open('${method}','/orders');${header}xhr.setRequestHeader('content-type','${contentType}');xhr.onload=()=>document.getElementById('result').textContent='Loaded';xhr.send(${method === "GET" ? "null" : JSON.stringify(body).replaceAll('"', "&quot;")});">Load</button><p id="result"></p>`,
        );
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  it.each([
    "get-header",
    "post-header",
    "json-key",
    "form-name",
  ])("rejects %s learning after the single witnessed browser request", async (variant) => {
    const browser = await launchChromium();
    const sessions = new InMemorySessions();
    const approver = vi.fn(() => "approve" as const);
    const driver = await BrowserDriver.create({
      site,
      sessions,
      minActionDelayMs: 0,
      approver,
      launch: async () => browser,
    });
    const before = sent.length;
    try {
      await driver.goto(`/?variant=${variant}`);
      const ref = (await driver.snapshot()).nodes.find((node) => node.role === "button")?.ref;
      if (!ref) throw new Error("Missing Load button");
      await driver.click(ref);
      const page = browser.contexts()[0]?.pages()[0];
      if (!page) throw new Error("Missing page");
      await page.waitForFunction(() => document.getElementById("result")?.textContent === "Loaded");
      await driver.candidates();
      await driver.close();
      const candidates = (await driver.candidates()).filter((candidate) =>
        candidate.samples.some((sample) => new URL(sample.url).pathname === "/orders"),
      );
      expect(candidates).toHaveLength(1);
      expect(JSON.stringify([candidates, driver.trace, driver.approvals])).not.toContain(token);
      const method = variant === "get-header" ? "GET" : "POST";
      await assertRejected(candidates, method, site, driver.credentialContext.secrets);
      expect(sent.slice(before)).toHaveLength(1);
      expect(sent.at(-1)?.method).toBe(method);
      expect(approver).toHaveBeenCalledTimes(method === "GET" ? 0 : 1);
      if (variant.endsWith("header")) expect(sent.at(-1)?.headers[`x-${token}`]).toBe("1");
      else expect(sent.at(-1)?.body).toContain(token);
    } finally {
      await driver.close();
    }
  });
});
