// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { parseActionRequest, validateSiteModel } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { applyCsrfToken, bodyInit, compileOperation, requestFingerprint } from "../src/compile.js";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { createApprovalGate } from "../src/gate.js";
import { BindingError } from "../src/values.js";
import { effectiveWireFields } from "../src/wire.js";

const O = "https://shop.test";
const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
type Transport = NonNullable<Parameters<typeof createExecutor>[0]["fetch"]>;
const provenance = {
  derivedFrom: [],
  learnedAt: "2026-11-13",
  method: "manual" as const,
  confidence: 1,
};
const param = (name: string, path: string[], extra: Partial<Parameter> = {}): Parameter => ({
  name,
  path: path.map((p) => S + p),
  range: `${X}string`,
  required: true,
  location: "body",
  ...extra,
});
const order = {
  url: `${O}/order/104`,
  orderNumber: "104",
  identifier: "basket-104",
  price: "20",
  currency: "GBP",
};
function fixture(direct = false) {
  const read: Operation = {
    id: "urn:quote",
    actionType: `${S}ViewAction`,
    label: "Quote",
    effect: "read",
    session: "none",
    provenance,
    inputs: [],
    request: { method: "GET", urlTemplate: `${O}/quote` },
    extraction: {
      format: "json",
      itemPath: "/items",
      itemType: S + (direct ? "Product" : "Order"),
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        ...["productID", "orderNumber", "identifier", "price", "currency"].map((p) => ({
          property: S + p,
          path: `/${p}`,
        })),
      ],
    },
  };
  const pay: Operation = {
    id: "urn:pay",
    actionType: `${S}PayAction`,
    label: "Pay",
    effect: "payment",
    session: "none",
    provenance,
    inputs: direct ? [param("item", ["object", "productID"], { default: "104" })] : [],
    request: {
      method: "POST",
      urlTemplate: `${O}/pay`,
      contentType: "application/x-www-form-urlencoded",
    },
  };
  const prepare: Operation = {
    ...pay,
    id: "urn:prepare",
    label: "Prepare basket",
    effect: "reversible-write",
    inputs: [],
    request: { method: "POST", urlTemplate: `${O}/prepare` },
  };
  const flow: Flow = {
    id: "urn:buy",
    actionType: `${S}BuyAction`,
    label: "Buy",
    effect: "payment",
    provenance,
    inputs: [],
    steps: [
      ...(direct ? [] : [{ operation: prepare.id, bind: {} }]),
      { operation: read.id, bind: {} },
      { operation: pay.id, bind: {} },
    ],
  };
  const model: SiteModel = {
    id: "urn:model",
    site: O,
    version: "1",
    generatedAt: "2026-11-13",
    operations: [read, pay, prepare],
    flows: [flow],
  };
  const request = parseActionRequest(
    `@prefix schema: <${S}>. [] a schema:BuyAction${direct ? `; schema:object <${O}/product/104>` : ""}.`,
  );
  const gate = createApprovalGate();
  const transport = vi.fn<Transport>(async (_url, init) =>
    init?.method === "GET"
      ? Response.json({
          items: [direct ? { ...order, url: `${O}/product/104`, productID: "104" } : order],
        })
      : Response.json({}),
  );
  const executor = (injected: Transport = transport) =>
    createExecutor({ model, sessions: new InMemorySessions(), gate, fetch: injected });
  const start = async (instance = executor()) => {
    const first = await instance.execute(request);
    if (direct) return first;
    expect(first.status).toBe("needs-approval");
    gate.approve(first.approval?.id ?? "");
    return instance.execute(request, { approvalId: first.approval?.id });
  };
  return { read, pay, flow, model, request, gate, transport, executor, start };
}

