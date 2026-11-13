// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { type ExecutorOptions, InMemorySessions } from "@jeswr/site-executor";
import { type ActionRequest, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { launchChromium } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BrowserDriver,
  type BrowserSnapshot,
  createFallback,
  createTaskExecutor,
  scriptedFallbackPlanner,
  type TaskExecutor,
} from "../src/index.js";

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
const products = {
  items: [{ sku: "P-42", name: "Public product", price: "18.50", currency: "GBP" }],
};

describe("fallback review r4 host cookie context", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://shop.test");
      if (url.pathname === "/orders") {
        res.setHeader("content-type", "application/json");
        res.end('{"items":[{"orderNumber":"5010"}]}');
      } else if (url.pathname === "/products") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(products));
      } else {
        const payload = /ticket="([^"]+)"/.exec(req.headers.cookie ?? "")?.[1] ?? "absent";
        res.setHeader("content-type", "text/html");
        res.end(`<button>Ticket ${payload}</button><input aria-label="Echo" value="${payload}">`);
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  it.each([
    ["declaredNames", "fallback executor"],
    ["loginCookieNames", "fallback executor"],
    ["declaredNames", "host executor"],
    ["loginCookieNames", "host executor"],
  ] as const)("preserves %s at intake and after learning with a %s", async (declaration, lifecycle) => {
    const sessions = new InMemorySessions();
    const persona = "alex";
    let payload = "Ab4xYz";
    const seed = () =>
      sessions.set(origin, persona, {
        credentialCookies: ["badge"],
        cookies: [
          {
            name: "ticket",
            value: `"${payload}"`,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: false,
          },
          { name: "badge", value: '"Ef8rTu"', domain: "127.0.0.1", path: "/", httpOnly: false },
        ],
      });
    seed();
    let model = emptyModel(origin);
    // The current model must replace only this stale field, retaining all other host policy.
    const cookieContext = {
      [declaration]: ["ticket"],
      model: emptyModel("https://shop.test"),
      hostPolicy: "retained",
    };
    const snapshots: BrowserSnapshot[] = [];
    let destination = `/orders?dataset=${payload}`;
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe("/products");
      expect(new Headers(init?.headers).get("cookie")).toContain(`ticket="${payload}"`);
      return Response.json(products);
    });
    let executor: TaskExecutor | undefined =
      lifecycle === "host executor"
        ? createTaskExecutor({ model, sessions, persona, cookieContext, fetch: transport })
        : undefined;
    const fallback = createFallback({
      sessions,
      persona,
      cookieContext,
      transport,
      minActionDelayMs: 0,
      launch: launchChromium,
      planner: () =>
        scriptedFallbackPlanner([
          (input) => {
            snapshots.push(input.snapshot);
            return { kind: "step", action: { kind: "goto", url: destination } };
          },
          { kind: "done" },
        ]),
    });
    const create = vi.spyOn(BrowserDriver, "create"); // Call through to the real driver.
    const run = () =>
      fallback.run({
        goal: "View orders",
        request: view,
        model,
        executor,
        approver: () => "deny",
        maxApprovals: 1,
        exclusions: {},
      });
    const checkSnapshot = () => {
      const snapshot = snapshots.at(-1);
      expect(snapshot?.text).toContain("[redacted]");
      expect(snapshot?.text).not.toContain(payload);
      expect(snapshot?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "button", name: "Ticket [redacted]" }),
          expect.objectContaining({ role: "textbox", value: "[redacted]" }),
        ]),
      );
      expect(JSON.stringify(snapshot?.nodes)).not.toContain(payload);
      expect(create.mock.calls.at(-1)?.[0].cookieContext).toEqual({ ...cookieContext, model });
    };
    try {
      const initial = await run();
      checkSnapshot();
      expect(initial.proposed).toEqual([]);
      expect(initial.rejected).toContainEqual(
        expect.objectContaining({ reason: expect.stringContaining("session material") }),
      );
      expect(transport).not.toHaveBeenCalled();
      expect(JSON.stringify(initial)).not.toContain(payload);

      destination = "/products";
      const learned = await run();
      checkSnapshot();
      expect(learned.result.status, JSON.stringify(learned.rejected)).toBe("done");
      expect(learned.proposed).toHaveLength(1);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(learned.executor).toBeDefined();
      expect(learned.executor).not.toBe(executor);
      model = learned.model;
      executor = learned.executor;

      // A fresh secret ensures the original redaction set cannot hide a lost declaration.
      payload = "Gh7jKl";
      seed();
      await executor?.execute({ ...view, types: [`${SCHEMA}SeekAction`] });
      expect(executor?.redact?.(`${payload} Ef8rTu`)).toBe("[redacted] [redacted]");
      destination = `/orders?dataset=${payload}`;
      const rebuilt = await run();
      checkSnapshot();
      expect(rebuilt.proposed).toEqual([]);
      expect(rebuilt.rejected).toContainEqual(
        expect.objectContaining({ reason: expect.stringContaining("session material") }),
      );
      expect(transport).toHaveBeenCalledTimes(1);
      expect(rebuilt.model).toBe(model);
      expect(JSON.stringify(rebuilt)).not.toContain(payload);
      expect(cookieContext.model.site).toBe("https://shop.test");
    } finally {
      create.mockRestore();
    }
  });
});
