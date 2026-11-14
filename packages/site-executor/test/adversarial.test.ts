// AUTHORED-BY Claude Opus 5.5
// Adversarial tests of the origin guard, redirect handling, secret redaction and
// request limits, against a hostile site and a second "attacker" origin.

import type { ServerResponse } from "node:http";
import type { Operation, SiteModel } from "@jeswr/site-model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import type { Gate } from "../src/gate.js";
import {
  actionRequest,
  json,
  type LoggedRequest,
  send,
  startServer,
  type TestServer,
} from "./helpers.js";

const S = "https://schema.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const SECRET_SID = "sid-SECRET-0123456789";
const SECRET_BEARER = "tok-SECRET-abcdef0123";
const allow: Gate = { authorize: async () => ({ kind: "allow" }) };

let site: TestServer;
let attacker: TestServer;
let routes: Record<string, (req: LoggedRequest, res: ServerResponse) => void>;
let sessions: InMemorySessions;

beforeEach(async () => {
  routes = {};
  attacker = await startServer((_req, res) => send(res, 200, "pwned"));
  site = await startServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const route = routes[`${req.method} ${path}`];
    if (route) route(req, res);
    else send(res, 404, "nope");
  });
  sessions = new InMemorySessions();
  sessions.set(site.url, undefined, {
    cookies: [{ name: "sid", value: SECRET_SID, domain: "127.0.0.1", path: "/", httpOnly: true }],
    headers: { Authorization: `Bearer ${SECRET_BEARER}`, Cookie: "injected=1", Host: "evil.test" },
  });
});

afterEach(async () => {
  await site.close();
  await attacker.close();
});

const provenance = {
  derivedFrom: [],
  learnedAt: "2026-11-13T00:00:00Z",
  method: "manual" as const,
  confidence: 1,
};

function model(ops: Partial<Operation>[]): SiteModel {
  return {
    id: "urn:model",
    site: site.url,
    version: "1",
    generatedAt: "2026-11-13T00:00:00Z",
    flows: [],
    operations: ops.map((o, i) => ({
      id: `urn:op:${i}`,
      actionType: `${S}SearchAction`,
      label: `op ${i}`,
      inputs: [
        {
          name: "q",
          path: [`${S}query`],
          range: `${XSD}string`,
          required: true,
          location: "query",
        },
      ],
      request: { method: "GET", urlTemplate: `${site.url}/search{?q}` },
      session: "none",
      effect: "read",
      provenance,
      ...o,
    })) as Operation[],
  };
}

const search = (q = "x") =>
  actionRequest(`[] a schema:SearchAction ; schema:query ${JSON.stringify(q)} .`);

function expectClean(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SECRET_SID);
  expect(text).not.toContain(SECRET_BEARER);
  expect(text).not.toContain(encodeURIComponent(SECRET_SID));
}

