// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createExecutor, InMemorySessions } from "@jeswr/site-executor";
import { type Operation, SCHEMA } from "@jeswr/site-model";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { crawl } from "../src/crawl.js";
import { formFields } from "../src/form-body.js";
import { performLogin } from "../src/login.js";
import { launchChromium, profileSite } from "../src/profile.js";
import { BODY_LIMIT, Recorder } from "../src/recorder.js";
import { redactOutput } from "../src/session-tokens.js";
import { playwrightReplayer } from "../src/verify.js";
import * as deletedProbes from "../src/write-not-found.js";
import * as responsePolicies from "../src/write-responses.js";

let browser: Browser;
let origin: string;
const hits: string[] = [];
const site = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://fixture.test").pathname;
  hits.push(`${req.method} ${path}`);
  const html = (body: string) => {
    res.setHeader("content-type", "text/html");
    res.end(body);
  };
  if (path === "/final-probe-cookie") {
    res.setHeader("set-cookie", "session=final-probe-credential-escaped; HttpOnly; Path=/");
    res.statusCode = 404;
    return html("<h1>Not found</h1><p>final-probe-credential-escaped</p>");
  }
  if (path === "/final-probe-hidden" || path === "/final-probe-oversized") {
    const secret = "final-probe-credential-escaped";
    res.statusCode = 404;
    return html(
      `<h1>Not found</h1><p>${secret}</p>${" ".repeat(BODY_LIMIT + 1024)}<input type="hidden" name="csrf_token" value="${secret}">${path.endsWith("oversized") ? " ".repeat(8 * 1024 * 1024) : ""}`,
    );
  }
  if (path === "/probe-csrf") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ token: "fictional-csrf-secret" }));
  }
  if (path === "/locator-login" && req.method === "POST") {
    res.writeHead(303, {
      location: "/locator-home",
      "set-cookie": "sid=locator-session-credential; HttpOnly; Path=/",
    });
    return res.end();
  }
  if (path === "/locator-login") {
    return html(
      `<form id="login-form" method="post"><input name="username"><input type="password" name="password"><input type="hidden" name="form_key" value="locator-form-credential"><button>Sign in</button></form><script src="/locator-config.js"></script>`,
    );
  }
  if (path === "/locator-config.js") {
    res.setHeader("content-type", "application/javascript");
    return res.end(`window.config={formKeyInputSelector:'input[name="form_key"]'};`);
  }
  if (path === "/locator-home") {
    if (!req.headers.cookie?.includes("sid=locator-session-credential")) res.statusCode = 401;
    return html("<h1>Example</h1>");
  }
  if (path.startsWith("/multi-cookies-")) {
    res.setHeader("set-cookie", [
      "sid=fictional-session-secret; Path=/",
      "pref=fictional-preference; Path=/",
    ]);
    res.setHeader("content-type", "application/json");
    if (path.endsWith("redirect")) {
      res.writeHead(303, { location: "/portal/home" });
      return res.end();
    }
    if (path.endsWith("cached")) res.setHeader("age", "2");
    return res.end(
      JSON.stringify({
        id: "42",
        sku: "EX-42",
        name: "Example widget",
        url: `${origin}/products/42`,
      }),
    );
  }
  if (path === "/short-login" && req.method === "POST") {
    res.writeHead(303, { location: "/short-landing" });
    return res.end();
  }
  if (path === "/short-landing") {
    res.setHeader("set-cookie", "key=Ab7xQ2; Path=/");
    return html("<h1>Signed in Ab7xQ2</h1>");
  }
  if (path === "/short-login") {
    if (req.headers.cookie?.includes("key="))
      return html(
        '<h1>Example Ab7xQ2</h1><script>fetch("/blocked/Ab7xQ2", { method: "POST" }).catch(()=>{})</script>',
      );
    return html(
      '<form method="post"><input name="username"><input name="password" type="password"><button>Sign in</button></form>',
    );
  }
  if (path === "/portal/search") {
    html(
      '<script>fetch("/portal/filtered-data?search=none",{headers:{"X-Requested-With":"XMLHttpRequest"}})</script>',
    );
    return;
  }
  if (path === "/portal/filtered-data") {
    if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
      html("<h1>Page</h1>");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        totalRecords: req.url?.includes("search=none") ? 0 : 1,
        items: req.url?.includes("search=none")
          ? []
          : [{ id: 1, name: "Example Widget", price: "1.00" }],
      }),
    );
    return;
  }
  if (path === "/demo-form") {
    html(
      '<form method="post" action="/demo-save"><textarea name="entry[body]"></textarea><input type="hidden" name="entry[_token]" value="demonstration-only-csrf-secret"><button>Save</button></form>',
    );
    return;
  }
  if (path === "/demo-save" && req.method === "POST") {
    res.writeHead(303, { location: "/demo-start" });
    res.end();
    return;
  }
  if (path === "/stall") return;
  if (path === "/entry") {
    res.writeHead(302, { location: "/portal" });
    res.end();
    return;
  }
  if (path === "/portal" && req.method === "POST") {
    res.writeHead(303, {
      "set-cookie": "sid=signed-in-fixture-session; Path=/portal; HttpOnly",
      location: "/portal/home",
    });
    res.end();
    return;
  }
  if (path === "/portal") {
    res.setHeader("set-cookie", "preference=1; Path=/");
    html(
      '<form method="post"><input name="account[username]"><input name="account[password]" type="password"><button>Sign in</button></form>',
    );
    return;
  }
  if (path === "/portal/home") {
    html(
      '<a href="/detail/1">Example</a><nav><a href="/portal/items">Items</a><a href="/reset">Reset</a></nav><script>fetch("/background",{method:"POST"})</script>',
    );
    return;
  }
  if (path === "/portal/items") {
    html('<script>setTimeout(()=>fetch("/portal/data"),150)</script>');
    return;
  }
  if (path === "/portal/data") {
    res.setHeader("content-type", "application/json");
    res.end('{"items":[{"id":1,"name":"Example"}]}');
    return;
  }
  html("<h1>Example</h1>");
});
beforeAll(async () => {
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await launchChromium();
});
afterAll(async () => {
  await browser?.close();
  site.closeAllConnections();
  await new Promise<void>((resolve) => site.close(() => resolve()));
});

