// AUTHORED-BY Claude Opus 5.5
// Browser-driven steps (recorder guard, crawl, login) against small local fixtures, plus the pure
// helpers around them.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type RunningShop, startShop } from "@jeswr/test-shop";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseSampleWord, crawl } from "../src/crawl.js";
import {
  findLoginLink,
  performLogin,
  probeCandidates,
  refreshInfo,
  usernameField,
} from "../src/login.js";
import { launchChromium, profileSite } from "../src/profile.js";
import { Recorder, redactBody, sanitiseHeaders } from "../src/recorder.js";
import { candidateFromScriptCall, clusterRequests } from "../src/templates.js";
import type { EndpointCandidate, FormInfo, Label, Labeller } from "../src/types.js";
import { s } from "../src/util.js";

let browser: Browser;
let site: Server;
let away: Server;
let origin = "";
let awayOrigin = "";
const hits: string[] = [];

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });
}

const page = (body: string) =>
  `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

beforeAll(async () => {
  away = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page("elsewhere"));
  });
  awayOrigin = await listen(away);
  site = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const html = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/html" });
      res.end(page(body));
    };
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method !== "GET") return html(204, "");
    switch (url.pathname) {
      case "/":
        return html(
          200,
          `<h1>Gadgets</h1>
           <a href="/a">Alpha gadget 1</a> <a href="/gadget/2">Beta gadget</a>
           <a href="/logout">Sign out</a> <a href="/delete?id=1">Remove</a>
           <a href="${awayOrigin}/x">Partner</a> <a href="/file.pdf">Manual</a> <a href="/missing">Old</a>
           <a href="/away">Away</a> <a href="mailto:x@example.test">Mail</a>
           <form action="/find"><input name="term"><button>Find</button></form>
           <form method="post" action="/subscribe"><input name="email"><button>Join</button></form>
           <script>fetch('/track', { method: 'POST', body: 'x' }); fetch('/api/data').then(r => r.json());</script>`,
        );
      case "/a":
        return html(200, '<h1>Alpha</h1><a href="/">Home</a><a href="/gadget/2">Beta</a>');
      case "/gadget/2":
        return html(200, '<h1>Beta</h1><span class="price" data-price="3.00">£3.00</span>');
      case "/find":
        return html(200, `<p>Results for ${url.searchParams.get("term")}</p>`);
      case "/api/data":
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ items: [{ id: 1, name: "Alpha", price: "1.00" }] }));
      case "/away":
        res.writeHead(302, { location: `${awayOrigin}/landing` });
        return res.end();
      default:
        return html(404, "nope");
    }
  });
  origin = await listen(site);
  browser = await launchChromium();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  site?.close();
  away?.close();
});

describe("recorder helpers", () => {
  it("redacts credential-like fields in JSON and form bodies", () => {
    expect(
      redactBody(
        '{"user":"a","password":"p","nested":{"csrf_token":"t"},"list":[{"pin":"1"}]}',
        "application/json",
      ),
    ).toBe(
      '{"user":"a","password":"[redacted]","nested":{"csrf_token":"[redacted]"},"list":[{"pin":"[redacted]"}]}',
    );
    expect(
      redactBody("username=a&password=p&csrf_token=t", "application/x-www-form-urlencoded"),
    ).toBe("username=a&password=%5Bredacted%5D&csrf_token=%5Bredacted%5D");
    expect(redactBody("{broken", "application/json")).toBe("{broken");
    expect(redactBody("free text with spaces", "text/plain")).toBe("free text with spaces");
    expect(redactBody(undefined, undefined)).toBeUndefined();
  });

  it("drops cookies and authorization and notes cookie-copied headers", () => {
    const out = sanitiseHeaders({
      cookie: "sid=abcdefghij; csrf=0123456789abcdef; flag",
      authorization: "Bearer secret-token",
      "proxy-authorization": "Basic x",
      "x-csrf-token": "0123456789abcdef",
      "x-session-hint": "short",
      accept: "application/json",
    });
    expect(out).toEqual({
      requestHeaders: {
        "x-csrf-token": "[redacted]",
        "x-session-hint": "[redacted]",
        accept: "application/json",
      },
      cookieNames: ["sid", "csrf", "flag"],
      authScheme: "Bearer",
      headersFromCookies: { "x-csrf-token": "csrf" },
    });
    expect(sanitiseHeaders({}).cookieNames).toEqual([]);
  });
});

describe("crawl", () => {
  it("chooses a sample word from item links, then headings", () => {
    expect(
      chooseSampleWord(
        '<a href="/p/1">Trail shoes</a><a href="/p/2">Road shoes</a><a href="/about">About us</a>',
      ),
    ).toBe("shoes");
    expect(chooseSampleWord("<h1>Garden tools</h1>")).toBe("garden");
    expect(chooseSampleWord("<p>x</p>")).toBe("test");
  });

  it("follows safe same-origin links and GET forms, and the guard blocks every write", async () => {
    hits.length = 0;
    const context = await browser.newContext();
    const recorder = new Recorder(origin);
    await recorder.attach(context);
    try {
      const result = await crawl(context, recorder, { startUrl: `${origin}/`, maxPages: 20 });
      const visited = result.pages.map((p) => new URL(p.url).pathname + new URL(p.url).search);
      expect(visited).toEqual(
        expect.arrayContaining(["/", "/a", "/gadget/2", "/missing", "/find?term=beta"]),
      );
      expect(result.sampleWord).toBe("beta");
      expect(hits.filter((h) => !h.startsWith("GET"))).toEqual([]);
      expect(hits.some((h) => h.includes("/logout") || h.includes("/delete"))).toBe(false);
      expect(hits.some((h) => h.includes("file.pdf"))).toBe(false);
      const blocked = recorder.trace.filter((r) => r.blocked);
      expect(blocked.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toContain("POST /track");
      expect(
        recorder.trace.some((r) => r.url.endsWith("/api/data") && r.bodySample?.includes("Alpha")),
      ).toBe(true);
      expect(result.warnings.some((w) => w.includes("left the site"))).toBe(true);
      expect(recorder.trace.every((r) => r.url.startsWith(origin))).toBe(true);
      expect(result.pages.find((p) => p.url === `${origin}/`)?.forms.map((f) => f.method)).toEqual([
        "GET",
        "POST",
      ]);
    } finally {
      await context.close();
    }
  });

  it("stops at maxPages and reports what it left", async () => {
    const context = await browser.newContext();
    const recorder = new Recorder(origin);
    await recorder.attach(context);
    try {
      const result = await crawl(context, recorder, {
        startUrl: `${origin}/`,
        maxPages: 1,
        sampleWord: "x",
      });
      expect(result.pages).toHaveLength(1);
      expect(result.sampleWord).toBe("x");
      expect(result.warnings.some((w) => /stopped at 1 pages/.test(w))).toBe(true);
      await expect(crawl(context, recorder, { startUrl: "nope", maxPages: 1 })).rejects.toThrow(
        /Bad start URL/,
      );
    } finally {
      await context.close();
    }
  });
});

describe("login", () => {
  let shop: RunningShop;
  beforeAll(async () => {
    shop = await startShop();
  });
  afterAll(async () => {
    await shop.close();
  });

  it("reports a refused sign-in and a site without a password form", async () => {
    const context = await browser.newContext();
    const recorder = new Recorder(shop.url);
    await recorder.attach(context);
    try {
      const bad = await performLogin(context, recorder, shop.url, {
        username: "alex@example.test",
        password: "not-the-password-77",
      });
      expect(bad).toMatchObject({
        success: false,
        error: "the site did not accept the sign-in",
        loginPageUrl: `${shop.url}/login`,
      });
      expect(recorder.trace.find((r) => r.method === "POST")?.phase).toBe("login");
      expect(JSON.stringify(recorder.trace)).not.toContain("not-the-password-77");
      const good = await performLogin(context, recorder, shop.url, {
        username: "alex@example.test",
        password: "correct-horse",
      });
      expect(good).toMatchObject({
        success: true,
        sessionCookies: ["sid"],
        landedOn: `${shop.url}/account`,
      });
    } finally {
      await context.close();
    }
    const other = await browser.newContext();
    const r2 = new Recorder(origin);
    await r2.attach(other);
    try {
      const none = await performLogin(other, r2, `${origin}/`, { username: "a", password: "b" });
      expect(none).toMatchObject({
        success: false,
        error: "no password form found",
        loginPageUrl: `${origin}/login`,
      });
    } finally {
      await other.close();
    }
  });

  it("finds login links, username fields, probe candidates and refresh info", () => {
    expect(findLoginLink('<a href="/account/signin">Sign in</a>', "https://s.test/")).toBe(
      "https://s.test/account/signin",
    );
    expect(findLoginLink('<a href="/login?next=/">Go</a>', "https://s.test/")).toBe(
      "https://s.test/login?next=/",
    );
    expect(
      findLoginLink('<a href="https://idp.test/login">Log in</a>', "https://s.test/"),
    ).toBeUndefined();
    expect(findLoginLink('<a href="/help">Help</a>', "https://s.test/")).toBeUndefined();
    const form = (fields: FormInfo["fields"]): FormInfo => ({
      pageUrl: "",
      method: "POST",
      action: "",
      enctype: "application/x-www-form-urlencoded",
      selector: "form",
      fields,
      hasPassword: true,
      submitLabels: [],
    });
    expect(
      usernameField(
        form([
          { name: "q", type: "text", required: false, hidden: false },
          { name: "login_email", type: "email", required: true, hidden: false },
        ]),
      ),
    ).toBe("login_email");
    expect(
      usernameField(form([{ name: "handle", type: "text", required: true, hidden: false }])),
    ).toBe("handle");
    expect(
      usernameField(form([{ name: "t", type: "hidden", required: false, hidden: true }])),
    ).toBeUndefined();
    expect(
      probeCandidates(
        { success: true, loginPageUrl: "", sessionCookies: [], landedOn: "https://s.test/" },
        [
          "https://s.test/me",
          "https://s.test/help",
          "https://s.test/me#x",
          "https://s.test/settings/profile",
        ],
      ),
    ).toEqual(["https://s.test/me", "https://s.test/settings/profile"]);
    expect(probeCandidates(undefined, [])).toEqual([]);
    const refresh = candidateFromScriptCall({
      scriptUrl: "https://s.test/a.js",
      method: "POST",
      urlPattern: "https://s.test/oauth/refresh",
      headers: {},
      csrf: [],
      bodyKind: "form",
      bodyKeys: ["refresh_token"],
      via: "fetch",
      line: 1,
    }) as EndpointCandidate;
    expect(refreshInfo([refresh])).toEqual({
      urlTemplate: "https://s.test/oauth/refresh",
      tokenPointer: "/access_token",
      expiresInPointer: "/expires_in",
    });
    const sampled = clusterRequests(
      [
        {
          seq: 0,
          phase: "demonstration",
          method: "POST",
          url: "https://s.test/t/refresh",
          resourceType: "fetch",
          requestHeaders: {},
          cookieNames: [],
          postData: "refreshToken=x",
          status: 200,
          contentType: "application/json",
          bodySample: '{"accessToken":"a","expiresIn":60}',
        },
      ],
      "https://s.test",
    );
    expect(refreshInfo(sampled)).toMatchObject({
      tokenPointer: "/accessToken",
      expiresInPointer: "/expiresIn",
    });
    expect(refreshInfo([])).toBeUndefined();
  });
});

describe("profileSite", () => {
  it("uses a custom labeller and launches its own browser when none is given", async () => {
    const seen: string[] = [];
    const labeller: Labeller = {
      async label(c: EndpointCandidate): Promise<Label> {
        seen.push(`${c.method} ${c.urlTemplate.replace(origin, "")}`);
        if (c.method !== "GET" || c.responseKind !== "json")
          return { actionType: s("Action"), label: "", effect: "read", confidence: 0, skip: true };
        return { actionType: s("ReadAction"), label: "Read data", effect: "read", confidence: 0.5 };
      },
    };
    const result = await profileSite({
      startUrl: `${origin}/`,
      maxPages: 5,
      labeller,
      verify: false,
      modelId: "urn:test:gadgets",
      version: "2.0.0",
    });
    expect(seen).toContain("GET /api/data");
    expect(result.model).toMatchObject({ id: "urn:test:gadgets", version: "2.0.0", flows: [] });
    expect(result.model.operations.map((o) => [o.id, o.label, o.provenance.method])).toEqual([
      ["urn:test:gadgets#read-data", "Read data", "crawl"],
    ]);
    expect(result.warnings.some((w) => w.includes("guard: blocked POST"))).toBe(true);
    expect(result.warnings).toContain("no search operation learned");
    await expect(profileSite({ startUrl: "nope" })).rejects.toThrow(/Bad start URL/);
  }, 60_000);
});
