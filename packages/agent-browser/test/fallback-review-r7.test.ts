// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import type { SessionProvider } from "@jeswr/site-executor";
import { InMemorySessions } from "@jeswr/site-executor";
import { launchChromium } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BrowserDriver, type BrowserSnapshot } from "../src/index.js";

const internals = (driver: BrowserDriver) =>
  driver as unknown as { page: Page; context: BrowserContext; cdp: CDPSession };

function safeSnapshot(snapshot: BrowserSnapshot, secret: string): void {
  for (const output of [snapshot.text, JSON.stringify(snapshot.nodes)]) {
    expect(output).not.toContain(secret);
    expect(output).toContain("[redacted]");
  }
  expect(snapshot.nodes).toContainEqual(
    expect.objectContaining({ role: "button", name: "[redacted]" }),
  );
  expect(snapshot.nodes).toContainEqual(
    expect.objectContaining({ name: "Public echo", value: "[redacted]" }),
  );
}

/** The control has no exposed shadowRoot path or serialized value attribute. */
async function control(
  page: Page,
  options: {
    closed?: boolean;
    attrs?: Record<string, string>;
    value?: string;
    clearAt?: number;
  } = {},
): Promise<void> {
  await page.evaluate(({ closed, attrs, value, clearAt }) => {
    const host = document.querySelector("#host") as HTMLElement;
    let root: HTMLElement | ShadowRoot = host;
    if (closed) {
      const outer = host.attachShadow({ mode: "closed" });
      const inner = document.createElement("div");
      outer.append(inner);
      root = inner.attachShadow({ mode: "closed" });
    }
    const label = document.createElement("label");
    label.textContent = "Entry";
    const entry = document.createElement("input");
    for (const [key, item] of Object.entries(attrs ?? { type: "password" }))
      entry.setAttribute(key, item);
    const echo = () => {
      (document.querySelector("#echo") as HTMLElement).textContent = entry.value;
      (document.querySelector('[aria-label="Public echo"]') as HTMLInputElement).value =
        entry.value;
      if (clearAt && entry.value.length >= clearAt) {
        entry.value = "";
        entry.remove();
      }
    };
    entry.addEventListener("input", echo);
    label.append(entry);
    root.append(label);
    entry.focus();
    if (value) {
      entry.value = value;
      echo();
    }
  }, options);
}