describe("origin guard", () => {
  it("refuses an off-origin URL template before sending anything", async () => {
    const ex = createExecutor({
      model: model([{ request: { method: "GET", urlTemplate: `${attacker.url}/x{?q}` } }]),
      sessions,
    });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "origin", requests: 0 });
    expect(attacker.requests).toHaveLength(0);
  });

  it.each([
    ["reserved expansion of a protocol-relative value", "{+q}", "//127.0.0.1:ATTACKER/steal"],
    ["reserved expansion of an absolute value", "{+q}", "http://127.0.0.1:ATTACKER/steal"],
    ["userinfo confusion", "{+q}", `http://127.0.0.1:SITE@127.0.0.1:ATTACKER/`],
  ])("refuses a value that moves the request off-origin: %s", async (_l, template, value) => {
    const port = new URL(attacker.url).port;
    const sitePort = new URL(site.url).port;
    const ex = createExecutor({
      model: model([{ request: { method: "GET", urlTemplate: template } }]),
      sessions,
    });
    const r = await ex.execute(search(value.replace("ATTACKER", port).replace("SITE", sitePort)));
    expect(r).toMatchObject({ status: "error", errorKind: "origin", requests: 0 });
    expect(attacker.requests).toHaveLength(0);
  });

  it("keeps a simple-expanded value inside the path even when it looks like a URL", async () => {
    routes["GET /p/http:%2F%2Fevil.test"] = (_q, res) => send(res, 200, "ok");
    const ex = createExecutor({
      model: model([{ request: { method: "GET", urlTemplate: `${site.url}/p{/q}` } }]),
      sessions,
    });
    const r = await ex.execute(search("//evil.test"));
    expect(site.requests[0]?.url).toBe("/p/%2F%2Fevil.test");
    expect(r.status).toBe("error"); // 404 from the site, but on-origin
    expect(r.errorKind).toBe("http");
  });

  it.each([
    ["absolute", (a: string) => `${a}/steal`],
    ["protocol-relative", (a: string) => `//${new URL(a).host}/steal`],
    ["backslashes", (a: string) => `/\\${new URL(a).host}/steal`],
    ["scheme change", () => "https://127.0.0.1/steal"],
  ])("refuses an off-origin redirect (%s) without following it", async (_l, location) => {
    routes["GET /search"] = (_q, res) =>
      send(res, 302, "", "text/html", { location: location(attacker.url) });
    const ex = createExecutor({ model: model([{}]), sessions });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "origin", requests: 1 });
    expect(attacker.requests).toHaveLength(0);
    expectClean(r);
  });

  it("follows on-origin GET redirects, carrying cookies set along the way", async () => {
    routes["GET /search"] = (_q, res) =>
      send(res, 302, "", "text/html", {
        location: "/final?x=1",
        "set-cookie": "hop=hop-cookie-value; Path=/",
      });
    routes["GET /final"] = (_q, res) => json(res, 200, { ok: true });
    const ex = createExecutor({ model: model([{}]), sessions });
    const r = await ex.execute(search());
    expect(r.status).toBe("done");
    expect(r.requests).toBe(2);
    expect(site.requests[1]?.headers.cookie).toContain("hop=hop-cookie-value");
  });

  it("refuses a 307/308 redirect for a write instead of re-sending the body", async () => {
    routes["POST /search"] = (_q, res) =>
      send(res, 307, "", "text/html", { location: "/elsewhere" });
    const ex = createExecutor({
      model: model([
        {
          request: { method: "POST", urlTemplate: `${site.url}/search{?q}` },
          effect: "reversible-write",
        },
      ]),
      sessions,
      gate: allow,
    });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "http", requests: 1 });
    expect(site.requests).toHaveLength(1);
  });

  it("limits redirects and total requests", async () => {
    routes["GET /search"] = (_q, res) =>
      send(res, 302, "", "text/html", { location: "/search?q=again" });
    const ex = createExecutor({ model: model([{}]), sessions, maxRedirects: 3 });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "limit", requests: 4 });
    const ex2 = createExecutor({ model: model([{}]), sessions, maxRequests: 2 });
    const r2 = await ex2.execute(search());
    expect(r2).toMatchObject({ status: "error", errorKind: "limit", requests: 2 });
  });

  it("refuses an off-origin CSRF source", async () => {
    const ex = createExecutor({
      model: model([
        {
          request: { method: "POST", urlTemplate: `${site.url}/search{?q}` },
          effect: "reversible-write",
          csrf: [
            {
              source: {
                kind: "html",
                urlTemplate: `${attacker.url}/form`,
                selector: "input",
                attribute: "value",
              },
              target: { kind: "form", name: "t" },
            },
          ],
        },
      ]),
      sessions,
      gate: allow,
    });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "origin", requests: 0 });
    expect(attacker.requests).toHaveLength(0);
  });

  it("refuses a site model whose origin is cleartext http off loopback", () => {
    const m = model([{}]);
    m.site = "http://shop.test";
    expect(() => createExecutor({ model: m, sessions })).toThrow("https");
  });

  it("stores a cookie scoped to the site host only, ignoring a foreign Domain attribute", async () => {
    routes["GET /search"] = (_q, res) =>
      json(
        res,
        200,
        {},
        { "set-cookie": ["evil=1; Domain=evil.test; Path=/", "good=good-cookie-1; Path=/"] },
      );
    const ex = createExecutor({ model: model([{}]), sessions });
    await ex.execute(search());
    const bundle = await sessions.get(site.url);
    expect(bundle?.cookies.map((c) => c.name).sort()).toEqual(["good", "sid"]);
    // The vault's headers are written back exactly as stored.
    expect(bundle?.headers).toEqual({
      Authorization: `Bearer ${SECRET_BEARER}`,
      Cookie: "injected=1",
      Host: "evil.test",
    });
  });
});