it.each([
  "hidden",
  "oversized",
])("discovers credentials in complete recorded browser traffic before sampling: %s", async (source) => {
  const context = await browser.newContext();
  const recorder = new Recorder(origin);
  recorder.phase = "demonstration";
  await recorder.attach(context);
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/final-probe-${source}`);
    await recorder.flush();
    const entry = recorder.trace.find((r) => r.url.endsWith(`/final-probe-${source}`));
    expect(recorder.secrets).toContain("final-probe-credential-escaped");
    if (source === "oversized") {
      expect(entry?.bodySample).toBeUndefined();
      expect(entry?.responsePageFailure).toBe(true);
      expect(entry?.verificationEvidence).toBeUndefined();
      expect(entry?.notFoundEvidence).toBeUndefined();
    } else {
      expect(entry?.bodyTruncated).toBe(true);
      expect(entry?.bodySample).not.toContain("csrf_token");
    }
    expect(JSON.stringify(redactOutput(recorder.trace, recorder.secrets))).not.toContain(
      "final-probe-credential-escaped",
    );
  } finally {
    await context.close();
  }
});

it("does not learn from oversized rendered crawl pages", async () => {
  const result = await profileSite({
    startUrl: `${origin}/final-probe-oversized`,
    browser,
    maxPages: 1,
    verify: false,
  });
  expect(result.model.operations).toEqual([]);
  expect(result.warnings).toContain("crawl: omitted page exceeding the response limit");
  expect(result.trace.every((r) => r.bodySample === undefined)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("final-probe-credential-escaped");
});

it.each([
  "cookie",
  "hidden",
  "oversized",
])("uses the final probe %s credential union for every output", async (source) => {
  const secret = "final-probe-credential-escaped";
  const probe = vi
    .spyOn(deletedProbes, "probeDeletedResources")
    .mockImplementation(async (operations, trace, siteOrigin, replayer) => {
      expect(operations.length).toBeGreaterThan(0);
      const op = operations[0];
      if (!op) throw new Error("Missing learned operation");
      op.label = `Example ${secret}`;
      const sample = trace[0];
      if (!sample) throw new Error("Missing earlier trace");
      sample.formState = [
        { action: siteOrigin, method: "POST", fields: [{ name: "example", value: secret }] },
      ];
      sample.verificationEvidence = {
        extraction: {
          format: "json",
          itemType: `${SCHEMA}Product`,
          fields: [{ property: `${SCHEMA}name`, path: "/echo" }],
        },
        items: [{ echo: [secret] }],
        trustedItems: [{ echo: [secret] }],
      };
      await replayer
        .get(`${siteOrigin}/final-probe-${source}`, { signedIn: true })
        .catch((error) => {
          if (source !== "oversized") throw error;
          expect(error.message).toContain("byte limit");
        });
    });
  const policies = vi.spyOn(responsePolicies, "learnWriteResponses").mockReturnValue({
    "urn:secret-policy": { createdLocationPattern: `/products/${secret}` },
    [`urn:${secret}`]: { createdLocationPattern: "/products/{id}" },
  });
  try {
    const result = await profileSite({
      startUrl: `${origin}/portal/search`,
      browser,
      maxPages: 1,
      demonstrations: [
        {
          name: "warning",
          run: async () => {
            throw new Error(`Example ${secret}`);
          },
        },
      ],
    });
    expect(probe).toHaveBeenCalledOnce();
    expect(hits).toContain(`GET /final-probe-${source}`);
    expect(result.model.operations.some((op) => op.label === "Example [redacted]")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("[redacted]"))).toBe(true);
    expect(result.trace[0]?.formState?.[0]?.fields[0]?.value).toBe("[redacted]");
    expect(result.trace[0]?.verificationEvidence?.items).toEqual([{ echo: ["[redacted]"] }]);
    expect(result.trace[0]?.verificationEvidence?.trustedItems).toEqual([{ echo: ["[redacted]"] }]);
    const recorded = result.trace.find((r) => r.url.endsWith(`/final-probe-${source}`));
    if (source === "oversized") expect(recorded?.bodySample).toBeUndefined();
    else expect(recorded?.bodySample).toContain("[redacted]");
    expect(result.writeResponses).toEqual({});
    expect(JSON.stringify(result)).not.toContain(secret);
  } finally {
    probe.mockRestore();
    policies.mockRestore();
  }
});

it("retains a witnessed login CSRF locator while redacting its actual credential values", async () => {
  const result = await profileSite({
    startUrl: `${origin}/locator-login`,
    browser,
    maxPages: 1,
    verify: false,
    login: { username: "alex", password: "fictional-password" },
  });
  const login = result.model.operations.find((op) => op.actionType.endsWith("LoginAction"));
  expect(login?.csrf?.[0]?.source).toMatchObject({
    kind: "html",
    selector: 'form#login-form input[name="form_key"]',
  });
  expect(result.model.login?.[0]?.probeUrl).toBe(`${origin}/locator-home`);
  for (const secret of ["locator-form-credential", "locator-session-credential"])
    expect(JSON.stringify(result)).not.toContain(secret);
});

it("authorizes deleted-resource CSRF preparation and the decorated read before sending", async () => {
  const context = await browser.newContext();
  const recorder = new Recorder(origin);
  const replayer = playwrightReplayer(context, recorder, "verify");
  const options = {
    signedIn: true,
    request: { method: "GET" as const, urlTemplate: `${origin}/probe-result` },
    csrf: [
      {
        source: { kind: "json" as const, urlTemplate: `${origin}/probe-csrf`, pointer: "/token" },
        target: { kind: "query" as const, name: "csrf" },
      },
    ],
  };
  try {
    hits.length = 0;
    await expect(
      replayer.get(`${origin}/probe-result`, {
        ...options,
        authorize: async () => {
          throw new Error("Denied preparation");
        },
      }),
    ).rejects.toThrow("Denied preparation");
    expect(hits).toEqual([]);
    const allowed: string[] = [];
    await expect(
      replayer.get(`${origin}/probe-result`, {
        ...options,
        authorize: async (url) => {
          allowed.push(url);
          if (url.includes("/probe-result")) throw new Error("Denied read");
        },
      }),
    ).rejects.toThrow("Denied read");
    expect(hits).toEqual(["GET /probe-csrf"]);
    expect(allowed).toEqual([
      `${origin}/probe-csrf`,
      `${origin}/probe-result?csrf=fictional-csrf-secret`,
    ]);
    hits.length = 0;
    await replayer.get(`${origin}/probe-result`, { ...options, authorize: async () => {} });
    expect(hits).toEqual(["GET /probe-csrf", "GET /probe-result"]);
    expect(recorder.secrets).toContain("fictional-csrf-secret");
  } finally {
    await context.close();
  }
});

it.each([
  "fresh",
  "cached",
  "redirect",
])("records complete response metadata with repeated Set-Cookie: %s", async (mode) => {
  const context = await browser.newContext();
  const cookies: string[] = [];
  const recorder = new Recorder(origin, (cookie) => cookies.push(cookie.name));
  recorder.phase = "demonstration";
  recorder.demonstration = "multi-cookie response";
  await recorder.attach(context);
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/multi-cookies-${mode}`);
    await recorder.flush();
    const entry = recorder.trace.find((r) => r.url === `${origin}/multi-cookies-${mode}`);
    expect(entry?.contentType).toBe("application/json");
    expect(entry?.setCookieNames).toEqual(["sid", "pref"]);
    expect(cookies).toEqual(expect.arrayContaining(["sid", "pref"]));
    if (mode === "redirect") expect(entry?.redirectedTo).toBe(`${origin}/portal/home`);
    else {
      expect(entry?.bodySample).toContain("Example widget");
      if (mode === "cached") {
        expect(entry?.responsePageFailure).toBe(true);
        expect(entry?.verificationEvidence).toBeUndefined();
      } else expect(entry?.verificationEvidence?.items[0]?.[`${SCHEMA}sku`]).toEqual(["EX-42"]);
    }
    expect(JSON.stringify(recorder.trace)).not.toContain("fictional-session-secret");
    expect(JSON.stringify(recorder.trace)).not.toContain("fictional-preference");
  } finally {
    await context.close();
  }
});

