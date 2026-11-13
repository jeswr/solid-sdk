// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { crawl } from "../src/crawl.js";
import { formFields } from "../src/form-body.js";
import { performLogin } from "../src/login.js";
import { launchChromium, profileSite } from "../src/profile.js";
import { BODY_LIMIT, Recorder } from "../src/recorder.js";

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