describe("Rule W concrete payment coverage", () => {
  const delivery = (location: Parameter["location"] = "query", value = "standard") =>
    param("delivery", ["deliveryMethod"], { location, default: value });
  const token = (kind: "header" | "query" | "form" = "form", name = "csrf_token") => [
    {
      source: { kind: "json" as const, urlTemplate: `${O}/token`, pointer: "/token" },
      target: { kind, name },
    },
  ];
  const refuses = async (f: ReturnType<typeof fixture>, fragment: string) => {
    const result = await f.start();
    expect(result.status, result.error).toBe("refused");
    expect(result.error).toContain(fragment);
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
  };

  it("W1/W3 (a) refuses a payment-only static delivery header", async () => {
    const f = fixture();
    f.pay.request.headers = { delivery: "express" };
    await refuses(f, "payment sends delivery, which the basket total did not cover");
  });

  it("W3 (b) refuses a case-aliased CSRF Delivery header from a JSON token source", async () => {
    const f = fixture();
    f.read.inputs = [delivery()];
    f.pay.csrf = token("header", "Delivery");
    f.transport.mockImplementation(async (url, init) =>
      String(url).endsWith("/token")
        ? Response.json({ token: "express" })
        : init?.method === "GET"
          ? Response.json({ items: [order] })
          : Response.json({}),
    );
    await refuses(f, "CSRF target delivery");
  });

  it("W1/W3 (c) compares the expanded total query instead of an express parameter default", async () => {
    const f = fixture();
    f.read.inputs = [delivery("query", "express")];
    f.read.request.urlTemplate += "?delivery=standard&sent={delivery}";
    f.pay.inputs = [delivery("form", "express")];
    await refuses(f, "payment sends delivery");
  });

  it("W1/W3 (d) refuses values swapped between total and payment wire names", async () => {
    const f = fixture();
    f.read.inputs = [delivery(), param("memo", [], { location: "query", default: "express" })];
    f.pay.inputs = [delivery("form"), param("memo", [], { location: "form", default: "express" })];
    f.pay.request.bodyTemplate = "delivery={memo}&memo={delivery}";
    await refuses(f, "payment sends delivery");
  });

  it.each([
    "items",
    "values",
  ])("W6 (e) refuses a truncated identity-only source (%s)", async (limit) => {
    const f = fixture();
    const identity: Operation = {
      ...f.read,
      id: "urn:identity",
      inputs: [],
      request: { method: "GET", urlTemplate: `${O}/identity` },
      extraction: {
        format: "json",
        itemPath: "/items",
        itemType: `${S}Thing`,
        idField: `${S}url`,
        fields: [
          { property: `${S}url`, path: "/url", datatype: "iri" },
          { property: `${S}orderNumber`, path: "/orderNumber" },
          { property: `${S}name`, path: "/name" },
        ],
      },
    };
    f.model.operations.push(identity);
    f.flow.steps.splice(2, 0, { operation: identity.id, bind: {} });
    f.transport.mockImplementation(async (url, init) =>
      init?.method === "GET"
        ? Response.json({
            items: String(url).includes("/identity")
              ? limit === "items"
                ? [
                    ...Array.from({ length: 200 }, () => ({ url: order.url, orderNumber: "104" })),
                    { url: order.url, orderNumber: "999" },
                  ]
                : [{ url: order.url, orderNumber: "104", name: "x".repeat(4001) }]
              : [order],
          })
        : Response.json({}),
    );
    await refuses(f, "incomplete extracted money or identity evidence");
  });

  it.each([
    "payment",
    "total",
  ])("W2 refuses duplicate names across locations in %s", async (side) => {
    const f = fixture();
    f.read.inputs = [delivery()];
    f.pay.inputs = [delivery("form")];
    (side === "payment" ? f.pay : f.read).request.headers = { Delivery: "standard" };
    await refuses(f, "duplicate wire field delivery");
  });

  it.each(["payment", "total"])("W2 refuses repeated query fields in %s", async (side) => {
    const f = fixture();
    (side === "payment" ? f.pay : f.read).request.urlTemplate += "?mode=x&mode=x";
    await refuses(f, "duplicate wire field mode");
  });

  it.each([
    "header",
    "query",
    "form",
  ] as const)("W3 allows a unique CSRF token after insertion (%s)", async (kind) => {
    const f = fixture();
    f.read.inputs = [delivery()];
    f.pay.inputs = [delivery("form")];
    f.pay.csrf = token(kind);
    f.transport.mockImplementation(async (url, init) =>
      String(url).endsWith("/token")
        ? Response.json({ token: "secret-value" })
        : init?.method === "GET"
          ? Response.json({ items: [order] })
          : Response.json({}),
    );
    const executor = f.executor();
    const approval = await f.start(executor);
    expect(approval.status, approval.error).toBe("needs-approval");
    expect(approval.approval?.amount).toBe("20");
    expect(JSON.stringify(approval)).not.toContain("secret-value");
    f.gate.approve(approval.approval?.id ?? "");
    const result = await executor.execute(f.request, { approvalId: approval.approval?.id });
    expect(result.status, result.error).toBe("done");
    const call = f.transport.mock.calls.find(([url]) => String(url).includes("/pay"));
    expect(call).toBeDefined();
    if (kind === "header")
      expect(new Headers(call?.[1]?.headers).get("csrf_token")).toBe("secret-value");
    else if (kind === "query")
      expect(new URL(String(call?.[0])).searchParams.get("csrf_token")).toBe("secret-value");
    else expect(String(call?.[1]?.body)).toContain("csrf_token=secret-value");
  });

  it("W3 refuses CSRF names duplicated in the payment across locations", async () => {
    const f = fixture();
    f.pay.request.urlTemplate += "?csrf_token=configuration";
    f.pay.csrf = token("header", "CSRF_TOKEN");
    await refuses(f, "CSRF target");
  });

  it("W3 exempts a checked order identity and refuses a conflicting identity", async () => {
    for (const value of ["104", "999"]) {
      const f = fixture();
      f.pay.inputs = [param("order", ["object", "orderNumber"], { default: value })];
      const result = await f.start();
      expect(result.status, result.error).toBe(value === "104" ? "needs-approval" : "refused");
    }
  });

  it("W4 refuses an option sent only by the total request", async () => {
    const f = fixture();
    f.read.request.urlTemplate += "?delivery=standard";
    await refuses(f, "basket total sends delivery");
  });

  it("W4 does not exempt a total identity found only on an unrelated record", async () => {
    const f = fixture();
    f.read.inputs = [
      param("order", ["object", "orderNumber"], { location: "query", default: "999" }),
    ];
    const extraction = f.read.extraction;
    if (!extraction) throw new Error("Missing extraction");
    extraction.itemType = `${S}Thing`;
    extraction.fields.push({ property: `${S}totalPaymentDue`, path: "/totalPaymentDue" });
    f.transport.mockImplementation(async (_url, init) =>
      init?.method === "GET"
        ? Response.json({ items: [{ ...order, totalPaymentDue: "20" }, { orderNumber: "999" }] })
        : Response.json({}),
    );
    await refuses(f, "basket total sends order");
  });

  it("W4 checks the effective header value before exempting a total identity", async () => {
    const f = fixture();
    f.read.inputs = [
      param("order", ["object", "orderNumber"], { location: "header", default: "104 " }),
    ];
    f.transport.mockImplementation(async (_url, init) =>
      init?.method === "GET"
        ? Response.json({ items: [{ ...order, orderNumber: "104 " }] })
        : Response.json({}),
    );
    await refuses(f, "basket total sends order");
  });

  it("W4 permits the total's checked order identity to be absent from payment", async () => {
    const f = fixture();
    f.read.inputs = [
      param("order", ["object", "orderNumber"], { location: "query", default: "104" }),
    ];
    expect((await f.start()).status).toBe("needs-approval");
  });

  it("W1 compares header names case-insensitively and preserves other names and canonical values", async () => {
    const f = fixture();
    f.read.inputs = [
      param("count", [], { location: "query", default: "01", range: `${X}integer` }),
    ];
    f.pay.inputs = [param("count", [], { location: "form", default: "+1", range: `${X}integer` })];
    const approval = await f.start();
    expect(approval.status, approval.error).toBe("needs-approval");
    const different = fixture();
    different.read.request.headers = { delivery: "Standard" };
    different.pay.request.headers = { DELIVERY: "standard" };
    await refuses(different, "payment sends delivery");
  });
  it.each([
    "query",
    "form",
  ] as const)("r9 W1 refuses differently cased %s names while keeping header aliases", async (location) => {
    const f = fixture();
    f.read.inputs = [param("SEARCH", [], { location: "query", default: "EX" })];
    f.pay.inputs = [param("search", [], { location, default: "EX" })];
    await refuses(f, "payment sends search");
    const headers = fixture();
    headers.read.request.headers = { "X-Delivery": "standard" };
    headers.pay.request.headers = { "x-delivery": "standard" };
    expect((await headers.start()).status).toBe("needs-approval");
  });

  it.each([
    "submit",
    "amount",
    "currency",
    "header",
  ])("W5 refuses extra direct-buy wire fields (%s)", async (extra) => {
    const f = fixture(true);
    if (extra === "header") f.pay.request.headers = { Delivery: "express" };
    else
      f.pay.inputs.push(
        param(extra, extra === "amount" ? ["amount"] : extra === "currency" ? ["currency"] : [], {
          default: extra === "currency" ? "GBP" : "20",
        }),
      );
    await refuses(f, "payment sends");
  });

  it("W5 allows whole product identity and quantity, multiplying the amount", async () => {
    const f = fixture(true);
    f.pay.inputs.push(param("qty", ["orderQuantity"], { default: "3", range: `${X}integer` }));
    const result = await f.start();
    expect(result.status, result.error).toBe("needs-approval");
    expect(result.approval?.amount).toBe("60");
  });

  it("W1 compares the request that supplied a redirected total", async () => {
    const f = fixture();
    f.read.inputs = [delivery("query", "express")];
    f.pay.inputs = [delivery("form", "express")];
    f.transport.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/quote")
        return new Response(null, {
          status: 302,
          headers: { location: "/redirected-total?delivery=standard" },
        });
      return init?.method === "GET" ? Response.json({ items: [order] }) : Response.json({});
    });
    await refuses(f, "payment sends delivery");
  });

  it("W3 authorizes preparatory CSRF reads before contacting the token source", async () => {
    const f = fixture();
    f.pay.csrf = token();
    const executor = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
      fetch: f.transport,
      gate: {
        authorize: async (request) =>
          request.summary.startsWith("Read payment token")
            ? { kind: "deny", reason: "No token reads" }
            : { kind: "allow" },
      },
    });
    const result = await executor.execute(f.request);
    expect(result.status).toBe("denied");
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/token"))).toBe(false);
  });

  it.each([
    "query",
    "form",
    "multipart",
    "path",
    "header",
  ] as const)("W1/W3 permits equal names and values across query and %s", async (surface) => {
    const f = fixture();
    f.read.request.urlTemplate += "?delivery=standard";
    f.pay.inputs = [delivery(surface === "multipart" ? "form" : surface)];
    if (surface === "multipart") f.pay.request.contentType = "multipart/form-data";
    if (surface === "path") f.pay.request.urlTemplate += "/{delivery}";
    const executor = f.executor();
    const approval = await f.start(executor);
    expect(approval.status, approval.error).toBe("needs-approval");
    f.gate.approve(approval.approval?.id ?? "");
    const result = await executor.execute(f.request, { approvalId: approval.approval?.id });
    expect(result.status, result.error).toBe("done");
  });

  it("W1/W3 matches JSON members by RFC 6901 pointer and exempts only the JSON CSRF target", async () => {
    const f = fixture();
    f.read.request.urlTemplate += "?%2Fdelivery=standard";
    f.pay.request.contentType = "application/json";
    f.pay.inputs = [delivery("body")];
    f.pay.csrf = token("form");
    f.transport.mockImplementation(async (url, init) =>
      String(url).endsWith("/token")
        ? Response.json({ token: "secret" })
        : init?.method === "GET"
          ? Response.json({ items: [order] })
          : Response.json({}),
    );
    const approval = await f.start();
    expect(approval.status, approval.error).toBe("needs-approval");
  });

  it("W2 preserves distinct JSON member names and refuses uncovered fields", async () => {
    const f = fixture();
    f.pay.request.contentType = "application/json";
    f.pay.request.bodyTemplate = '{"Delivery":"standard","delivery":"standard"}';
    await refuses(f, "payment sends /Delivery");
  });

  it("W5 refuses a static scalar JSON body with no declared parameters", async () => {
    const f = fixture(true);
    f.pay.inputs[0] = param("item", ["object", "productID"], {
      location: "header",
      default: "104",
    });
    f.pay.request.contentType = "application/json";
    f.pay.request.bodyTemplate = "1000";
    await refuses(f, "which the basket total did not cover");
  });

  it("W7 validates the structure of a trusted model before executing it", () => {
    const f = fixture();
    f.pay.inputs = [delivery(), delivery()];
    expect(() => f.executor()).toThrow();
    expect(f.transport).not.toHaveBeenCalled();
  });
});

