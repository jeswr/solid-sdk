// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { createExecutor, type ExecutorOptions, InMemorySessions } from "@jeswr/site-executor";
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
  runTask,
  scriptedFallbackPlanner,
  scriptedPlanner,
  type TaskExecutor,
} from "../src/index.js";

const scriptSecret = "script-Credential-9137";
const profilerSecret = "profiler-Credential-8246";
const aliases = [
  "csrf",
  "xsrf",
  "sid",
  "session",
  "token",
  "auth",
  "key",
  "pwd",
  "pass",
  "password",
  "secret",
  "sess",
  "PHPSESSID",
  "connect.sid",
  "csrf_token",
  "X-XSRF-TOKEN",
  "api_key",
  "access_token",
  "authorization",
  "authenticity_token",
  "antiforgery",
  "nonce",
  "code",
  "signature",
  "state",
  "requestVerificationToken",
];
const view: ActionRequest = {
  node: "urn:request",
  types: [`${SCHEMA}ViewAction`],
  values: () => [],
};
const emptyModel = (site: string): SiteModel => ({
  id: "urn:shop:model",
  site,
  version: "0.1.0",
  generatedAt: "2026-11-13T00:00:00.000Z",
  operations: [],
  flows: [],
});

describe("fallback review r5", () => {
  let server: Server;
  let origin: string;
  const sent: { method: string; path: string }[] = [];
  const urlEchoes = () =>
    aliases.map((key, index) => {
      const params = `${key}=QueryPrivate${index}&public=visible`;
      const fragment = `${key.toUpperCase()}=FragmentPrivate${index}&public=visible`;
      return `${origin}/account?${params}#${fragment}`;
    });
  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://shop.test").pathname;
      sent.push({ method: req.method ?? "GET", path });
      if (path === "/app.js") {
        res.setHeader("content-type", "application/javascript");
        res.end(`window.csrfToken=${JSON.stringify(scriptSecret)};`);
      } else if (path === "/orders") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ items: [{ orderNumber: "5010", name: "Public order" }] }));
      } else if (path === "/start") {
        res.writeHead(302, { location: "/account/redirect" });
        res.end();
      } else if (path === "/account/redirect") {
        res.writeHead(301, { location: "/account/address" });
        res.end();
      } else if (path === "/start-fragment") {
        res.writeHead(302, { location: "/account/address#details" });
        res.end();
      } else if (path === "/account/address") {
        res.setHeader("content-type", "text/html");
        res.end(
          '<script>document.title=location.pathname;document.documentElement.dataset.base=document.baseURI</script><script src="relative.js"></script><a href="next">Next page</a><form method="post" action="save"><input name="streetAddress" value="12 Example Lane"><button>Save address</button></form>',
        );
      } else if (path === "/account/relative.js") {
        res.setHeader("content-type", "application/javascript");
        res.end('document.documentElement.dataset.script="loaded"');
      } else if (path === "/account/save") {
        res.setHeader("content-type", "text/html");
        res.end("<p>Address saved</p>");
      } else if (path === "/queued") {
        res.setHeader("content-type", "text/html");
        res.end(
          "<button onclick=\"setTimeout(() => location.href='/start-fragment', 20)\">Open address</button>",
        );
      } else if (path === "/aliases") {
        res.setHeader("content-type", "text/html");
        res.end(
          urlEchoes()
            .map(
              (url) =>
                `<button>${url.replaceAll("&", "&amp;")}</button><input aria-label="Public link" value="${url.replaceAll("&", "&amp;")}">`,
            )
            .join(""),
        );
      } else {
        res.setHeader("content-type", "text/html");
        res.end('<script src="/app.js"></script><p>Start</p>');
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  it.each([
    "declaredNames",
    "loginCookieNames",
  ] as const)("redacts host %s and profiler secrets inside extraction before and after rebuilding", async (declaration) => {
    const sessions = new InMemorySessions();
    const cookieContext = { [declaration]: ["ticket"] };
    let cookie = "Ab4xYz";
    const seed = () =>
      sessions.set(origin, undefined, {
        cookies: [{ name: "ticket", value: `"${cookie}"`, domain: "127.0.0.1", path: "/" }],
      });
    seed();
    const model = emptyModel(origin);
    model.operations.push({
      id: "urn:orders",
      label: "View orders",
      actionType: `${SCHEMA}ViewAction`,
      inputs: [],
      request: { method: "GET", urlTemplate: `${origin}/orders` },
      effect: "read",
      session: "none",
      provenance: {
        derivedFrom: [],
        learnedAt: model.generatedAt,
        method: "manual",
        confidence: 1,
      },
      extraction: {
        format: "json",
        itemPath: "/items",
        itemType: `${SCHEMA}Order`,
        fields: [{ property: `${SCHEMA}name`, path: "/name", untrusted: true }],
      },
    });
    const fetcher = vi.fn(async () =>
      Response.json({ items: [{ name: `${cookie} ${profilerSecret}` }] }),
    );
    let executor = createTaskExecutor({
      model,
      sessions,
      cookieContext,
      fetch: fetcher,
      credentialContext: { secrets: new Set([profilerSecret]) },
    });
    for (let round = 0; round < 2; round++) {
      const result = await executor.execute(view);
      expect(result.status).toBe("done");
      expect(result.observations[0]?.turtle).toContain("[redacted] [redacted]");
      expect(JSON.stringify(result)).not.toContain(cookie);
      expect(JSON.stringify(result)).not.toContain(profilerSecret);
      cookie = "Gh7jKl";
      seed();
      executor = executor.withModel?.({ ...model, version: "0.1.1" }) as TaskExecutor;
    }
  });

  it.each([
    "fallback executor",
    "host executor",
    "host factory",
  ])("shares script and declared cookie secrets with replay and the %s after learning", async (lifecycle) => {
    const sessions = new InMemorySessions();
    let cookie = "Ab4xYz";
    const seed = () =>
      sessions.set(origin, "alex", {
        cookies: [{ name: "ticket", value: `"${cookie}"`, domain: "127.0.0.1", path: "/" }],
      });
    seed();
    const model = emptyModel(origin);
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async () =>
      Response.json({
        items: [{ orderNumber: "5010", name: `${scriptSecret} ${cookie} ${profilerSecret}` }],
      }),
    );
    const hostOptions = {
      model,
      sessions,
      persona: "alex",
      fetch: transport,
      cookieContext: { loginCookieNames: ["ticket"] },
      credentialContext: { secrets: new Set([profilerSecret]) },
    };
    const base = createTaskExecutor(hostOptions);
    const executor = lifecycle === "host factory" ? { ...base, withModel: undefined } : base;
    const fallback = createFallback({
      sessions,
      persona: "alex",
      transport,
      minActionDelayMs: 0,
      launch: launchChromium,
      ...(lifecycle === "host factory"
        ? {
            executorFactory: (updated, credentialContext) =>
              createExecutor({ ...hostOptions, model: updated, credentialContext }),
          }
        : {}),
      planner: () =>
        scriptedFallbackPlanner([
          { kind: "step", action: { kind: "goto", url: "/orders" } },
          { kind: "done" },
        ]),
    });
    const create = vi.spyOn(BrowserDriver, "create");
    const safe = (value: unknown) => {
      for (const secret of [scriptSecret, cookie, profilerSecret])
        expect(JSON.stringify(value)).not.toContain(secret);
      expect(JSON.stringify(value)).toContain("[redacted]");
    };
    try {
      if (lifecycle === "fallback executor") {
        const learned = await fallback.run({
          model,
          request: view,
          goal: "View orders",
          approver: () => "deny",
          maxApprovals: 1,
          exclusions: {},
        });
        expect(learned.proposed, JSON.stringify(learned.rejected)).toHaveLength(1);
        safe(learned.result);
        safe(create.mock.results[0] && (await create.mock.results[0].value).trace);
        cookie = "Gh7jKl";
        seed();
        const replay = await learned.executor?.execute(view);
        expect(replay?.status).toBe("done");
        safe(replay);
      } else {
        const trace = await runTask({
          model,
          executor,
          fallback,
          persona: "alex",
          goal: "View orders twice",
          approver: () => "deny",
          planner: scriptedPlanner([
            { kind: "act", turtle: `[] a <${SCHEMA}ViewAction>.` },
            (input) => {
              safe(input);
              cookie = "Gh7jKl";
              seed();
              return { kind: "act", turtle: `[] a <${SCHEMA}ViewAction>.` };
            },
            (input) => {
              safe(input);
              return { kind: "answer", text: "Done" };
            },
          ]),
        });
        expect(trace.steps.map((step) => step.status)).toEqual(["done", "done", "answer"]);
        expect(trace.steps[0]?.via).toBe("fallback");
        expect(trace.steps[1]?.via).toBeUndefined();
        safe(trace);
        expect(JSON.stringify(trace)).not.toContain("Ab4xYz");
        expect(create).toHaveBeenCalledTimes(1);
      }
    } finally {
      create.mockRestore();
    }
  });

  it.each([
    "approve",
    "deny",
  ] as const)("uses the checked final document URL for relative forms, links and scripts with %s", async (decision) => {
    const approver = vi.fn(() => decision);
    const driver = await BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      launch: launchChromium,
      approver,
    });
    const before = sent.length;
    try {
      await driver.goto("/start");
      // Inspect only in this host-side test: the planner still sees AX snapshots alone.
      const page = (driver as unknown as { page: import("playwright").Page }).page;
      expect(page.url()).toBe(`${origin}/account/address`);
      expect(await page.title()).toBe("/account/address");
      expect(await page.locator("html").getAttribute("data-base")).toBe(
        `${origin}/account/address`,
      );
      expect(await page.locator("html").getAttribute("data-script")).toBe("loaded");
      expect(await page.locator("a").evaluate((a) => (a as HTMLAnchorElement).href)).toBe(
        `${origin}/account/next`,
      );
      const snapshot = await driver.snapshot();
      const ref = snapshot.nodes.find(
        (node) => node.role === "button" && node.name === "Save address",
      )?.ref;
      expect(ref).toBeDefined();
      if (decision === "approve") await driver.click(ref as string);
      else await expect(driver.click(ref as string)).rejects.toMatchObject({ kind: "denied" });
      expect(approver).toHaveBeenCalledTimes(1);
      const writes = sent.slice(before).filter((entry) => entry.method === "POST");
      expect(writes).toEqual(
        decision === "approve" ? [{ method: "POST", path: "/account/save" }] : [],
      );
      expect(sent.slice(before).filter((entry) => entry.path === "/account/address")).toHaveLength(
        1,
      );
      expect(
        sent.slice(before).some((entry) => entry.path === "/save" || entry.path === "/relative.js"),
      ).toBe(false);
    } finally {
      await driver.close();
    }
  });

  it("renders a queued redirected navigation at its final URL and preserves back history", async () => {
    const driver = await BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      launch: launchChromium,
    });
    const before = sent.length;
    try {
      await driver.goto("/queued");
      const ref = (await driver.snapshot()).nodes.find((node) => node.name === "Open address")?.ref;
      await driver.click(ref as string);
      const page = (driver as unknown as { page: import("playwright").Page }).page;
      expect(page.url()).toBe(`${origin}/account/address#details`);
      expect(await page.title()).toBe("/account/address");
      expect(sent.slice(before).filter((entry) => entry.path === "/account/address")).toHaveLength(
        1,
      );
      await driver.back();
      expect(page.url()).toBe(`${origin}/queued`);
      expect((await driver.snapshot()).text).toContain("Open address");
    } finally {
      await driver.close();
    }
  });

  it("scrubs credential aliases case-insensitively in both snapshot representations and trace", async () => {
    const driver = await BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      launch: launchChromium,
      minActionDelayMs: 0,
      maxSnapshotNodes: 200,
      maxSnapshotChars: 60000,
    });
    try {
      await driver.goto("/aliases");
      const snapshot: BrowserSnapshot = await driver.snapshot();
      expect(snapshot.truncated).toBe(false);
      expect(snapshot.nodes.filter((node) => node.role === "button")).toHaveLength(aliases.length);
      expect(snapshot.nodes.filter((node) => node.role === "textbox")).toHaveLength(aliases.length);
      for (const output of [
        snapshot.text,
        JSON.stringify(snapshot.nodes),
        JSON.stringify(driver.trace),
      ]) {
        expect(output).not.toMatch(/QueryPrivate\d+|FragmentPrivate\d+/);
        expect(output).toContain("public=visible");
        expect(output).toMatch(/redacted/);
      }
    } finally {
      await driver.close();
    }
  });
});
