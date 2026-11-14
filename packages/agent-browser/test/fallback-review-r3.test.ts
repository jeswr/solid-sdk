// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { InMemorySessions } from "@jeswr/site-executor";
import { type ActionRequest, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { launchChromium, type RecordedRequest } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { candidatesFromTrace, learnFallback } from "../src/fallback/learn.js";
import {
  BrowserDriver,
  createFallback,
  createTaskExecutor,
  runTask,
  scriptedFallbackPlanner,
  scriptedPlanner,
  type TaskExecutor,
} from "../src/index.js";

const token = "1234567890";
const emptyModel = (site: string): SiteModel => ({
  id: "urn:shop:model",
  site,
  version: "0.1.0",
  generatedAt: "2026-11-13T00:00:00.000Z",
  operations: [],
  flows: [],
});
const view: ActionRequest = {
  node: "urn:request",
  types: [`${SCHEMA}ViewAction`],
  values: () => [],
};
const record = (
  origin: string,
  seq: number,
  changes: Partial<RecordedRequest>,
): RecordedRequest => ({
  seq,
  phase: "demonstration",
  method: "GET",
  url: origin,
  resourceType: "document",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  ...changes,
});

describe("fallback review r3 credential constants", () => {
  it.each([
    ["GET", `/orders?dataset=${token}`, undefined, undefined],
    ["GET", `/orders/${token}`, undefined, undefined],
    ["POST", "/save", `dataset=${token}`, "application/x-www-form-urlencoded"],
    ["POST", "/save", `{"dataset":${token}}`, "application/json"],
  ])("rejects unresolved numeric credentials in %s %s before executor replay", async (method, path, postData, contentType) => {
    const origin = "https://shop.test";
    const candidates = candidatesFromTrace(
      [
        record(origin, 0, {
          resourceType: "script",
          contentType: "application/javascript",
          bodySample: `window.csrfToken=${token};`,
        }),
        record(origin, 1, {
          method,
          url: `${origin}${path}`,
          postData,
          requestHeaders: contentType ? { "content-type": contentType } : {},
          contentType: "application/json",
          bodySample: '{"items":[{"orderNumber":"5010"}]}',
        }),
      ],
      origin,
      [],
      new Set(method === "GET" ? [] : [1]),
      (s) => s,
    );
    const transport = vi.fn(async () => Response.json({ items: [{ orderNumber: "5010" }] }));
    const learned = await learnFallback({
      model: emptyModel(origin),
      sessions: new InMemorySessions(),
      transport,
      request: method === "GET" ? view : { ...view, types: [`${SCHEMA}UpdateAction`] },
      driver: { candidates: async () => candidates },
    });
    expect(learned.proposed).toEqual([]);
    expect(learned.rejected.some((r) => r.reason.includes("session material"))).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.stringify([candidates, learned])).not.toContain(token);
  });
});

