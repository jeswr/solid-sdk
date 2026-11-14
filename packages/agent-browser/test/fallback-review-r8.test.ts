// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { InMemorySessions } from "@jeswr/site-executor";
import { SCHEMA, type SiteModel } from "@jeswr/site-model";
import { launchChromium } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import type { CDPSession, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BrowserDriver,
  createFallback,
  createTaskExecutor,
  type FallbackPlannerInput,
  runTask,
  scriptedFallbackPlanner,
  scriptedPlanner,
} from "../src/index.js";

const internals = (driver: BrowserDriver) => driver as unknown as { page: Page; cdp: CDPSession };
const secret = "b7m9r2x49";
const prefix = secret.slice(0, -1);

// Nested closed roots exercise actual inner focus.
const html = `<div id="host"></div>
  <input aria-label="Ordinary"><button id="echo">Waiting</button>
  <script>
    const outer = document.querySelector('#host').attachShadow({ mode: 'closed' });
    const host = document.createElement('div'); outer.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<form method="post" action="/submit"><label>Entry<input name="entry" type="password"></label><button>Submit</button></form>';
    const entry = root.querySelector('input');
    const ordinary = document.querySelector('input');
    window.fixture = { keys: [], inputs: 0, remove: false, submit: false,
      value: () => entry.value, connected: () => entry.isConnected,
      configure: attrs => { for (const a of [...entry.attributes]) entry.removeAttribute(a.name);
        for (const [key, value] of Object.entries(attrs)) entry.setAttribute(key, value); },
      focus: () => entry.focus(), ordinary: () => ordinary.focus(),
      echoFocus: () => { ordinary.value = entry.value; ordinary.focus(); }
    };
    entry.addEventListener('keydown', e => {
      window.fixture.keys.push(e.key);
      if (e.key === 'Enter' && !window.fixture.submit) e.preventDefault();
    });
    entry.addEventListener('input', () => {
      window.fixture.inputs++;
      document.querySelector('#echo').textContent = entry.value;
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
  const snapshot = await driver.snapshot();
  const ref = snapshot.nodes.find((node) => node.name === "Entry" && node.ref)?.ref;
  expect(snapshot.nodes).toContainEqual(
    expect.objectContaining({ name: "Entry", role: "textbox" }),
  );
  expect(ref).toBeDefined();
  return ref as string;
}

describe("fallback review r8 complete credential entry only", () => {
  let server: Server;
  let origin: string;
  const writes: string[] = [];
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        writes.push(Buffer.concat(chunks).toString());
      }
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

  it("refuses the edited-password reproduction before keydown or input, leaving masked snapshots", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await driver.fill(await entryRef(driver), secret);
      await page.evaluate("window.fixture.remove = true");
      const dispatch = vi.spyOn(page.keyboard, "press");
      await expect(driver.press("Backspace")).rejects.toMatchObject({
        kind: "guard",
        message: expect.stringContaining("complete value"),
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(await page.evaluate("window.fixture.value()")).toBe(secret);
      expect(await page.evaluate("window.fixture.connected()")).toBe(true);
      expect(await page.evaluate("window.fixture.keys")).toEqual([]);
      expect(await page.evaluate("window.fixture.inputs")).toBe(1);
      const snapshot = await driver.snapshot();
      noPlaintext([snapshot.text, snapshot.nodes, driver.trace, driver.approvals]);
      expect(snapshot.nodes).toContainEqual(expect.objectContaining({ name: "[redacted]" }));
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("refuses every printable/editing/modifier spelling and type without sending input", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      // Even an ordinary textbox host must not hide its protected inner focus.
      await page.evaluate("document.querySelector('#host').setAttribute('role', 'textbox')");
      const press = vi.spyOn(page.keyboard, "press");
      const type = vi.spyOn(page.keyboard, "type");
      const insert = vi.spyOn(page.keyboard, "insertText");
      for (const key of [
        ...prefix,
        "KeyB",
        "Digit7",
        "Shift+KeyB",
        "Space",
        "+",
        "Backspace",
        "Delete",
        "ArrowLeft",
        "Shift+ArrowRight",
        "Home",
        "End",
        "Control+a",
        "Control+v",
        "Meta+v",
        "ControlOrMeta+v",
        "Shift+Insert",
        "Control+x",
        "Shift+Tab",
        "Alt+Enter",
        "NumpadEnter",
      ])
        await expect(driver.press(key)).rejects.toMatchObject({ kind: "guard" });
      await expect(driver.type(secret)).rejects.toMatchObject({ kind: "guard" });
      expect(press).not.toHaveBeenCalled();
      expect(type).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(await page.evaluate("window.fixture.value()")).toBe("");
      expect(await page.evaluate("window.fixture.inputs")).toBe(0);
      noPlaintext(await driver.snapshot());
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("uses every snapshot protection rule at dispatch, including credential autocomplete and masked echoes", async () => {
    const driver = await BrowserDriver.create(options());
    const { page, cdp } = internals(driver);
    try {
      await driver.goto("/");
      const press = vi.spyOn(page.keyboard, "press");
      for (const attrs of [
        { type: "password" },
        { autocomplete: "section-login current-password" },
        { autocomplete: "new-password" },
        { autocomplete: "one-time-code" },
        { autocomplete: "username webauthn" },
        { "aria-label": "Private token" },
      ]) {
        await page.evaluate(`window.fixture.configure(${JSON.stringify(attrs)})`);
        await expect(driver.press("b")).rejects.toMatchObject({ kind: "guard" });
      }
      await page.evaluate("window.fixture.configure({ type: 'text' })");
      const send = cdp.send.bind(cdp);
      const ax = vi.spyOn(cdp, "send").mockImplementation(async (method, params) => {
        if (method === "Accessibility.getPartialAXTree") {
          const result = await send(
            "Accessibility.getPartialAXTree",
            params as { backendNodeId: number },
          );
          for (const node of result.nodes) {
            // Chromium protection states extend Playwright's AXPropertyName enum.
            const property = {
              name: "protected",
              value: { type: "boolean", value: true },
            } as unknown as NonNullable<typeof node.properties>[number];
            node.properties = [...(node.properties ?? []), property];
          }
          return result;
        }
        return send(method, params);
      });
      await expect(driver.press("b")).rejects.toMatchObject({ kind: "guard" });
      ax.mockRestore();
      await page.evaluate("window.fixture.configure({ type: 'password' })");
      await driver.fill(await entryRef(driver), secret);
      await page.evaluate("window.fixture.echoFocus()");
      await expect(driver.press("b")).rejects.toMatchObject({ kind: "guard" });
      expect(press).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("allows Enter, Tab and Escape while ordinary printable and editing input still works", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await driver.fill(await entryRef(driver), secret);
      for (const key of ["Enter", "Tab", "Escape"]) {
        await page.evaluate("window.fixture.focus()");
        await driver.press(key);
      }
      expect(await page.evaluate("window.fixture.keys")).toEqual(["Enter", "Tab", "Escape"]);
      await page.evaluate("window.fixture.ordinary()");
      await driver.press("x");
      await driver.type("yz");
      await driver.press("Backspace");
      expect(await page.getByRole("textbox", { name: "Ordinary", exact: true }).inputValue()).toBe(
        "xy",
      );
    } finally {
      await driver.close();
    }
  });

  it("inherits protection from a masked accessibility control across closed shadow roots", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate(`window.fixture.configure({ type: 'text' });
        document.querySelector('#host').setAttribute('role', 'textbox');
        document.querySelector('#host').setAttribute('aria-label', 'Access password');`);
      expect((await driver.snapshot()).nodes).toContainEqual(
        expect.objectContaining({
          name: "Access password",
          value: "[redacted]",
        }),
      );
      const dispatch = vi.spyOn(page.keyboard, "press");
      await expect(driver.press("b")).rejects.toMatchObject({ kind: "guard" });
      expect(dispatch).not.toHaveBeenCalled();
      expect(await page.evaluate("window.fixture.value()")).toBe("");
      await page.evaluate(`window.fixture.configure({ type: 'text', value: ${JSON.stringify(secret)} });
        document.querySelector('#echo').textContent = ${JSON.stringify(secret)};`);
      noPlaintext(await driver.snapshot());
      expect(driver.credentialContext.secrets.has(secret)).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("refuses selection on a protected control before changing its value", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate(() => {
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Secret selection");
        select.add(new Option("First", "first"));
        select.add(new Option("Second", "second"));
        document.body.append(select);
      });
      const ref = (await driver.snapshot()).nodes.find(
        (node) => node.name === "Secret selection" && node.ref,
      )?.ref;
      expect(ref).toBeDefined();
      await expect(driver.select(ref as string, "second")).rejects.toMatchObject({ kind: "guard" });
      expect(await page.locator("select").inputValue()).toBe("first");
    } finally {
      await driver.close();
    }
  });

  it.each([
    "missing",
    "failure",
    "timeout",
    "missing AX",
  ])("refuses unknown focus (%s), even for Enter", async (kind) => {
    const driver = await BrowserDriver.create({ ...options(), timeoutMs: 1000 });
    const { page, cdp } = internals(driver);
    try {
      await driver.goto("/");
      const send = cdp.send.bind(cdp);
      const fault = vi.spyOn(cdp, "send").mockImplementation((method, params) => {
        if (
          method === "Runtime.evaluate" &&
          params &&
          "expression" in params &&
          params.expression === "document.activeElement"
        ) {
          if (kind === "missing")
            return Promise.resolve({ result: { type: "object", subtype: "null", value: null } });
          if (kind === "failure") return Promise.reject(new Error("private renderer detail"));
          if (kind === "timeout") return new Promise(() => {});
        }
        if (kind === "missing AX" && method === "Accessibility.getPartialAXTree")
          return Promise.resolve({ nodes: [] });
        return send(method, params);
      });
      const dispatch = vi.spyOn(page.keyboard, "press");
      await expect(driver.press("Enter")).rejects.toMatchObject({
        kind: "guard",
        message: "Focused element protection could not be determined; keyboard input refused.",
      });
      expect(dispatch).not.toHaveBeenCalled();
      fault.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("rechecks focus after collection and between characters of ordinary type", async () => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await page.evaluate("window.fixture.ordinary()");
      const content = page.content.bind(page);
      vi.spyOn(page, "content").mockImplementationOnce(async () => {
        await page.evaluate("window.fixture.focus()");
        return content();
      });
      const press = vi.spyOn(page.keyboard, "press");
      await expect(driver.press("b")).rejects.toMatchObject({ kind: "guard" });
      expect(press).not.toHaveBeenCalled();
      await page.evaluate(
        `document.querySelector('input').addEventListener('input', () => window.fixture.focus(), { once: true }); window.fixture.ordinary()`,
      );
      await expect(driver.type("ab")).rejects.toMatchObject({ kind: "guard" });
      expect(await page.getByRole("textbox", { name: "Ordinary", exact: true }).inputValue()).toBe(
        "a",
      );
      expect(await page.evaluate("window.fixture.value()")).toBe("");
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it.each([
    "edited",
    "keystrokes",
    "fill and submit",
  ])("keeps %s out of planner inputs, snapshots, traces and approvals", async (variant) => {
    const model: SiteModel = {
      id: "urn:shop:model",
      site: origin,
      version: "0.1.0",
      generatedAt: "2026-11-14T00:00:00Z",
      operations: [],
      flows: [],
    };
    const sessions = new InMemorySessions();
    const fallbackInputs: string[] = [];
    const taskInputs: unknown[] = [];
    const create = vi.spyOn(BrowserDriver, "create");
    const approve = vi.fn(() => "deny" as const);
    const previousWrites = writes.length;
    let driver: BrowserDriver | undefined;
    let dispatch: ReturnType<typeof vi.spyOn> | undefined;
    const steps = scriptedFallbackPlanner(
      variant === "keystrokes"
        ? [...prefix].map((key) => ({ kind: "step", action: { kind: "press", key } }))
        : [
            (input: FallbackPlannerInput) => ({
              kind: "step",
              action: {
                kind: "fill",
                ref: input.snapshot.nodes.find((node) => node.name === "Entry" && node.ref)
                  ?.ref as string,
                text: secret,
              },
            }),
            async () => {
              await internals(driver as BrowserDriver).page.evaluate(
                variant === "edited"
                  ? "window.fixture.remove = true"
                  : "window.fixture.submit = true",
              );
              return {
                kind: "step",
                action: { kind: "press", key: variant === "edited" ? "Backspace" : "Enter" },
              };
            },
          ],
    );
    try {
      const trace = await runTask({
        model,
        goal: "View fictional orders",
        executor: createTaskExecutor({ model, sessions }),
        approver: approve,
        fallback: createFallback({
          ...options(),
          sessions,
          planner: {
            async next(input) {
              driver = await create.mock.results[0]?.value;
              dispatch ??= vi.spyOn(internals(driver as BrowserDriver).page.keyboard, "press");
              fallbackInputs.push(JSON.stringify(input));
              return steps.next(input);
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
      expect(trace.steps[0]?.status).toBe(variant === "fill and submit" ? "denied" : "error");
      noPlaintext([
        fallbackInputs,
        taskInputs,
        trace,
        driver?.trace,
        driver?.approvals,
        approve.mock.calls,
      ]);
      const inputs = fallbackInputs.map((input) => JSON.parse(input) as FallbackPlannerInput);
      if (variant === "keystrokes") {
        expect(dispatch).not.toHaveBeenCalled();
        expect(inputs).toHaveLength(1);
        expect(inputs[0]?.history).toEqual([]);
      } else {
        expect(inputs).toHaveLength(2);
        expect(inputs[1]?.history[0]?.action).toMatchObject({ kind: "fill", text: "[redacted]" });
        if (variant === "edited") expect(dispatch).not.toHaveBeenCalled();
        else {
          expect(dispatch).toHaveBeenCalledExactlyOnceWith("Enter");
          expect(approve).toHaveBeenCalledOnce();
        }
      }
      expect(writes).toHaveLength(previousWrites);
    } finally {
      vi.restoreAllMocks();
      await driver?.close();
    }
  });
});
