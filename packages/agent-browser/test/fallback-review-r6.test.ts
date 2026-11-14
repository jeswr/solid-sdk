// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { InMemorySessions, secretRedactor } from "@jeswr/site-executor";
import { SCHEMA, type SiteModel } from "@jeswr/site-model";
import { launchChromium } from "@jeswr/site-profiler";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isCredentialKey } from "../src/fallback/redact.js";
import {
  BrowserDriver,
  type BrowserSnapshot,
  createFallback,
  createTaskExecutor,
  runTask,
  scriptedFallbackPlanner,
  scriptedPlanner,
} from "../src/index.js";

const aliasSecret = "AliasCredential_9137";
const fragmentSecret = "FragmentCredential_8246";
const redirectSecret = "RedirectCredential_7351";
const linkSecret = "LinkCredential_6420";
const formSecret = "FormCredential_5938";
const requestSecret = "RequestCredential_4268";
const encodedSecret = "Encoded Credential/3817+";
const pageOf = (driver: BrowserDriver): Page => (driver as unknown as { page: Page }).page;
const emptyModel = (site: string): SiteModel => ({
  id: "urn:shop:model",
  site,
  version: "0.1.0",
  generatedAt: "2026-11-14T00:00:00.000Z",
  operations: [],
  flows: [],
});

function safe(value: unknown, secrets: readonly string[]): void {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) expect(output).not.toContain(secret);
  expect(output).toContain("[redacted]");
}