describe("fallback review r7 closed-shadow credentials and independent persistence", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(
        '<div id="host"></div><button id="echo">Waiting</button><input aria-label="Public echo">',
      );
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

  it("redacts the review's closed-shadow press echo in snapshot.nodes and snapshot.text", async () => {
    const driver = await BrowserDriver.create(options());
    const secret = "b7m9r2x4";
    try {
      await driver.goto("/");
      await control(internals(driver).page, { closed: true });
      for (const key of secret) await driver.press(key);
      expect(driver.credentialContext.secrets.has(secret)).toBe(true);
      safeSnapshot(await driver.snapshot(), secret);
    } finally {
      await driver.close();
    }
  });

  it.each<Record<string, string>>([
    { type: "password" },
    { autocomplete: "section-login current-password" },
    { autocomplete: "new-password" },
    { autocomplete: "one-time-code" },
    { "aria-label": "Private token" },
  ])("collects a script-set closed-shadow live value with %j through CDP", async (attrs) => {
    const driver = await BrowserDriver.create(options());
    const secret = attrs.autocomplete === "one-time-code" ? "482693" : "ClosedEntry_9137";
    try {
      await driver.goto("/");
      await control(internals(driver).page, { closed: true, attrs, value: secret });
      expect(driver.credentialContext.secrets.has(secret)).toBe(false);
      safeSnapshot(await driver.snapshot(), secret);
      expect(driver.credentialContext.secrets.has(secret)).toBe(true);
    } finally {
      await driver.close();
    }
  });

  it.each([
    { secret: "b7m9r2x4", keys: [..."b7m9r2x4"] },
    {
      secret: "B7m9R2X$",
      keys: [
        "Shift+KeyB",
        "Digit7",
        "KeyM",
        "Digit9",
        "ShiftRight+KeyR",
        "Digit2",
        "Shift+KeyX",
        "Shift+Digit4",
      ],
    },
  ])("registers $secret before press dispatch even if the input handler removes it", async ({
    secret,
    keys,
  }) => {
    const driver = await BrowserDriver.create(options());
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await control(page, { closed: true, clearAt: secret.length });
      const press = page.keyboard.press.bind(page.keyboard);
      let count = 0;
      const dispatch = vi.spyOn(page.keyboard, "press").mockImplementation(async (key) => {
        const value = secret.slice(0, ++count);
        if (value.length >= 4) expect(driver.credentialContext.secrets.has(value)).toBe(true);
        await press(key);
      });
      for (const key of keys) await driver.press(key);
      expect(dispatch).toHaveBeenCalledTimes(secret.length);
      dispatch.mockRestore();
      safeSnapshot(await driver.snapshot(), secret);
    } finally {
      await driver.close();
    }
  });

  it("registers a closed-shadow paste before dispatch even when its input handler removes the value", async () => {
    const driver = await BrowserDriver.create(options());
    const secret = "PastedEntry_3817";
    const { page, context } = internals(driver);
    try {
      await driver.goto("/");
      await control(page, { closed: true, clearAt: secret.length });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      await page.evaluate((text) => navigator.clipboard.writeText(text), secret);
      const press = page.keyboard.press.bind(page.keyboard);
      const dispatch = vi.spyOn(page.keyboard, "press").mockImplementation(async (key) => {
        expect(driver.credentialContext.secrets.has(secret)).toBe(true);
        await press(key);
      });
      await driver.press("Control+v");
      expect(dispatch).toHaveBeenCalledTimes(1);
      dispatch.mockRestore();
      safeSnapshot(await driver.snapshot(), secret);
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it.each([false, true])("registers fill before dispatch (closed shadow: %s)", async (closed) => {
    const driver = await BrowserDriver.create(options());
    const secret = "FilledEntry_8246";
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await control(page, { closed, clearAt: secret.length });
      const ref = (await driver.snapshot()).nodes.find(
        (node) => node.role === "textbox" && node.name === "Entry",
      )?.ref;
      expect(ref).toBeDefined();
      if (closed) {
        const insert = page.keyboard.insertText.bind(page.keyboard);
        vi.spyOn(page.keyboard, "insertText").mockImplementation(async (text) => {
          expect(driver.credentialContext.secrets.has(text)).toBe(true);
          await insert(text);
        });
      } else {
        const locator = page.locator("#host input");
        const fill = locator.fill.bind(locator);
        vi.spyOn(locator, "fill").mockImplementation(async (text) => {
          expect(driver.credentialContext.secrets.has(text)).toBe(true);
          await fill(text);
        });
        vi.spyOn(page, "locator").mockReturnValue(locator);
      }
      await driver.fill(ref as string, secret);
      safeSnapshot(await driver.snapshot(), secret);
    } finally {
      vi.restoreAllMocks();
      await driver.close();
    }
  });

  it("honors password-like accessibility names before dispatch without credential DOM attributes", async () => {
    const driver = await BrowserDriver.create(options());
    const secret = "NamedEntry_7351";
    const { page } = internals(driver);
    try {
      await driver.goto("/");
      await control(page, { attrs: { type: "text" }, clearAt: secret.length });
      await page.locator("#host label").evaluate((label) => {
        (label.firstChild as Text).textContent = "Access password";
      });
      const ref = (await driver.snapshot()).nodes.find(
        (node) => node.role === "textbox" && node.name === "Access password",
      )?.ref;
      await driver.fill(ref as string, secret);
      safeSnapshot(await driver.snapshot(), secret);
    } finally {
      await driver.close();
    }
  });

  it.each([
    "timeout",
    "failure",
  ])("withholds the snapshot on credential collection %s", async (kind) => {
    const driver = await BrowserDriver.create(options());
    const { page, cdp } = internals(driver);
    let send: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await driver.goto("/");
      await control(page, { closed: true, value: "UncollectedEntry_6420" });
      const original = cdp.send.bind(cdp);
      send = vi.spyOn(cdp, "send").mockImplementation((method, params) => {
        if (method === "DOM.getDocument")
          return kind === "timeout"
            ? new Promise(() => {})
            : Promise.reject(new Error("Target crashed: private renderer detail"));
        return original(method, params);
      });
      const rendered = vi.fn();
      await expect(driver.snapshot().then(rendered)).rejects.toMatchObject({
        kind: kind === "timeout" ? "limit" : "browser",
        message:
          kind === "timeout"
            ? "Live credential collection timed out; page content withheld."
            : "Live credential collection failed; page content withheld.",
      });
      expect(rendered).not.toHaveBeenCalled();
      expect(
        send.mock.calls.some(([method]: [string]) => method === "Accessibility.getFullAXTree"),
      ).toBe(false);
    } finally {
      send?.mockRestore();
      await driver.close();
    }
  });

  it.each([
    "Target crashed",
    "CDP timeout",
  ])("persists rotated cookies exactly once despite %s and concurrent closes", async (kind) => {
    let finishUpdate!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishUpdate = resolve;
    });
    const get = vi.fn(async () => ({
      revision: "original-revision",
      cookies: [],
      credentialCookies: ["sid"],
    }));
    const update = vi.fn(async () => {
      await pending;
      return { accepted: true, revision: "next-revision" };
    });
    const sessions: SessionProvider = { get, update };
    const driver = await BrowserDriver.create({ ...options(), sessions });
    const { page, cdp, context } = internals(driver);
    try {
      await driver.goto("/");
      await context.addCookies([
        { name: "sid", value: "RotatedCookie_5938", url: origin, httpOnly: true },
      ]);
      if (kind === "Target crashed")
        vi.spyOn(page, "evaluate").mockRejectedValue(new Error("Target crashed"));
      else {
        const original = cdp.send.bind(cdp);
        vi.spyOn(cdp, "send").mockImplementation((method, params) =>
          method === "DOM.getDocument" ? new Promise(() => {}) : original(method, params),
        );
      }
      const first = driver.close();
      let secondFinished = false;
      const second = driver.close().then(() => {
        secondFinished = true;
      });
      await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 4000 });
      expect(secondFinished).toBe(false);
      expect(get).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]).toEqual([
        origin,
        undefined,
        expect.objectContaining({
          revision: "original-revision",
          credentialCookies: ["sid"],
          cookies: [expect.objectContaining({ name: "sid", value: "RotatedCookie_5938" })],
        }),
      ]);
      finishUpdate();
      await Promise.all([first, second, driver.close()]);
      expect(secondFinished).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
      expect(driver.refreshError).toBe("Fallback live credential collection failed during close.");
    } finally {
      finishUpdate();
      vi.restoreAllMocks();
      await driver.close();
    }
  });
});