describe("Rule W field inventory", () => {
  it("W1 includes expanded paths, static query, nested RFC 6901 JSON pointers and model headers", () => {
    const f = fixture();
    f.pay.inputs = [param("id", [], { location: "path", default: "104" })];
    f.pay.request = {
      method: "POST",
      urlTemplate: `${O}/pay/{id}?delivery=standard`,
      headers: { Delivery: "express" },
      contentType: "application/json",
      bodyTemplate: '{"a/b":{"~name":true},"list":["x"],"static":20}',
    };
    const compiled = compileOperation(f.pay, {}, O);
    applyCsrfToken(
      compiled,
      { source: { kind: "cookie", name: "token" }, target: { kind: "header", name: "X-CSRF" } },
      "secret",
    );
    expect(effectiveWireFields(compiled)).toEqual([
      { name: "delivery", value: "standard", location: "query" },
      { name: "id", value: "104", location: "path" },
      { name: "delivery", value: "express", location: "header" },
      { name: "x-csrf", value: "secret", location: "header" },
      { name: "/a~1b", value: '{"~name":true}', location: "body" },
      { name: "/a~1b/~0name", value: "true", location: "body" },
      { name: "/list", value: '["x"]', location: "body" },
      { name: "/list/0", value: "x", location: "body" },
      { name: "/static", value: "20", location: "body" },
    ]);
  });

  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ])("W1 inventories every static and templated field in %s", (contentType) => {
    const f = fixture();
    f.pay.inputs = [param("delivery", [], { default: "express" })];
    Object.assign(f.pay.request, { contentType, bodyTemplate: "delivery={delivery}&submit=Pay" });
    expect(effectiveWireFields(compileOperation(f.pay, {}, O))).toEqual([
      { name: "delivery", value: "express", location: "body" },
      { name: "submit", value: "Pay", location: "body" },
    ]);
  });
});