describe("CSRF and flow edge cases", () => {
  const writeWith = (source: NonNullable<Operation["csrf"]>[number]["source"]) =>
    model([
      {
        request: { method: "POST", urlTemplate: `${site.url}/search{?q}` },
        effect: "reversible-write",
        csrf: [{ source, target: { kind: "header", name: "X-T" } }],
      },
    ]);

  it("fails closed when the CSRF page errors, is not JSON, or has no token", async () => {
    routes["GET /tok"] = (_q, res) => send(res, 200, "<html>not json</html>");
    routes["GET /meta"] = (_q, res) => send(res, 200, "<html><head></head></html>");
    for (const [source, message] of [
      [{ kind: "json", urlTemplate: `${site.url}/gone`, pointer: "/t" }, "answered 404"],
      [{ kind: "json", urlTemplate: `${site.url}/tok`, pointer: "/t" }, "is not JSON"],
      [{ kind: "meta", urlTemplate: `${site.url}/meta`, name: "csrf" }, "not found"],
      [
        { kind: "html", urlTemplate: `${site.url}/{bad`, selector: "x", attribute: "v" },
        "invalid CSRF URL template",
      ],
    ] as const) {
      site.requests.length = 0;
      const r = await createExecutor({ model: writeWith(source), sessions, gate: allow }).execute(
        search(),
      );
      expect(r.status).toBe("error");
      expect(r.error).toContain(message);
      expect(site.requests.filter((q) => q.method === "POST")).toHaveLength(0);
    }
  });

  it("refuses a redirect with an unparseable Location", async () => {
    routes["GET /search"] = (_q, res) =>
      send(res, 302, "", "text/html", { location: "http://[::1" });
    const r = await createExecutor({ model: model([{}]), sessions }).execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "origin" });
  });

  it("binds $stepN.@id (item IRI -> id for a class-ranged parameter) and skips absent optional bindings", async () => {
    routes["GET /search"] = (_q, res) => json(res, 200, { items: [{ url: "/product/42" }] });
    routes["GET /product/42"] = (req, res) => json(res, 200, { got: req.url });
    const m = model([
      {
        extraction: {
          format: "json",
          itemPath: "/items",
          itemType: `${S}Product`,
          idField: `${S}url`,
          fields: [{ property: `${S}url`, path: "/url", datatype: "iri" }],
        },
      },
      {
        id: "urn:op:view",
        actionType: `${S}ViewAction`,
        inputs: [
          { name: "id", path: [], range: `${S}Product`, required: true, location: "path" },
          { name: "ref", path: [], range: `${XSD}string`, required: false, location: "query" },
        ],
        request: { method: "GET", urlTemplate: `${site.url}/product/{id}{?ref}` },
      },
    ]);
    m.flows.push({
      id: "urn:flow:find",
      actionType: `${S}FindAction`,
      label: "Find and view",
      inputs: [
        {
          name: "q",
          path: [`${S}query`],
          range: `${XSD}string`,
          required: true,
          location: "query",
        },
      ],
      steps: [
        { operation: "urn:op:0", bind: { q: "$input.q" } },
        {
          operation: "urn:op:view",
          bind: { id: "$step0.@id", ref: `$step0.${S}name`, extra: "ignored" },
        },
      ],
      effect: "read",
      provenance,
    });
    const r = await createExecutor({ model: m, sessions }).execute(
      actionRequest(`[] a schema:FindAction ; schema:query "x" .`),
    );
    expect(r.status).toBe("done");
    expect(site.requests[1]?.url).toBe("/product/42");
  });
});

