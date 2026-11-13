// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import { InMemorySessions, type SessionProvider } from "@jeswr/site-executor";
import {
  parseActionRequest,
  readSiteModel,
  SAB,
  SCHEMA,
  type SiteModel,
  validateSiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import { launchChromium } from "@jeswr/site-profiler";
import { type RunningShop, startShop } from "@jeswr/test-shop";
import { createServer, type Server } from "http";
import { DataFactory } from "n3";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { learnShop, SHOP_LOGIN, shopExecutor } from "../src/demo.js";
import {
  BrowserDriver,
  createFallback,
  createTaskExecutor,
  type FallbackPlannerInput,
  runTask,
  scriptedFallbackPlanner,
  scriptedPlanner,
} from "../src/index.js";
import { PREFIXES, readQuads, writeQuads } from "../src/rdf.js";

const { blankNode, namedNode, literal, quad } = DataFactory;
function action(kind: string, order = false, address?: string): string {
  const a = blankNode();
  const object = blankNode();
  return writeQuads([
    quad(a, namedNode(`${PREFIXES.rdf}type`), namedNode(SCHEMA + kind)),
    ...(order
      ? [
          quad(a, namedNode(`${SCHEMA}object`), object),
          quad(object, namedNode(`${PREFIXES.rdf}type`), namedNode(`${SCHEMA}Order`)),
        ]
      : []),
    ...(address ? [quad(a, namedNode(`${SAB}streetAddress`), literal(address))] : []),
  ]);
}
function click(name: string) {
  return (input: FallbackPlannerInput) => {
    const ref = input.snapshot.nodes.find((n) => n.name === name && n.ref)?.ref;
    if (!ref) throw new Error(`Missing ${name}: ${input.snapshot.text}`);
    return { kind: "step" as const, action: { kind: "click" as const, ref } };
  };
}
function fill(name: string, text: string) {
  return (input: FallbackPlannerInput) => {
    const ref = input.snapshot.nodes.find((n) => n.name === name && n.ref)?.ref;
    if (!ref) throw new Error(`Missing ${name}`);
    return { kind: "step" as const, action: { kind: "fill" as const, ref, text } };
  };
}
const taskPlanner = (turtle: string) =>
  scriptedPlanner([
    { kind: "act", turtle },
    { kind: "answer", text: "Done" },
  ]);

describe("fallback shop acceptance", () => {
  let shop: RunningShop;
  let model: SiteModel;
  beforeAll(async () => {
    shop = await startShop();
    model = await learnShop(shop);
    shop.state.reset();
  });
  afterAll(async () => shop?.close());

  it("A learns order history, then answers through the executor with zero browser launches", async () => {
    expect(model.operations.some((o) => o.request.urlTemplate === `${shop.url}/orders`)).toBe(
      false,
    );
    shop.state.orders.push({
      id: 5010,
      email: SHOP_LOGIN.username,
      lines: [],
      total: "18.50",
      delivery: "standard",
      createdAt: "2026-11-01T12:00:00.000Z",
    });
    const { sessions, executor } = await shopExecutor(model, "orders");
    const turtle = action("SearchAction", true);
    expect((await executor.execute(parseActionRequest(turtle))).status).toBe("no-path");
    const launch = vi.fn(launchChromium);
    const fallback = createFallback({
      sessions,
      launch,
      minActionDelayMs: 0,
      planner: scriptedFallbackPlanner([
        click("Account"),
        click("Order history"),
        { kind: "done" },
      ]),
    });
    const trace = await runTask({
      goal: "list my orders",
      model,
      executor,
      planner: scriptedPlanner([
        { kind: "act", turtle },
        (input) => {
          expect(input.catalogue).toContain("Search order");
          return { kind: "act", turtle };
        },
        { kind: "answer", text: "Done" },
      ]),
      approver: () => "deny",
      fallback,
      persona: "orders",
    });
    expect(trace.steps[0]?.status, JSON.stringify(trace.steps)).toBe("done");
    expect(trace.steps[0]?.via).toBe("fallback");
    expect(trace.steps[1]?.status).toBe("done");
    expect(trace.steps[1]?.via).toBeUndefined();
    const updated = trace.model as SiteModel;
    expect(updated).not.toBe(model);
    expect(validateSiteModel(updated)).toEqual([]);
    const learned = updated.operations.find((o) => o.request.urlTemplate === `${shop.url}/orders`);
    expect(learned).toMatchObject({
      actionType: `${SCHEMA}SearchAction`,
      effect: "read",
      provenance: { method: "fallback", successes: 1 },
      extraction: { itemType: `${SCHEMA}Order` },
    });
    expect(learned?.provenance.confidence).toBeLessThan(0.6);
    expect(readSiteModel(await writeSiteModel(updated))).toEqual(updated);
    const facts = readQuads(trace.steps[0]?.observations ?? "");
    expect(
      facts.some((q) => q.predicate.value === `${SCHEMA}orderNumber` && q.object.value === "5010"),
    ).toBe(true);
    expect(facts.some((q) => q.predicate.value === `${SCHEMA}dateCreated`)).toBe(true);
    expect(
      facts.some((q) => q.predicate.value === `${SCHEMA}totalPrice` && q.object.value === "18.50"),
    ).toBe(true);
    expect(facts.some((q) => q.object.value === `${SAB}UntrustedText`)).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
    launch.mockClear();
    const second = await runTask({
      goal: "list my orders",
      model: updated,
      executor: createTaskExecutor({ model: updated, sessions, persona: "orders" }),
      planner: taskPlanner(turtle),
      approver: () => "deny",
      fallback,
    });
    expect(second.steps[0]?.status).toBe("done");
    expect(second.steps[0]?.via).toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(0);
  }, 120000);

  it.each([
    "deny",
    "approve",
  ] as const)("B %s delivery address: consent before POST, learned write replays once without a browser", async (decision) => {
    const { sessions, executor } = await shopExecutor(model, `address-${decision}`);
    const address = "12 Example Lane";
    const turtle = action("UpdateAction", false, address);
    const approver = vi.fn(() => decision);
    const launch = vi.fn(launchChromium);
    const before = shop.state.requests.filter(
      (r) => r.method === "POST" && r.url === "/account/address",
    ).length;
    const fallback = createFallback({
      sessions,
      launch,
      minActionDelayMs: 0,
      planner: scriptedFallbackPlanner([
        click("Account"),
        click("Delivery address"),
        fill("Street address", address),
        click("Save delivery address"),
        { kind: "done" },
      ]),
    });
    const trace = await runTask({
      goal: "change my delivery address",
      model,
      executor,
      planner: scriptedPlanner([
        { kind: "act", turtle },
        ...(decision === "approve" ? [{ kind: "act" as const, turtle }] : []),
        { kind: "answer", text: "Done" },
      ]),
      approver,
      fallback,
      persona: `address-${decision}`,
    });
    expect(trace.steps[0]?.status, JSON.stringify(trace.steps)).toBe(
      decision === "approve" ? "done" : "denied",
    );
    expect(approver).toHaveBeenCalledTimes(1);
    expect(approver.mock.calls[0]).toBeDefined();
    expect(trace.steps[0]?.approval?.summary).toContain("Save delivery address");
    expect(trace.steps[0]?.approval?.summary).toContain("streetAddress");
    expect(trace.steps[0]?.approval?.summary).toContain(new URL(shop.url).host);
    expect(
      shop.state.requests.filter((r) => r.method === "POST" && r.url === "/account/address"),
    ).toHaveLength(before + (decision === "approve" ? 1 : 0));
    if (decision === "deny") {
      expect(trace.model?.operations).toEqual(model.operations);
      return;
    }
    expect(trace.steps[1]?.status, JSON.stringify(trace.steps)).toBe("repeat-blocked");
    expect(shop.state.addresses.get(SHOP_LOGIN.username)).toBe(address);
    const updated = trace.model as SiteModel;
    const learned = updated.operations.find(
      (o) => o.request.method === "POST" && o.request.urlTemplate === `${shop.url}/account/address`,
    );
    expect(learned).toMatchObject({
      actionType: `${SCHEMA}UpdateAction`,
      effect: "irreversible-write",
      provenance: { method: "fallback" },
    });
    expect(learned?.provenance.lastVerified).toBeUndefined();
    expect(trace.steps[0]?.observations).toContain("sab:Completed");
    launch.mockClear();
    const nextApprover = vi.fn(() => "approve" as const);
    const second = await runTask({
      goal: "change my delivery address",
      model: updated,
      executor: createTaskExecutor({ model: updated, sessions, persona: `address-${decision}` }),
      planner: taskPlanner(turtle),
      approver: nextApprover,
      fallback,
    });
    expect(second.steps[0]?.status, JSON.stringify(second.steps)).toBe("done");
    expect(nextApprover).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(0);
    expect(
      shop.state.requests.filter((r) => r.method === "POST" && r.url === "/account/address"),
    ).toHaveLength(before + 2);
  }, 120000);
});

// Small loopback fixture for adversarial browser tests; every planner is scripted.
describe("fallback browser guards", () => {
  let server: Server;
  let origin: string;
  let posts = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method !== "GET") {
        posts++;
        if (req.url === "/fail") res.statusCode = 500;
        res.end("ok");
        return;
      }
      res.setHeader("content-type", "text/html");
      if (req.url === "/fail-form") {
        res.end('<form method="post" action="/fail"><button>Save fail</button></form>');
        return;
      }
      if (req.url === "/cookie")
        res.setHeader("set-cookie", "rotated=changed-secret-cookie; Path=/; HttpOnly");
      res.end(`<!doctype html><html lang="en"><body><h1>Fixture</h1>
<a href="http://localhost:1/escape">Escape</a>
<a href="/cookie">Cookie</a><a href="/">Home</a>
<button type="button" onclick="this.remove()">Remove me</button>
<form action="/save" method="post" aria-label="Account settings">
<label for="opaque">Private code</label><input id="opaque" type="password" name="contactCode">
<label for="pw">Password</label><input id="pw" type="password" name="password" value="initial-secret-password">
<label for="street">Street</label><input id="street" name="streetAddress" value="Example Lane">
<label for="delivery">Delivery</label><select id="delivery" name="delivery"><option value="standard">Standard</option><option value="express">Express</option></select>
<input type="hidden" name="csrf_token" value="csrf-secret-example">
<button>Save settings</button></form>
<form action="/twice" method="post" onsubmit="event.preventDefault(); const xhr=new XMLHttpRequest(); xhr.open('POST','/save'); xhr.send(''); const other=new XMLHttpRequest(); other.open('POST','/save'); other.send('');"><button>Twice</button></form>
<a href="/" target="_blank">Popup</a>
<form action="/get-write" method="get"><input name="email" value="alex@example.test"><button>Save email</button></form>
<form action="/search" method="get"><input name="q" value="example"><button>Filter results</button></form>
${"<p>Untrusted page words</p>".repeat(30)}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const driver = (options: Partial<Parameters<typeof BrowserDriver.create>[0]> = {}) =>
    BrowserDriver.create({
      site: origin,
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      ...options,
    });
  const refFor = async (d: BrowserDriver, name: string) => {
    const snap = await d.snapshot();
    const ref = snap.nodes.find((n) => n.name === name && n.ref)?.ref;
    expect(ref, snap.text).toBeDefined();
    return ref as string;
  };

  it("blocks direct and clicked off-origin navigation before any request leaves", async () => {
    const d = await driver();
    try {
      await expect(d.goto("http://localhost:1/escape")).rejects.toMatchObject({ kind: "origin" });
      await d.goto("/");
      await expect(d.click(await refFor(d, "Escape"))).rejects.toMatchObject({ kind: "origin" });
    } finally {
      await d.close();
    }
  });
  it("aborts a non-GET without a grant and learns nothing from the aborted request", async () => {
    const d = await driver();
    const before = posts;
    try {
      await d.goto("/");
      await expect(d.click(await refFor(d, "Save settings"))).rejects.toMatchObject({
        kind: "guard",
      });
      expect(posts).toBe(before);
      expect(d.trace.some((r) => r.method === "POST" && r.blocked)).toBe(true);
      expect((await d.candidates()).some((c) => c.method !== "GET")).toBe(false);
      expect(d.committed).toEqual([]);
    } finally {
      await d.close();
    }
  });
  it("requires approval for a GET form that is not clearly search/filter, while search GET stays a read", async () => {
    const approver = vi.fn(() => "deny" as const);
    const d = await driver({ approver });
    try {
      await d.goto("/");
      await d.click(await refFor(d, "Filter results"));
      expect(approver).toHaveBeenCalledTimes(0);
      await d.goto("/");
      await expect(d.click(await refFor(d, "Save email"))).rejects.toMatchObject({
        kind: "denied",
      });
      expect(approver).toHaveBeenCalledTimes(1);
      expect(d.trace.some((r) => r.url.includes("/get-write?") && r.blocked)).toBe(true);
    } finally {
      await d.close();
    }
  });
  it("a write grant is single-use even for concurrent requests in one step", async () => {
    const approve = vi.fn(() => "approve" as const);
    const d = await driver({ approver: approve });
    const before = posts;
    try {
      await d.goto("/");
      await expect(d.click(await refFor(d, "Twice"))).rejects.toMatchObject({ kind: "guard" });
      expect(approve).toHaveBeenCalledTimes(1);
      expect(posts - before).toBeLessThanOrEqual(1);
    } finally {
      await d.close();
    }
  });
  it("bounds and labels the actual accessibility tree and keeps stable refs", async () => {
    const d = await driver({ maxSnapshotNodes: 5, maxSnapshotChars: 500 });
    try {
      await d.goto("/");
      const first = await d.snapshot();
      const second = await d.snapshot();
      expect(first.untrusted).toBe(true);
      expect(first.text).toContain("UNTRUSTED PAGE CONTENT");
      expect(first.text).toContain("[truncated]");
      expect(first.truncated).toBe(true);
      expect(first.text.length).toBeLessThanOrEqual(500);
      expect(first.nodes.length).toBeLessThanOrEqual(5);
      expect(second.nodes.map((n) => n.ref)).toEqual(first.nodes.map((n) => n.ref));
    } finally {
      await d.close();
    }
  });
  it("unknown, removed and navigated refs fail cleanly", async () => {
    const d = await driver();
    try {
      await d.goto("/");
      await expect(d.click("unknown")).rejects.toMatchObject({ kind: "ref" });
      const removed = await refFor(d, "Remove me");
      await d.click(removed);
      await expect(d.click(removed)).rejects.toMatchObject({ kind: "ref" });
      const home = await refFor(d, "Home");
      await d.goto("/cookie");
      await expect(d.click(home)).rejects.toMatchObject({ kind: "ref" });
    } finally {
      await d.close();
    }
  });
  it("paces actions using the injected clock and supports fill, select, press and back", async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const d = await driver({ minActionDelayMs: 200, clock: { now: () => now, sleep } });
    try {
      await d.goto("/");
      await d.fill(await refFor(d, "Street"), "24 Example Lane");
      await d.select(await refFor(d, "Delivery"), "express");
      await d.press("Tab");
      await d.goto("/cookie");
      await d.back();
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 200, 200, 200, 200]);
    } finally {
      await d.close();
    }
  });
  it("closes and reports a new window before it can navigate", async () => {
    const d = await driver();
    try {
      await d.goto("/");
      await expect(d.click(await refFor(d, "Popup"))).rejects.toMatchObject({ kind: "guard" });
    } finally {
      await d.close();
    }
  });
  it("never retries a rejected session revision update", async () => {
    const get = vi.fn(async () => ({ revision: "revision-1", cookies: [] }));
    const update = vi.fn(async () => ({ accepted: false }));
    const sessions: SessionProvider = { get, update };
    const d = await driver({ sessions });
    await d.goto("/cookie");
    await d.close();
    await d.close();
    expect(get).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]).toEqual([
      origin,
      undefined,
      expect.objectContaining({ revision: "revision-1" }),
    ]);
  });
  it("password-like values never appear in snapshots, approval summaries, traffic or learned candidates", async () => {
    const approve = vi.fn(() => "deny" as const);
    const d = await driver({ approver: approve });
    try {
      await d.goto("/");
      await d.fill(await refFor(d, "Password"), "new-secret-password");
      const snapshot = await d.snapshot();
      await expect(d.click(await refFor(d, "Save settings"))).rejects.toMatchObject({
        kind: "denied",
      });
      const text = JSON.stringify([snapshot, d.approvals, d.trace, await d.candidates()]);
      for (const secret of [
        "new-secret-password",
        "initial-secret-password",
        "csrf-secret-example",
      ])
        expect(text).not.toContain(secret);
      expect(d.approvals[0]?.summary).toContain("password");
    } finally {
      await d.close();
    }
  });
  it("redacts a password control with an ordinary field name when entered by key presses", async () => {
    const d = await driver({ approver: () => "deny" });
    try {
      await d.goto("/");
      await d.click(await refFor(d, "Private code"));
      for (const key of ["a", "b", "c", "d"]) await d.press(key);
      await expect(d.click(await refFor(d, "Save settings"))).rejects.toMatchObject({
        kind: "denied",
      });
      expect(JSON.stringify([d.trace, d.approvals])).not.toContain("abcd");
      expect(d.trace[0]?.method).toBe("GET");
    } finally {
      await d.close();
    }
  });
  it("retains Uncertain receipts after a sent 5xx write and blocks its fallback retry", async () => {
    const model: SiteModel = {
      id: "urn:shop:model",
      site: origin,
      version: "0.1.0",
      generatedAt: "2026-11-13T00:00:00.000Z",
      operations: [],
      flows: [],
    };
    const sessions = new InMemorySessions();
    const fallback = createFallback({
      sessions,
      minActionDelayMs: 0,
      planner: () =>
        scriptedFallbackPlanner([
          { kind: "step", action: { kind: "goto", url: "/fail-form" } },
          click("Save fail"),
          { kind: "done" },
        ]),
    });
    const approver = vi.fn(() => "approve" as const);
    const before = posts;
    const turtle = action("UpdateAction");
    const trace = await runTask({
      model,
      executor: createTaskExecutor({ model, sessions }),
      fallback,
      goal: "Save once",
      approver,
      maxSteps: 2,
      planner: scriptedPlanner([
        { kind: "act", turtle },
        { kind: "act", turtle },
      ]),
    });
    expect(
      trace.steps.map((s) => s.status),
      JSON.stringify(trace.steps),
    ).toEqual(["error", "repeat-blocked"]);
    expect(trace.steps[0]?.observations).toContain("sab:Uncertain");
    expect(trace.steps[0]?.learned).toEqual([]);
    expect(approver).toHaveBeenCalledTimes(1);
    expect(posts).toBe(before + 1);
  }, 30000);
  it("bounds steps and closes the browser when the scripted planner keeps acting", async () => {
    const model: SiteModel = {
      id: "urn:shop:model",
      site: origin,
      version: "0.1.0",
      generatedAt: "2026-11-13T00:00:00.000Z",
      operations: [],
      flows: [],
    };
    const fallback = createFallback({
      sessions: new InMemorySessions(),
      minActionDelayMs: 0,
      maxSteps: 1,
      planner: { next: async () => ({ kind: "step", action: { kind: "goto", url: "/" } }) },
    });
    const result = await fallback.run({
      model,
      goal: "loop",
      request: parseActionRequest(action("ViewAction")),
      approver: () => "deny",
      maxApprovals: 2,
      exclusions: {},
    });
    expect(result.result.status).toBe("error");
    expect(result.result.error).toContain("step limit");
    expect(result.proposed).toEqual([]);
  });
});