describe("review r7 — executor-owned headers", () => {
  const owned = [
    "aCcEpT",
    "CONTENT-TYPE",
    "Content-Length",
    "Cookie",
    "Origin",
    "Referer",
    "Host",
    "Authorization",
    "Proxy-Authorization",
    "Cookie2",
    "Set-Cookie",
    "Transfer-Encoding",
    "Connection",
    "Keep-Alive",
    "Upgrade",
    "TE",
    "Trailer",
    "Sec-Fetch-Site",
    "Proxy-Custom",
  ];
  for (const route of ["static", "parameter", "csrf"] as const) {
    it.each(
      owned,
    )(`refuses executor-owned %s via ${route} before compilation or execution`, (name) => {
      const f = fixture();
      if (route === "static") f.pay.request.headers = { [name]: "model-value" };
      else if (route === "parameter")
        f.pay.inputs = [param(name, [], { location: "header", required: false })];
      else
        f.pay.csrf = [
          { source: { kind: "cookie", name: "sid" }, target: { kind: "header", name } },
        ];
      expect(validateSiteModel(f.model)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("executor-owned header") }),
        ]),
      );
      expect(() => compileOperation(f.pay, {}, O)).toThrow(BindingError);
      expect(() => f.executor()).toThrow("executor-owned header");
      expect(f.transport).not.toHaveBeenCalled();
    });
  }

  it.each([false, true])("refuses static Accept on total and payment (direct buy=%s)", (direct) => {
    const f = fixture(direct);
    if (!direct)
      f.read.request.headers = { Accept: "application/vnd.shop+json; delivery=standard" };
    f.pay.request.headers = { Accept: "application/vnd.shop+json; delivery=express" };
    expect(() => f.executor()).toThrow("executor-owned header");
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("refuses a header-located Accept parameter in a direct buy", () => {
    const f = fixture(true);
    f.pay.inputs.push(
      param("AcCePt", [], {
        location: "header",
        default: "application/vnd.shop+json; delivery=express",
      }),
    );
    expect(() => f.executor()).toThrow("executor-owned header");
  });

  it.each([
    "query",
    "form",
  ] as const)("refuses model Accept even beside an %s accept field", (location) => {
    const f = fixture();
    f.pay.request.headers = { Accept: "application/vnd.shop+json; delivery=express" };
    f.pay.inputs = [param("accept", [], { location, default: "common" })];
    expect(() => f.executor()).toThrow("executor-owned header");
  });

  it.each([
    "json",
    "html",
    "none",
  ] as const)("derives Accept from %s extraction and keeps model headers inventoried", async (format) => {
    const f = fixture();
    const op = f.read;
    op.actionType = `${S}ViewAction`;
    op.request.headers = { "X-Requested-With": "XMLHttpRequest" };
    op.extraction = format === "none" ? undefined : { format, itemType: `${S}Thing`, fields: [] };
    const expected =
      format === "json" ? "application/json" : format === "html" ? "text/html" : "*/*";
    const transport = vi.fn<Transport>(async (_url, init) => {
      expect(new Headers(init?.headers).get("accept")).toBe(expected);
      return format === "json" ? Response.json({}) : new Response("");
    });
    const executor = createExecutor({
      model: { ...f.model, operations: [op], flows: [] },
      sessions: new InMemorySessions(),
      fetch: transport,
    });
    expect((await executor.execute(parseActionRequest(`[] a <${S}ViewAction>.`))).status).toBe(
      "done",
    );
    expect(effectiveWireFields(compileOperation(op, {}, O))).toEqual([
      { name: "x-requested-with", value: "XMLHttpRequest", location: "header" },
    ]);
  });

  it("refuses a model header also supplied by the vault before approval or transmission", async () => {
    const f = fixture();
    f.pay.request.headers = { "X-Session": "model-value" };
    const sessions = new InMemorySessions();
    sessions.set(O, undefined, { cookies: [], headers: { "x-session": "vault-secret" } });
    const executor = createExecutor({ model: f.model, sessions, gate: f.gate, fetch: f.transport });
    expect(await executor.execute(f.request)).toMatchObject({
      status: "error",
      errorKind: "binding",
      requests: 0,
    });
    expect(f.transport).not.toHaveBeenCalled();
  });
});