it("uses the redirected start-page password form and records path-scoped session cookies", async () => {
  hits.length = 0;
  const context = await browser.newContext();
  const recorder = new Recorder(origin);
  await recorder.attach(context);
  try {
    const login = await performLogin(context, recorder, `${origin}/entry`, {
      username: "alex",
      password: "fixture-password",
    });
    expect(login).toMatchObject({
      success: true,
      loginPageUrl: `${origin}/portal`,
      sessionCookies: ["sid"],
      landedOn: `${origin}/portal/home`,
    });
    expect(hits.filter((h) => h.startsWith("POST"))).toEqual(["POST /portal"]);
    expect(hits).not.toContain("GET /login");
  } finally {
    await context.close();
  }
});
it("prioritises menu GET links and captures delayed JSON within the page limit", async () => {
  hits.length = 0;
  const context = await browser.newContext();
  const recorder = new Recorder(origin);
  await recorder.attach(context);
  try {
    const result = await crawl(context, recorder, {
      startUrl: `${origin}/portal/home`,
      maxPages: 2,
    });
    expect(result.pages.map((p) => p.finalUrl)).toEqual([
      `${origin}/portal/home`,
      `${origin}/portal/items`,
    ]);
    expect(
      recorder.trace.some(
        (r) => r.url === `${origin}/portal/data` && r.bodySample?.includes("Example"),
      ),
    ).toBe(true);
    expect(hits.some((h) => h.startsWith("POST") || h.includes("/reset"))).toBe(false);
  } finally {
    await context.close();
  }
});
it("closes the learning context at the hard deadline while preserving a supplied browser", async () => {
  await expect(
    profileSite({ startUrl: `${origin}/stall`, browser, maxPages: 2, maxProfileMs: 100 }),
  ).rejects.toThrow("time limit");
  expect(browser.isConnected()).toBe(true);
  expect(browser.contexts()).toHaveLength(0);
});