describe("fallback review r6 credential intake", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://shop.test");
      if (url.pathname === "/orders") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ items: [{ orderNumber: "5010", name: aliasSecret }] }));
      } else if (url.pathname === "/redirect") {
        res.writeHead(302, { location: `/landing?SeSs=${redirectSecret}#SiD=${fragmentSecret}` });
        res.end();
      } else if (url.pathname === "/landing") {
        res.setHeader("content-type", "text/html");
        res.end(`<button>${redirectSecret} ${fragmentSecret}</button>`);
      } else if (url.pathname === "/fragment") {
        res.setHeader("content-type", "text/html");
        res.end(
          `<button>${fragmentSecret}</button><input aria-label="Public echo" value="${fragmentSecret}">`,
        );
      } else if (url.pathname === "/urls") {
        res.setHeader("content-type", "text/html");
        res.end(
          `<a href="/unused?sid=${linkSecret}">Public link</a>
          <form action="/unused#connect.sid=${formSecret}"><button>Continue</button></form>
          <button>${linkSecret} ${formSecret}</button>`,
        );
      } else if (url.pathname === "/request") {
        res.setHeader("content-type", "text/html");
        res.end(
          `<script>fetch('/data?PHPSESSID=${requestSecret}').then(r=>r.text()).then(t=>document.querySelector('button').textContent=t)</script><button>Waiting</button>`,
        );
      } else if (url.pathname === "/data") {
        res.setHeader("content-type", "text/plain");
        res.end(requestSecret);
      } else if (url.pathname === "/encoded") {
        res.setHeader("content-type", "text/html");
        res.end(
          `<button>${encodedSecret}</button><input aria-label="Public echo" value="${encodeURIComponent(encodedSecret)}">`,
        );
      } else if (url.pathname === "/submit") {
        const body: Buffer[] = [];
        for await (const chunk of req) body.push(Buffer.from(chunk));
        res.setHeader("content-type", "text/html");
        res.end(
          `<button>${new URLSearchParams(Buffer.concat(body).toString()).get("entry")}</button>`,
        );
      } else if (url.pathname === "/controls") {
        res.setHeader("content-type", "text/html");
        res.end(
          `<form method="post" action="/submit">
            <input type="password" name="entry" aria-label="Entry">
            <button>Submit entry</button>
          </form>
          <input aria-label="Public echo"><button id="echo">Waiting</button>
          <script>
            document.querySelector('[name=entry]').addEventListener('input', e => {
              document.querySelector('#echo').textContent = e.target.value;
              document.querySelector('[aria-label="Public echo"]').value = e.target.value;
            });
          </script>`,
        );
      } else {
        res.setHeader("content-type", "text/html");
        res.end(
          `<button>${aliasSecret}</button><input aria-label="Public echo" value="${aliasSecret}">`,
        );
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const driverOptions = () => ({
    site: origin,
    sessions: new InMemorySessions(),
    minActionDelayMs: 0,
    launch: launchChromium,
  });

  it("redacts sid echoes in snapshots, driver/task traces, replay RDF and the next planner input", async () => {
    const sessions = new InMemorySessions();
    const model = emptyModel(origin);
    const snapshots: BrowserSnapshot[] = [];
    const transport = vi.fn(async () =>
      Response.json({ items: [{ orderNumber: "5010", name: aliasSecret }] }),
    );
    const fallback = createFallback({
      sessions,
      transport,
      minActionDelayMs: 0,
      launch: launchChromium,
      planner: () =>
        scriptedFallbackPlanner([
          { kind: "step", action: { kind: "goto", url: `/?sid=${aliasSecret}` } },
          (input) => {
            snapshots.push(input.snapshot);
            return { kind: "step", action: { kind: "goto", url: "/orders" } };
          },
          { kind: "done" },
        ]),
    });
    const create = vi.spyOn(BrowserDriver, "create");
    const inputs: unknown[] = [];
    try {
      const trace = await runTask({
        model,
        executor: createTaskExecutor({ model, sessions, fetch: transport }),
        fallback,
        goal: "View orders twice",
        approver: () => "deny",
        planner: scriptedPlanner([
          { kind: "act", turtle: `[] a <${SCHEMA}ViewAction>.` },
          (input) => {
            inputs.push(input);
            return { kind: "act", turtle: `[] a <${SCHEMA}ViewAction>.` };
          },
          (input) => {
            inputs.push(input);
            return { kind: "answer", text: "Done" };
          },
        ]),
      });
      expect(trace.steps.map((step) => step.status)).toEqual(["done", "done", "answer"]);
      expect(trace.steps[0]?.via).toBe("fallback");
      expect(trace.steps[1]?.via).toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(2); // Read verification and learned executor replay.
      expect(create).toHaveBeenCalledTimes(1);
      const driver = await create.mock.results[0]?.value;
      expect(driver.credentialContext.secrets.has(aliasSecret)).toBe(true);
      expect(snapshots).toHaveLength(1);
      safe(snapshots[0]?.text, [aliasSecret]);
      safe(snapshots[0]?.nodes, [aliasSecret]);
      safe(driver.trace, [aliasSecret]);
      safe(trace, [aliasSecret]);
      for (const input of inputs) safe(input, [aliasSecret]);
      for (const step of trace.steps.slice(0, 2)) safe(step.observations, [aliasSecret]);
    } finally {
      create.mockRestore();
    }
  });

  it.each([
    ["fragment", `/fragment#SiD=${fragmentSecret}`, [fragmentSecret]],
    ["redirect hops", "/redirect", [redirectSecret, fragmentSecret]],
    ["links and form actions", "/urls", [linkSecret, formSecret]],
    ["recorded requests", "/request", [requestSecret]],
    [
      "encoded parameters",
      `/encoded?connect.sid=${encodeURIComponent(encodedSecret)}`,
      [encodedSecret],
    ],
  ])("registers credential values from %s before snapshot or trace exposure", async (_kind, url, secrets) => {
    const driver = await BrowserDriver.create(driverOptions());
    try {
      await driver.goto(url);
      // Check intake before calling snapshot/trace: display URL scrubbing alone cannot pass.
      for (const secret of secrets) expect(driver.credentialContext.secrets.has(secret)).toBe(true);
      const snapshot = await driver.snapshot();
      safe(snapshot.text, secrets);
      safe(snapshot.nodes, secrets);
      safe(driver.trace, secrets);
    } finally {
      await driver.close();
    }
  });

  it("uses the shared URL key policy for every alias and the executor's encoded forms", async () => {
    const aliases = [
      "sid",
      "sess",
      "PHPSESSID",
      "connect.sid",
      "X-XSRF-TOKEN",
      "api_key",
      "state",
      "code",
    ];
    const driver = await BrowserDriver.create(driverOptions());
    try {
      const query = new URLSearchParams();
      const fragment = new URLSearchParams();
      const secrets = aliases.flatMap((key, i) => {
        expect(isCredentialKey(key.toUpperCase())).toBe(true);
        const values = [`QueryCredential_${i}`, `FragmentCredential_${i}`];
        query.append(key.toUpperCase(), values[0] as string);
        fragment.append(key, values[1] as string);
        return values;
      });
      await driver.goto(`/?${query}#${fragment}`);
      const redact = secretRedactor(driver.credentialContext.secrets);
      for (const secret of secrets) {
        expect(driver.credentialContext.secrets.has(secret)).toBe(true);
        for (const form of [
          secret,
          encodeURIComponent(secret),
          Buffer.from(secret).toString("base64"),
        ])
          expect(redact(form)).toBe("[redacted]");
      }
      expect(driver.credentialContext.secrets.has(aliasSecret)).toBe(false);
    } finally {
      await driver.close();
    }
  });

  it("refuses password presses and registers a complete fill before rendering either snapshot form", async () => {
    const driver = await BrowserDriver.create(driverOptions());
    const password = "b7m9r2x4";
    try {
      await driver.goto("/controls");
      const ref = (await driver.snapshot()).nodes.find((node) => node.name === "Entry")?.ref;
      expect(ref).toBeDefined();
      await driver.click(ref as string);
      for (const character of password)
        await expect(driver.press(character)).rejects.toMatchObject({ kind: "guard" });
      expect(await pageOf(driver).locator('[name="entry"]').inputValue()).toBe("");
      await driver.fill(ref as string, password);
      expect(await pageOf(driver).locator('[name="entry"]').getAttribute("value")).toBeNull();
      expect(driver.credentialContext.secrets.has(password)).toBe(true);
      const snapshot = await driver.snapshot();
      expect(snapshot.nodes).toContainEqual(
        expect.objectContaining({ role: "button", name: "[redacted]" }),
      );
      expect(snapshot.nodes).toContainEqual(
        expect.objectContaining({ name: "Public echo", value: "[redacted]" }),
      );
      safe(snapshot.text, [password]);
      safe(snapshot.nodes, [password]);
    } finally {
      await driver.close();
    }
  });

  it.each([
    ["one-time-code", { autocomplete: "one-time-code", type: "text" }, "482693"],
    [
      "current-password",
      { autocomplete: "section-login current-password", type: "text" },
      "CurrentEntry_9137",
    ],
    ["new-password", { autocomplete: "new-password", type: "text" }, "NewEntry_8246"],
    ["existing snapshot mask", { "aria-label": "Private token", type: "text" }, "MaskedEntry_7351"],
  ])("registers a live %s value set by script with no input event", async (_kind, attrs, secret) => {
    const driver = await BrowserDriver.create(driverOptions());
    try {
      await driver.goto("/controls");
      await pageOf(driver).evaluate(
        ({ attrs, secret }) => {
          const control = document.querySelector("[name=entry]") as HTMLInputElement;
          for (const [key, value] of Object.entries(attrs))
            if (value !== undefined) control.setAttribute(key, value);
          control.value = secret;
          (document.querySelector("#echo") as HTMLButtonElement).textContent = secret;
          (document.querySelector('[aria-label="Public echo"]') as HTMLInputElement).value = secret;
        },
        { attrs, secret },
      );
      expect(driver.credentialContext.secrets.has(secret)).toBe(false);
      const snapshot = await driver.snapshot();
      expect(driver.credentialContext.secrets.has(secret)).toBe(true);
      safe(snapshot.text, [secret]);
      safe(snapshot.nodes, [secret]);
    } finally {
      await driver.close();
    }
  });

  it("registers script-set live values before recording a submission without a snapshot", async () => {
    const secret = "SubmissionEntry_6420";
    const driver = await BrowserDriver.create({
      ...driverOptions(),
      approver: () => {
        expect(driver.credentialContext.secrets.has(secret)).toBe(true);
        safe(driver.trace, [secret]);
        return "approve";
      },
    });
    try {
      await driver.goto("/controls");
      await pageOf(driver).evaluate((secret) => {
        // Enter needs a control with verified focus, even when a document handler submits.
        document.querySelector<HTMLInputElement>("[name=entry]")?.focus();
        document.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const control = document.querySelector("[name=entry]") as HTMLInputElement;
          control.value = secret;
          control.form?.requestSubmit();
        });
      }, secret);
      expect(driver.credentialContext.secrets.has(secret)).toBe(false);
      await driver.press("Enter");
      expect(driver.approvals).toHaveLength(1);
      safe(driver.trace, [secret]);
      const snapshot = await driver.snapshot();
      safe(snapshot.text, [secret]);
      safe(snapshot.nodes, [secret]);
    } finally {
      await driver.close();
    }
  });
});