describe("review r7 — serialized form inventory", () => {
  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ] as const)("inventories the actual serialized %s names and values, including CSRF", async (contentType) => {
    const f = fixture();
    // Multipart normalizes newlines (including in names); lone surrogates become U+FFFD.
    const fields: [string, string][] = [
      ['a"b\nc\rd\r\ne', "1 High Street\nFar Town\rEnd\r\nLast"],
      ["unicode", "{raw}"],
      ["escaped%22%0Aname", "value"],
      ["name\ud800", "with\u0000nul"],
    ];
    f.pay.request.contentType = contentType;
    f.pay.request.bodyTemplate = new URLSearchParams(fields).toString();
    f.pay.inputs = [param("raw", [], { default: "\ud800" })];
    const compiled = compileOperation(f.pay, {}, O);
    const csrf = {
      source: { kind: "cookie" as const, name: "sid" },
      target: { kind: "form" as const, name: 'token"\nfield' },
    };
    applyCsrfToken(compiled, csrf, "secret\nwith\rlines");
    const request = new Request(compiled.url, {
      method: compiled.method,
      headers: compiled.headers,
      body: bodyInit(compiled.body),
    });
    const transmitted = [...(await request.formData())];
    const actual = transmitted.map(([name, value]) => ({
      name,
      value,
      location: "body",
    }));
    expect(effectiveWireFields(compiled)).toEqual(actual);
    expect(compiled.body?.kind !== "json" && compiled.body?.fields).toEqual(transmitted);
    expect(actual[0]?.value).toBe(
      contentType === "multipart/form-data"
        ? "1 High Street\r\nFar Town\r\nEnd\r\nLast"
        : fields[0]?.[1],
    );
    expect(actual[0]?.name).toBe(
      contentType === "multipart/form-data" ? 'a"b\r\nc\r\nd\r\ne' : fields[0]?.[0],
    );
  });

  it.each([
    "\n",
    "\r",
  ])("refuses multipart normalization that changes the total's received newline %j", async (newline) => {
    const f = fixture();
    const address = `1 High Street${newline}Far Town`;
    f.read.request.urlTemplate += `?address=${encodeURIComponent(address)}`;
    f.pay.request.contentType = "multipart/form-data";
    f.pay.inputs = [param("address", [], { location: "form", default: address })];
    const result = await f.start();
    expect(result.status, result.error).toBe("refused");
    expect(result.error).toContain("payment sends address");
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
  });

  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ] as const)("sends the exact covered newline bytes for %s", async (contentType) => {
    const f = fixture();
    const address = contentType === "multipart/form-data" ? "A\r\nB" : "A\nB";
    f.read.request.urlTemplate += `?address=${encodeURIComponent(address)}`;
    f.pay.request.contentType = contentType;
    f.pay.inputs = [param("address", [], { location: "form", default: address })];
    const executor = f.executor();
    const approval = await f.start(executor);
    expect(approval.status, approval.error).toBe("needs-approval");
    f.gate.approve(approval.approval?.id ?? "");
    expect((await executor.execute(f.request, { approvalId: approval.approval?.id })).status).toBe(
      "done",
    );
    const call = f.transport.mock.calls.find(([url]) => String(url).endsWith("/pay"));
    if (!call) throw new Error("Missing payment");
    const request = new Request(String(call[0]), call[1]);
    expect((await request.formData()).get("address")).toBe(address);
  });
});