it("learns an empty saved search by a read-only cleared probe while preserving XHR headers", async () => {
  const result = await profileSite({ startUrl: `${origin}/portal/search`, maxPages: 1, browser });
  const op = result.model.operations.find(
    (o) => o.actionType === "https://schema.org/SearchAction",
  );
  expect(op?.request.headers?.["x-requested-with"]).toBe("XMLHttpRequest");
  expect(op?.extraction?.totalPath).toBe("/totalRecords");
  expect(op?.provenance.successes).toBeGreaterThan(0);
  expect(
    result.trace.some(
      (r) =>
        r.phase === "probe" &&
        new URL(r.url).searchParams.get("search") === "" &&
        r.requestHeaders["x-requested-with"] === "XMLHttpRequest",
    ),
  ).toBe(true);
});

it("bounds large demonstrated request bodies and structurally redacts multipart fields", async () => {
  const context = await browser.newContext();
  const recorder = new Recorder(origin);
  recorder.phase = "demonstration";
  await recorder.attach(context);
  try {
    const page = await context.newPage();
    await page.setContent(
      `<form method="post" action="${origin}/portal/multipart" enctype="multipart/form-data"><input name="name" value="Example Widget"><input type="hidden" name="form_key" value="short-secret"><button>Submit</button></form>`,
    );
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole("button", { name: "Submit" }).click(),
    ]);
    await recorder.flush();
    const small = recorder.trace.find((r) => r.method === "POST");
    expect(small?.postData).not.toContain("short-secret");
    expect(formFields(small?.postData ?? "", small?.requestHeaders["content-type"] ?? "")).toEqual([
      ["name", "Example Widget"],
      ["form_key", "[redacted]"],
    ]);
    await page.setContent(
      `<form method="post" action="${origin}/portal/large"><textarea name="payload"></textarea><button>Submit</button></form>`,
    );
    await page.locator("textarea").fill("x".repeat(BODY_LIMIT + 1));
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole("button", { name: "Submit" }).click(),
    ]);
    await recorder.flush();
    const large = recorder.trace.find((r) => r.url.endsWith("/large"));
    expect(large?.postDataTruncated).toBe(true);
    expect(large?.postData).toBeUndefined();
  } finally {
    await context.close();
  }
});