describe("credentials and redaction", () => {
  it("sends the session to the site, but drops vault Cookie/Host headers", async () => {
    routes["GET /search"] = (_q, res) => json(res, 200, {});
    const ex = createExecutor({
      model: model([
        {
          request: {
            method: "GET",
            urlTemplate: `${site.url}/search{?q}`,
            headers: { "X-App": "1" },
          },
        },
      ]),
      sessions,
    });
    const r = await ex.execute(search());
    expect(r.status).toBe("done");
    const h = site.requests[0]?.headers;
    expect(h?.authorization).toBe(`Bearer ${SECRET_BEARER}`);
    expect(h?.cookie).toBe(`sid=${SECRET_SID}`);
    expect(h?.host).toBe(new URL(site.url).host);
    expect(h?.["x-app"]).toBe("1");
  });

  it("redacts session secrets a hostile site echoes into extracted data", async () => {
    routes["GET /search"] = (req, res) =>
      json(res, 200, {
        items: [
          {
            name: `cookie was ${req.headers.cookie}`,
            auth: req.headers.authorization,
            link: `/u/${encodeURIComponent(SECRET_SID)}`,
            review: `token ${SECRET_BEARER}`,
          },
        ],
      });
    const ex = createExecutor({
      model: model([
        {
          extraction: {
            format: "json",
            itemPath: "/items",
            itemType: `${S}Product`,
            idField: `${S}url`,
            fields: [
              { property: `${S}name`, path: "/name" },
              { property: `${S}description`, path: "/auth" },
              { property: `${S}url`, path: "/link", datatype: "iri" },
              { property: `${S}review`, path: "/review", untrusted: true },
            ],
          },
        },
      ]),
      sessions,
    });
    const r = await ex.execute(search());
    expect(r.status).toBe("done");
    expectClean(r);
    expect(r.observations[0]?.turtle).toContain("[redacted]");
  });

  it("redacts CSRF tokens echoed by the site", async () => {
    routes["GET /form"] = (_q, res) =>
      send(res, 200, `<input name="t" value="csrf-SECRET-998877">`);
    routes["POST /search"] = (req, res) => json(res, 200, { echo: req.body });
    const ex = createExecutor({
      model: model([
        {
          actionType: `${S}CreateAction`,
          label: "Create saved search",
          request: {
            method: "POST",
            urlTemplate: `${site.url}/search{?q}`,
            contentType: "application/x-www-form-urlencoded",
          },
          effect: "reversible-write",
          csrf: [
            {
              source: {
                kind: "html",
                urlTemplate: `${site.url}/form`,
                selector: "input[name=t]",
                attribute: "value",
              },
              target: { kind: "form", name: "t" },
            },
          ],
          extraction: {
            format: "json",
            itemType: `${S}Thing`,
            fields: [{ property: `${S}text`, path: "/echo" }],
          },
        },
      ]),
      sessions,
      gate: allow,
    });
    const r = await ex.execute(actionRequest('[] a schema:CreateAction; schema:query "x".'));
    expect(r.status).toBe("done");
    expect(r.observations.at(-1)?.turtle).toContain("[redacted]");
    expect(site.requests[1]?.body).toBe("t=csrf-SECRET-998877");
    expect(JSON.stringify(r)).not.toContain("csrf-SECRET-998877");
  });

  it("never puts query strings (which may carry tokens) or bodies into errors", async () => {
    routes["GET /search"] = (_q, res) => send(res, 500, `internal error, session ${SECRET_SID}`);
    const ex = createExecutor({
      model: model([
        {
          csrf: [
            { source: { kind: "cookie", name: "sid" }, target: { kind: "query", name: "tok" } },
          ],
        },
      ]),
      sessions,
    });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "http" });
    expect(r.error).toContain("answered 500");
    expect(site.requests[0]?.url).toContain(`tok=${SECRET_SID}`);
    expectClean(r);
  });

  it("reports network failures without the URL query or the cause", async () => {
    const ex = createExecutor({
      model: model([{}]),
      sessions,
      fetch: async () => {
        throw new Error(`connect failed for ${SECRET_SID}`);
      },
    });
    const r = await ex.execute(search("secret query"));
    expect(r).toMatchObject({ status: "error", errorKind: "network", requests: 1 });
    expect(r.error).toBe(`GET ${site.url}/search failed (network error)`);
  });

  it("caps response size", async () => {
    routes["GET /search"] = (_q, res) => json(res, 200, { big: "x".repeat(5000) });
    const ex = createExecutor({
      model: model([{ extraction: { format: "json", itemType: `${S}Thing`, fields: [] } }]),
      sessions,
      maxResponseBytes: 1000,
    });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "limit" });
  });

  it("reports malformed JSON as an extraction error", async () => {
    routes["GET /search"] = (_q, res) => send(res, 200, "<html>not json</html>");
    const ex = createExecutor({
      model: model([{ extraction: { format: "json", itemType: `${S}Thing`, fields: [] } }]),
      sessions,
    });
    const r = await ex.execute(search());
    expect(r).toMatchObject({ status: "error", errorKind: "extraction" });
  });

  it("returns an empty graph for an operation without extraction", async () => {
    routes["GET /search"] = (_q, res) => send(res, 204, "");
    const ex = createExecutor({ model: model([{}]), sessions });
    const r = await ex.execute(search());
    expect(r.status).toBe("done");
    expect(r.observations[0]).toMatchObject({ status: 204, itemCount: 0 });
    expect(r.observations[0]?.turtle).toContain("@prefix");
  });

  it("rejects header-injection values and forbidden header parameters", async () => {
    routes["GET /search"] = (_q, res) => json(res, 200, {});
    const ex = createExecutor({
      model: model([
        {
          inputs: [
            {
              name: "X-Note",
              path: [`${S}query`],
              range: `${XSD}string`,
              required: true,
              location: "header",
            },
          ],
        },
      ]),
      sessions,
    });
    const r = await ex.execute(search("a\r\nCookie: stolen=1"));
    expect(r).toMatchObject({ status: "error", errorKind: "binding", requests: 0 });
    expect(() =>
      createExecutor({
        model: model([
          {
            inputs: [
              {
                name: "Cookie",
                path: [`${S}query`],
                range: `${XSD}string`,
                required: true,
                location: "header",
              },
            ],
          },
        ]),
        sessions,
      }),
    ).toThrow("forbidden");
  });

  it("reports an unavailable session store", async () => {
    const ex = createExecutor({
      model: model([{}]),
      sessions: {
        get: async () => {
          throw new Error("vault locked");
        },
        update: async () => {},
      },
    });
    expect(await ex.execute(search())).toMatchObject({
      status: "error",
      errorKind: "no-session",
      error: "session store unavailable",
    });
  });
});