describe("fallback review r3 Chromium regressions", () => {
  let server: Server;
  let origin: string;
  const sent: { method: string; path: string; body: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://shop.test");
        sent.push({
          method: req.method ?? "",
          path: url.pathname,
          body: Buffer.concat(chunks).toString(),
        });
        res.setHeader("content-type", "text/html");
        if (url.pathname === "/numeric.js") {
          res.setHeader("content-type", "application/javascript");
          res.end(
            `window.csrfToken=${token};document.getElementById("echo").textContent=String(window.csrfToken);`,
          );
        } else if (url.pathname === "/numeric") {
          res.end('<p id="echo"></p><script src="/numeric.js"></script>');
        } else if (url.pathname === "/inline") {
          res.end(
            `<p>${token}</p><input aria-label="Echo" value="${token}"><script>window.csrfToken=${token}</script>`,
          );
        } else if (url.pathname === "/long-name") {
          res.end(`<button>${"N".repeat(400)}</button>`);
        } else if (url.pathname === "/long-value") {
          res.end(`<input aria-label="Public" value="${"V".repeat(400)}">`);
        } else if (url.pathname === "/short") {
          res.end('<button>Short</button><input aria-label="Public" value="Short">');
        } else if (url.pathname === "/orders") {
          res.setHeader("content-type", "application/json");
          res.end('{"items":[{"orderNumber":"5010","total":"18.50","currency":"GBP"}]}');
        } else if (url.pathname === "/products" && req.method === "POST") {
          res.writeHead(303, { location: "/products/id/42" });
          res.end();
        } else if (url.pathname === "/products/id/42") {
          res.setHeader("content-type", "application/json");
          res.end('{"saved":true,"id":"42","name":"Example Widget"}');
        } else res.end("<p>Start</p>");
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  it.each([
    "/numeric",
    "/inline",
  ])("registers numeric script credentials before snapshots, trace and learning: %s", async (path) => {
    const d = await BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      launch: launchChromium,
    });
    try {
      await d.goto(path);
      const snapshot = await d.snapshot();
      expect(snapshot.text).toContain("redacted");
      expect(JSON.stringify([snapshot, d.trace, await d.candidates()])).not.toContain(token);
    } finally {
      await d.close();
    }
  });

  it.each([
    "name",
    "value",
  ])("marks per-value snapshot %s truncation and the snapshot flag", async (field) => {
    const d = await BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      launch: launchChromium,
    });
    try {
      await d.goto(`/long-${field}`);
      const snapshot = await d.snapshot();
      const clipped =
        field === "name"
          ? snapshot.nodes.find((n) => n.role === "button")?.name
          : snapshot.nodes.find((n) => n.role === "textbox")?.value;
      expect(clipped).toHaveLength(300);
      expect(clipped).toMatch(/\[truncated\]$/);
      expect(snapshot.text).toContain(clipped);
      expect(snapshot.truncated).toBe(true);
      await d.goto("/short");
      expect(await d.snapshot()).toMatchObject({ truncated: false });
    } finally {
      await d.close();
    }
  });

  it.each([
    "original options",
    "host factory",
  ])("keeps approved create redirects completed after unrelated read learning via %s", async (configuration) => {
    const sessions = new InMemorySessions();
    const model = emptyModel(origin);
    const createId = `${model.id}#create`;
    model.operations.push({
      id: createId,
      actionType: `${SCHEMA}CreateAction`,
      label: "Create product",
      inputs: [
        {
          name: "name",
          path: [`${SCHEMA}object`, `${SCHEMA}name`],
          range: "http://www.w3.org/2001/XMLSchema#string",
          required: true,
          location: "form",
          default: "Example Widget",
        },
      ],
      request: {
        method: "POST",
        urlTemplate: `${origin}/products`,
        contentType: "application/x-www-form-urlencoded",
      },
      session: "none",
      effect: "irreversible-write",
      provenance: {
        derivedFrom: [],
        learnedAt: model.generatedAt,
        method: "demonstration",
        confidence: 1,
      },
    });
    const options = {
      model,
      sessions,
      persona: "alex",
      maxRequests: 7,
      maxRedirects: 2,
      maxResponseBytes: 2048,
      maxExecutionMs: 5000,
      writeResponses: {
        [createId]: {
          createdLocationPattern: "/products/id/{id}",
          extraction: {
            format: "json" as const,
            itemType: `${SCHEMA}Product`,
            fields: [
              { property: `${SCHEMA}identifier`, path: "/id" },
              { property: `${SCHEMA}name`, path: "/name" },
            ],
          },
          inputEvidence: { input: "name", property: `${SCHEMA}name` },
          success: { format: "json" as const, path: "/saved", value: "true" },
        },
      },
    };
    const base = createTaskExecutor(options);
    const factory = vi.fn((updated: SiteModel) =>
      createTaskExecutor({ ...options, model: updated }),
    );
    const executor: TaskExecutor =
      configuration === "host factory" ? { ...base, withModel: undefined } : base;
    const approvals = vi.fn(() => "approve" as const);
    const before = sent.length;
    const trace = await runTask({
      model,
      executor,
      goal: "Create, read orders, then create another product",
      persona: "alex",
      approver: approvals,
      allowRepeats: true,
      maxSteps: 3,
      fallback: createFallback({
        sessions,
        minActionDelayMs: 0,
        launch: launchChromium,
        ...(configuration === "host factory" ? { executorFactory: factory } : {}),
        planner: () =>
          scriptedFallbackPlanner([
            { kind: "step", action: { kind: "goto", url: "/orders" } },
            { kind: "done" },
          ]),
      }),
      planner: scriptedPlanner([
        { kind: "act", turtle: `[] a <${SCHEMA}CreateAction>.` },
        {
          kind: "act",
          turtle: `[] a <${SCHEMA}ViewAction>; <${SCHEMA}object> [a <${SCHEMA}Order>].`,
        },
        { kind: "act", turtle: `[] a <${SCHEMA}CreateAction>.` },
      ]),
    });
    expect(
      trace.steps.map((s) => s.status),
      JSON.stringify(trace.steps),
    ).toEqual(["done", "done", "done"]);
    expect(trace.steps[1]?.via).toBe("fallback");
    expect(trace.steps[1]?.learned).toHaveLength(1);
    for (const index of [0, 2]) {
      expect(trace.steps[index]?.observations).toContain("sab:Completed");
      expect(trace.steps[index]?.observations).toContain(`${origin}/products/id/42`);
      expect(trace.steps[index]?.approvals).toHaveLength(1);
    }
    expect(approvals).toHaveBeenCalledTimes(2);
    expect(sent.slice(before).filter((r) => r.method === "POST")).toHaveLength(2);
    if (configuration === "host factory")
      expect(factory).toHaveBeenCalledWith(
        trace.model,
        expect.objectContaining({ secrets: expect.any(Set) }),
      );
    else expect(factory).not.toHaveBeenCalled();
  });
});