it("redacts a bracketed CSRF token first encountered on a demonstration-only page", async () => {
  const result = await profileSite({
    startUrl: `${origin}/demo-start`,
    browser,
    maxPages: 1,
    demonstrations: [
      {
        name: "own-entry",
        async run(page) {
          await page.goto(`${origin}/demo-form`);
          await page.locator("textarea").fill("Example entry");
          await Promise.all([page.waitForNavigation(), page.locator("button").click()]);
        },
      },
    ],
  });
  expect(result.warnings.filter((w) => w.startsWith("demonstration"))).toEqual([]);
  expect(JSON.stringify(result.trace)).not.toContain("demonstration-only-csrf-secret");
  expect(
    result.model.operations.find((o) => o.request.method === "POST")?.csrf?.[0]?.target.name,
  ).toBe("entry[_token]");
});

it("r11 propagates login redirect GET cookie classifications before returning traces and warnings", async () => {
  const result = await profileSite({
    startUrl: `${origin}/short-login`,
    browser,
    maxPages: 1,
    verify: false,
    login: { username: "alex", password: "fictional-password" },
  });
  expect(result.model.login?.[0]?.sessionCookies).toContain("key");
  expect(
    result.trace.some(
      (r) => r.phase === "login" && r.method === "GET" && r.setCookieNames?.includes("key"),
    ),
  ).toBe(true);
  expect(JSON.stringify(result.trace)).toContain("[redacted]");
  for (const secret of ["Ab7xQ2", "Cd8yR3"])
    expect(JSON.stringify({ trace: result.trace, warnings: result.warnings })).not.toContain(
      secret,
    );
  // r12: the host may retain the learned login model beside a reduced execution model.
  const read: Operation = {
    id: "urn:echo",
    label: "Read example",
    actionType: `${SCHEMA}ViewAction`,
    effect: "read",
    session: "none",
    inputs: [],
    request: { method: "GET", urlTemplate: `${origin}/echo` },
    extraction: {
      format: "json",
      itemType: `${SCHEMA}Thing`,
      fields: [{ property: `${SCHEMA}name`, path: "/name" }],
    },
    provenance: {
      method: "crawl",
      learnedAt: result.model.generatedAt,
      confidence: 1,
      derivedFrom: [],
    },
  };
  for (const intake of ["vault", "response"]) {
    const sessions = new InMemorySessions();
    sessions.set(origin, undefined, {
      cookies:
        intake === "vault"
          ? [
              {
                name: "key",
                value: "Ab7xQ2",
                domain: "127.0.0.1",
                path: "/",
              },
            ]
          : [],
    });
    const executor = createExecutor({
      model: { ...result.model, login: [], operations: [read], flows: [] },
      credentialContext: { model: result.model },
      sessions,
      fetch: async () =>
        Response.json(
          { name: "Example Ab7xQ2" },
          {
            headers: intake === "response" ? { "set-cookie": "key=Ab7xQ2; Path=/" } : {},
          },
        ),
    });
    const observed = await executor.execute({
      node: "urn:request",
      types: [read.actionType],
      values: () => [],
    });
    expect(observed.status).toBe("done");
    expect(observed.observations[0]?.turtle).toContain("[redacted]");
    expect(JSON.stringify(observed)).not.toContain("Ab7xQ2");
  }
});
