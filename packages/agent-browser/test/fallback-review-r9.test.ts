// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { InMemorySessions } from "@jeswr/site-executor";
import { parseActionRequest, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { launchChromium } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import type { CDPSession, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { maskedBrowserAction } from "../src/fallback/planner.js";
import {
  BrowserDriver,
  createFallback,
  createTaskExecutor,
  type FallbackPlannerInput,
  runTask,
  scriptedPlanner,
} from "../src/index.js";

const internals = (driver: BrowserDriver) => driver as unknown as { page: Page; cdp: CDPSession };
const secret = "b7m9r2x49";
const prefix = secret.slice(0, -1);
const html = `<div id="host"></div><input id="ordinary" aria-label="Ordinary">
  <button id="echo">Waiting</button><script>
    const outer = document.querySelector('#host').attachShadow({ mode: 'closed' });
    const host = document.createElement('div'); outer.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<label>Entry<input type="password"></label>';
    const entry = root.querySelector('input');
    const ordinary = document.querySelector('#ordinary');
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get;
    window.fixture = { keys: [], inputs: 0, remove: false,
      value: () => nativeValue.call(entry), connected: () => entry.isConnected,
      ordinary: () => ordinary.focus(), focus: () => entry.focus(),
      spoof: () => {
        Object.defineProperty(document, 'activeElement', { get: () => ordinary });
        Object.defineProperty(Document.prototype, 'activeElement', { get: () => ordinary });
        Object.defineProperty(ShadowRoot.prototype, 'activeElement', { get: () => ordinary });
      }
    };
    entry.addEventListener('keydown', e => window.fixture.keys.push(e.key));
    entry.addEventListener('input', () => {
      window.fixture.inputs++;
      document.querySelector('#echo').textContent = nativeValue.call(entry);
      if (window.fixture.remove) entry.remove();
    });
    entry.focus();
  </script>`;

function noPlaintext(value: unknown): void {
  const output = JSON.stringify(value);
  expect(output).not.toContain(secret);
  expect(output).not.toContain(prefix);
}

async function entryRef(driver: BrowserDriver): Promise<string> {
  const ref = (await driver.snapshot()).nodes.find(
    (node) => node.name === "Entry" && node.ref,
  )?.ref;
  expect(ref).toBeDefined();
  return ref as string;
}

describe("fallback review r9 trusted focus and independent history masking", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(html);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });
  const options = () => ({
    site: origin,
    sessions: new InMemorySessions(),
    launch: launchChromium,
    minActionDelayMs: 0,
    timeoutMs: 1500,
  });
  const model = (): SiteModel => ({
    id: "urn:shop:model",
    site: origin,
    version: "0.1.0",
    generatedAt: "2026-11-14T00:00:00Z",
    operations: [],
    flows: [],
  });

  it("refuses spoofed-focus Backspace before an echo-and-remove handler can expose an edited password", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await driver.fill(await entryRef(driver), secret);
      await page.evaluate("window.fixture.spoof(); window.fixture.remove = true");
      const dispatch = vi.spyOn(page.keyboard, "press");
      await expect(driver.press("Backspace")).rejects.toMatchObject({ kind: "guard" });
      expect(dispatch).not.toHaveBeenCalled();
      expect(await page.evaluate("window.fixture.value()")).toBe(secret);
      expect(await page.evaluate("window.fixture.connected()")).toBe(true);
      expect(await page.evaluate("window.fixture.keys")).toEqual([]);
      expect(await page.evaluate("window.fixture.inputs")).toBe(1);
      const snapshot = await driver.snapshot();
      noPlaintext([snapshot.text, snapshot.nodes, driver.trace, driver.approvals]);
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("refuses every spoofed-focus printable key and type without dispatching input", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate("window.fixture.spoof(); window.fixture.remove = true");
      const press = vi.spyOn(page.keyboard, "press");
      const type = vi.spyOn(page.keyboard, "type");
      for (const key of prefix)
        await expect(driver.press(key)).rejects.toMatchObject({ kind: "guard" });
      await expect(driver.type(prefix)).rejects.toMatchObject({ kind: "guard" });
      expect(press).not.toHaveBeenCalled();
      expect(type).not.toHaveBeenCalled();
      expect(await page.evaluate("window.fixture.value()")).toBe("");
      expect(await page.evaluate("window.fixture.keys")).toEqual([]);
      expect(await page.evaluate("window.fixture.inputs")).toBe(0);
      noPlaintext(await driver.snapshot());
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("ignores hostile getters while typing into an ordinary input verified by native DOM and AX focus", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate(`window.fixture.ordinary();
        Object.defineProperty(document, 'activeElement', { get: () => document.querySelector('#host') });
        Object.defineProperty(Document.prototype, 'activeElement', { get: () => null });
        Object.defineProperty(ShadowRoot.prototype, 'activeElement', { get: () => null });`);
      await driver.press("x");
      await driver.type("yz");
      await driver.press("Backspace");
      expect(await page.locator("#ordinary").inputValue()).toBe("xy");
      expect(await page.evaluate("window.fixture.value()")).toBe("");
      expect(await page.evaluate("window.fixture.keys")).toEqual([]);
    } finally {
      await driver.close();
    }
  });

  it("collects protected live values with native isolated accessors despite a page value getter", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate((value) => {
        // Script entry before the main-world getter starts lying to collectors.
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        const host = document.querySelector("#host");
        // Fixture exposes only native focus, so a script-created protected field supplies this value.
        const input = document.createElement("input");
        input.type = "password";
        set?.call(input, value);
        host?.append(input);
        (document.querySelector("#echo") as HTMLElement).textContent = value;
        Object.defineProperty(HTMLInputElement.prototype, "value", { get: () => "" });
      }, secret);
      expect(driver.credentialContext.secrets.has(secret)).toBe(false);
      noPlaintext(await driver.snapshot());
      expect(driver.credentialContext.secrets.has(secret)).toBe(true);
    } finally {
      await driver.close();
    }
  });

  it.each([
    "missing",
    "different",
    "ambiguous",
    "unfocused partial",
    "document only",
  ])("refuses when trusted AX focus is %s, even for Enter", async (variant) => {
    const driver = await BrowserDriver.create(options());
    const { page, cdp } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate("window.fixture.ordinary()");
      if (variant === "document only") await page.locator("#ordinary").blur();
      const send = cdp.send.bind(cdp);
      vi.spyOn(cdp, "send").mockImplementation(async (method, params) => {
        const result = await send(method, params);
        if (
          (variant !== "unfocused partial" && method === "Accessibility.getFullAXTree") ||
          (variant === "unfocused partial" && method === "Accessibility.getPartialAXTree")
        ) {
          const tree = result as Awaited<
            ReturnType<typeof cdp.send<"Accessibility.getFullAXTree">>
          >;
          const node = tree.nodes.find(
            (node) =>
              node.role?.value !== "RootWebArea" &&
              node.properties?.some((p) => p.name === "focused" && p.value.value === true),
          );
          if (node) {
            if (variant === "different") node.backendDOMNodeId = -1;
            if (variant === "ambiguous") tree.nodes.push({ ...node });
            if (variant === "missing" || variant === "unfocused partial")
              node.properties = node.properties?.filter((p) => p.name !== "focused");
          }
        }
        return result;
      });
      const dispatch = vi.spyOn(page.keyboard, "press");
      await expect(driver.press("Enter")).rejects.toMatchObject({
        kind: "guard",
        message: "Focused element protection could not be determined; keyboard input refused.",
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it.each([
    "edited",
    "keystrokes",
  ])("keeps the spoofed %s reproduction out of both planners, snapshots, traces and approvals", async (variant) => {
    const sessions = new InMemorySessions();
    const currentModel = model();
    const fallbackInputs: FallbackPlannerInput[] = [];
    const taskInputs: unknown[] = [];
    const create = vi.spyOn(BrowserDriver, "create");
    const approve = vi.fn(() => "deny" as const);
    let driver: BrowserDriver | undefined;
    let dispatch: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const trace = await runTask({
        model: currentModel,
        goal: "View fictional orders",
        executor: createTaskExecutor({ model: currentModel, sessions }),
        approver: approve,
        fallback: createFallback({
          ...options(),
          sessions,
          planner: {
            async next(input) {
              driver = await create.mock.results[0]?.value;
              const { page } = internals(driver as BrowserDriver);
              dispatch ??= vi.spyOn(page.keyboard, "press");
              fallbackInputs.push(JSON.parse(JSON.stringify(input)) as FallbackPlannerInput);
              if (variant === "edited" && fallbackInputs.length === 1)
                return {
                  kind: "step",
                  action: {
                    kind: "fill",
                    ref: input.snapshot.nodes.find((node) => node.name === "Entry" && node.ref)
                      ?.ref as string,
                    text: secret,
                  },
                };
              await page.evaluate("window.fixture.spoof(); window.fixture.remove = true");
              return {
                kind: "step",
                action: {
                  kind: "press",
                  key: variant === "edited" ? "Backspace" : (prefix[0] as string),
                },
              };
            },
          },
        }),
        planner: scriptedPlanner([
          { kind: "act", turtle: `[] a <${SCHEMA}ViewAction>.` },
          (input) => {
            taskInputs.push(input);
            return { kind: "answer", text: "Stopped" };
          },
        ]),
      });
      expect(trace.steps[0]?.status).toBe("error");
      expect(trace.steps[0]?.error).toContain("keyboard input refused");
      expect(dispatch).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
      expect(fallbackInputs).toHaveLength(variant === "edited" ? 2 : 1);
      expect(taskInputs).toHaveLength(1);
      if (variant === "edited")
        expect(fallbackInputs[1]?.history[0]?.action).toMatchObject({
          kind: "fill",
          text: "[redacted]",
        });
      else expect(fallbackInputs[0]?.history).toEqual([]);
      noPlaintext([fallbackInputs, taskInputs, trace, driver?.trace, driver?.approvals]);
    } finally {
      vi.restoreAllMocks();
      await driver?.close();
    }
  });

  it("masks printable presses in planner history independently of driver focus inspection", async () => {
    const currentModel = model();
    const create = vi.spyOn(BrowserDriver, "create");
    const keys = [...prefix, "KeyB", "Digit7", "Shift+KeyB", "Space", "+", "Enter"];
    let driver: BrowserDriver | undefined;
    let history: FallbackPlannerInput["history"] = [];
    let count = 0;
    try {
      const fallback = createFallback({
        ...options(),
        planner: {
          async next(input) {
            driver = await create.mock.results[0]?.value;
            // Deliberately bypass dispatch protection: history masking must stand on its own.
            vi.spyOn(driver as BrowserDriver, "act").mockResolvedValue();
            history = structuredClone(input.history);
            const key = keys[count++];
            if (key !== undefined) return { kind: "step", action: { kind: "press", key } };
            if (count === keys.length + 1)
              return { kind: "step", action: { kind: "type", text: secret } };
            return { kind: "give-up", reason: "Stopped" };
          },
        },
      });
      await fallback.run({
        model: currentModel,
        goal: "View fictional orders",
        request: await parseActionRequest(`[] a <${SCHEMA}ViewAction>.`),
        approver: () => "deny",
        maxApprovals: 1,
        exclusions: {},
      });
      expect(history.map((entry) => entry.action)).toEqual([
        ...keys.map((key) => ({
          kind: "press",
          key: key === "Enter" ? "Enter" : "[redacted key]",
        })),
        { kind: "type", text: "[redacted]" },
      ]);
      noPlaintext(history);
    } finally {
      vi.restoreAllMocks();
      await driver?.close();
    }
  });

  it("masks every printable spelling and type text without needing a target or focus result", () => {
    for (const key of [
      "b",
      "7",
      "KeyB",
      "Digit7",
      "Shift+KeyB",
      "Space",
      " ",
      "+",
      "é",
      "Control+v",
    ])
      expect(maskedBrowserAction({ kind: "press", key })).toEqual({
        kind: "press",
        key: "[redacted key]",
      });
    expect(maskedBrowserAction({ kind: "type", text: secret })).toEqual({
      kind: "type",
      text: "[redacted]",
    });
  });
});