describe("review r7 — reserved path token coverage", () => {
  const reserve = (op: Operation, name: string) => {
    op.request.urlTemplate += `/key/{${name}}`;
    op.csrf = [{ source: { kind: "cookie", name: "sid" }, target: { kind: "query", name } }];
  };
  const sessionExecutor = (f: ReturnType<typeof fixture>) => {
    const sessions = new InMemorySessions();
    sessions.set(O, undefined, {
      cookies: [
        { name: "sid", value: "session-secret-123", domain: "shop.test", path: "/", secure: true },
      ],
    });
    return createExecutor({ model: f.model, sessions, gate: f.gate, fetch: f.transport });
  };
  it.each([
    "payment",
    "total",
    "both",
    "direct",
  ])("inventories and exempts decorated path tokens on %s", async (side) => {
    const f = fixture(side === "direct");
    if (side !== "total") reserve(f.pay, "paymentToken");
    if (side === "total" || side === "both") reserve(f.read, "totalToken");
    expect(validateSiteModel(f.model)).toEqual([]);
    for (const op of [f.read, f.pay]) {
      const compiled = compileOperation(op, {}, O);
      const fingerprint = requestFingerprint(compiled);
      for (const rule of compiled.csrf) applyCsrfToken(compiled, rule, "session-secret-123");
      const tokenFields = effectiveWireFields(compiled).filter((field) => field.sessionToken);
      expect(tokenFields).toEqual(
        op.csrf?.map((rule) => ({
          name: rule.target.name,
          value: "session-secret-123",
          location: "path",
          sessionToken: true,
        })) ?? [],
      );
      // The pre-decoration fingerprint stays independent of token values.
      const other = compileOperation(op, {}, O);
      expect(requestFingerprint(other)).toBe(fingerprint);
    }
    const executor = sessionExecutor(f);
    const approval = await f.start(executor);
    expect(approval.status, approval.error).toBe("needs-approval");
    expect(approval.approval?.amount).toBe("20");
    expect(JSON.stringify(approval)).not.toContain("session-secret-123");
    f.gate.approve(approval.approval?.id ?? "");
    const result = await executor.execute(f.request, { approvalId: approval.approval?.id });
    expect(result.status, result.error).toBe("done");
    expect(JSON.stringify(result)).not.toContain("session-secret-123");
    const payment = f.transport.mock.calls.find(([url]) =>
      new URL(String(url)).pathname.startsWith("/pay"),
    );
    expect(payment).toBeDefined();
    if (side !== "total") expect(String(payment?.[0])).toContain("/key/session-secret-123");
  });

  it.each([
    "total-token",
    "total-query",
    "payment-query",
    "payment-header",
  ])("refuses path token name collisions with %s", async (collision) => {
    const f = fixture();
    reserve(f.pay, "sessionPath");
    if (collision === "total-token") reserve(f.read, "sessionPath");
    else if (collision === "total-query")
      f.read.request.urlTemplate += "?SESSIONPATH=configuration";
    else if (collision === "payment-query")
      f.pay.request.urlTemplate += "?SESSIONPATH=configuration";
    else f.pay.request.headers = { SESSIONPATH: "configuration" };
    const result = await f.start(sessionExecutor(f));
    expect(result.status, result.error).toBe("refused");
    expect(result.error).toMatch(
      /CSRF target|duplicate wire field|payment sends|basket total sends/,
    );
    expect(
      f.transport.mock.calls.some(([url]) => new URL(String(url)).pathname.startsWith("/pay")),
    ).toBe(false);
  });
});
