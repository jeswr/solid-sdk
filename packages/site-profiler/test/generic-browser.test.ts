// AUTHORED-BY Codex GPT-6
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { crawl } from "../src/crawl.js";
import { performLogin } from "../src/login.js";
import { launchChromium, profileSite } from "../src/profile.js";
import { Recorder } from "../src/recorder.js";

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
