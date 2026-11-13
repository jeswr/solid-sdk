// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { parseActionRequest } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { compileOperation } from "../src/compile.js";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { extract } from "../src/extract.js";
import { createApprovalGate } from "../src/gate.js";
import { factsMoney } from "../src/money.js";

const O = "https://shop.test";
const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
type Transport = NonNullable<Parameters<typeof createExecutor>[0]["fetch"]>;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
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
    request: { method: "POST", urlTemplate: `${O}/pay`, contentType: "application/json" },
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

describe("r5 payment wire binding", () => {
  const invalidTemplates: [string, Partial<Operation["request"]>][] = [
    ["unused", { bodyTemplate: '{"submit":"Pay"}' }],
    ["embedded", { bodyTemplate: '{"sent":"9{value}"}' }],
    ["duplicated", { bodyTemplate: '{"one":"{value}","two":"{value}"}' }],
    ["query embedded", { urlTemplate: `${O}/pay?sent={value}000`, bodyTemplate: "{}" }],
    ["query duplicated", { urlTemplate: `${O}/pay?one={value}&two={value}`, bodyTemplate: "{}" }],
    ["path embedded", { urlTemplate: `${O}/pay/9{value}`, bodyTemplate: "{}" }],
    ["path prefix", { urlTemplate: `${O}/pay/{value:1}`, bodyTemplate: "{}" }],
    [
      "whole plus prefix",
      { urlTemplate: `${O}/pay?extra={value:1}`, bodyTemplate: '{"sent":"{value}"}' },
    ],
    [
      "form embedded",
      { contentType: "application/x-www-form-urlencoded", bodyTemplate: "sent=9{value}" },
    ],
    [
      "form duplicated",
      { contentType: "application/x-www-form-urlencoded", bodyTemplate: "one={value}&two={value}" },
    ],
    ["multipart embedded", { contentType: "multipart/form-data", bodyTemplate: "sent={value}000" }],
  ];
  it.each([
    "delivery",
    "qty",
    "order",
    "identifier",
    "iri",
    "referencesOrder",
  ])("#1 refuses unused, embedded, duplicated or transformed payment inputs (%s)", async (name) => {
    for (const [variant, template] of invalidTemplates) {
      const f = fixture();
      const isOption = name === "delivery" || name === "qty";
      const path = isOption
        ? name === "delivery"
          ? ["deliveryMethod"]
          : []
        : name === "order"
          ? ["object", "orderNumber"]
          : name === "identifier"
            ? ["object", "identifier"]
            : name === "referencesOrder"
              ? ["referencesOrder"]
              : ["object"];
      const value =
        name === "delivery"
          ? "standard"
          : name === "qty"
            ? "1"
            : name === "identifier"
              ? "basket-104"
              : name === "iri" || name === "referencesOrder"
                ? order.url
                : "104";
      f.pay.inputs = [param("value", path, { default: value })];
      if (isOption) f.read.inputs = [param("value", path, { location: "query", default: value })];
      Object.assign(f.pay.request, template);
      const result = await f.start();
      expect(result.status, `${name}: ${variant}`).toBe("refused");
      expect(
        f.transport.mock.calls.some(([url]) => new URL(String(url)).pathname.startsWith("/pay")),
      ).toBe(false);
    }
  });

  it.each([
    "json",
    "query",
    "form",
    "multipart",
  ])("#1 refuses static shadows of quote and checked identity names (%s)", async (surface) => {
    for (const identity of [false, true]) {
      const f = fixture();
      f.read.inputs = [
        param("delivery", ["deliveryMethod"], { location: "query", default: "standard" }),
      ];
      f.pay.inputs = [
        param("shipping", ["deliveryMethod"], { default: "standard" }),
        param("order", ["object", "orderNumber"], { default: "104" }),
      ];
      const shadow = identity ? "order" : "delivery";
      f.pay.request.bodyTemplate = `{"sentOrder":"{order}","shipping":"{shipping}"${surface === "json" ? `,"nested":{"${shadow}":"wrong"}` : ""}}`;
      if (surface === "query") f.pay.request.urlTemplate += `?${shadow}=wrong`;
      if (surface === "form" || surface === "multipart") {
        f.pay.request.contentType =
          surface === "form" ? "application/x-www-form-urlencoded" : "multipart/form-data";
        f.pay.request.bodyTemplate = `sentOrder={order}&shipping={shipping}&${shadow}=wrong`;
      }
      const result = await f.start();
      expect(result.status, `${surface}, identity=${identity}`).toBe("refused");
      expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
    }
  });

  it.each([
    "json",
    "query",
    "form",
    "multipart",
    "path",
    "header",
  ])("#1 Rule W refuses differently named options and payment-only submit literals (%s)", async (surface) => {
    const f = fixture();
    f.read.inputs = [
      param("delivery", ["deliveryMethod"], { location: "query", default: "standard" }),
    ];
    f.pay.inputs = [param("shipping", ["deliveryMethod"], { default: "standard" })];
    f.pay.request.bodyTemplate = '{"shipping":"{shipping}","submit":"Pay"}';
    if (surface === "query" || surface === "path" || surface === "header") {
      f.pay.inputs[0] = param("shipping", ["deliveryMethod"], {
        default: "standard",
        location: surface,
      });
      f.pay.request.bodyTemplate = '{"submit":"Pay"}';
      if (surface === "path") f.pay.request.urlTemplate += "/{shipping}";
    }
    if (surface === "form" || surface === "multipart") {
      f.pay.request.contentType =
        surface === "form" ? "application/x-www-form-urlencoded" : "multipart/form-data";
      f.pay.request.bodyTemplate = "shipping={shipping}&submit=Pay";
    }
    const result = await f.start();
    expect(result.status).toBe("refused");
    expect(result.error).toContain("payment sends");
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
  });

  it("#1 counts payment uses across locations and rejects direct-buy quantity shadows", async () => {
    for (const direct of [false, true]) {
      const f = fixture(direct);
      f.pay.inputs.push(
        param("qty", ["orderQuantity"], { range: `${X}integer`, default: "1", location: "query" }),
      );
      if (!direct)
        f.read.inputs = [
          param("qty", ["orderQuantity"], {
            range: `${X}integer`,
            default: "1",
            location: "query",
          }),
        ];
      f.pay.request.bodyTemplate = direct ? '{"item":"{item}","qty":1000}' : '{"qty":"{qty}"}';
      expect((await f.start()).status).toBe("refused");
    }
  });

  it.each([
    "option",
    "identity",
    "quote name",
  ])("#1 refuses CSRF decoration that bypasses or shadows checked inputs (%s)", async (mode) => {
    const f = fixture();
    f.read.inputs = [
      param("delivery", ["deliveryMethod"], { default: "standard", location: "query" }),
    ];
    f.pay.inputs =
      mode === "identity"
        ? [param("order", ["object", "orderNumber"], { default: "104" })]
        : [param("shipping", ["deliveryMethod"], { default: "standard" })];
    f.pay.csrf = [
      {
        source: { kind: "json", urlTemplate: `${O}/token`, pointer: "/token" },
        target: {
          kind: "form",
          name: mode === "identity" ? "order" : mode === "quote name" ? "delivery" : "shipping",
        },
      },
    ];
    f.pay.request.bodyTemplate = mode === "quote name" ? '{"shipping":"{shipping}"}' : "{}";
    f.transport.mockImplementation(async (url, init) =>
      String(url).endsWith("/token")
        ? Response.json({ token: "secret" })
        : init?.method === "GET"
          ? Response.json({ items: [order] })
          : Response.json({}),
    );
    const result = await f.start();
    expect(result.status).toBe("refused");
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
  });

  it.each(
    invalidTemplates,
  )("#1 refuses direct-buy quantity transformations (%s)", async (_variant, template) => {
    const f = fixture(true);
    f.pay.inputs.push(param("value", ["orderQuantity"], { range: `${X}integer`, default: "1" }));
    Object.assign(f.pay.request, template);
    // Keep the product identity whole so quantity is the only invalid input.
    f.pay.inputs[0] = param("item", ["object", "productID"], {
      location: "header",
      default: "104",
    });
    const result = await f.start();
    expect(result.status).toBe("refused");
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
  });

  it("#1 Rule W refuses an unrelated direct-buy submit literal", async () => {
    const f = fixture(true);
    f.pay.inputs.push(param("qty", ["orderQuantity"], { range: `${X}integer`, default: "3" }));
    f.pay.request.bodyTemplate = '{"item":"{item}","qty":{qty},"submit":"Pay"}';
    const result = await f.start();
    expect(result.status).toBe("refused");
    expect(result.error).toContain("payment sends /submit");
  });
});

describe("r5 complete order identity evidence", () => {
  it.each([
    "orderNumber",
    "identifier",
    "iri",
  ])("#2 refuses contradictory identity-only records (%s)", async (identity) => {
    for (const bound of [false, true]) {
      const f = fixture();
      if (bound) f.pay.inputs = [param("order", ["object", "orderNumber"], { default: "104" })];
      const conflicting = {
        ...order,
        price: undefined,
        currency: undefined,
        ...(identity === "iri" ? { url: `${O}/order/999` } : { [identity]: "999" }),
      };
      f.transport.mockImplementation(async (_url, init) =>
        init?.method === "GET" ? Response.json({ items: [order, conflicting] }) : Response.json({}),
      );
      const result = await f.start();
      expect(result.status, `${identity}, bound=${bound}`).toBe("refused");
      expect(result.error).toContain("order identity");
    }
  });

  it.each([
    "iri",
    "orderNumber",
    "identifier",
  ])("#2 includes identity-only records of the selected order even without a total type (%s)", async (link) => {
    const f = fixture();
    const other = {
      ...f.read,
      id: "urn:identity",
      request: { method: "GET" as const, urlTemplate: `${O}/identity` },
      extraction: { ...required(f.read.extraction), itemType: `${S}Thing` },
    };
    f.model.operations.push(other);
    f.flow.steps.splice(2, 0, { operation: other.id, bind: {} });
    f.transport.mockImplementation(async (url, init) =>
      init?.method === "GET"
        ? Response.json({
            items: String(url).includes("/identity")
              ? [
                  link === "iri"
                    ? { url: order.url, orderNumber: "999" }
                    : link === "orderNumber"
                      ? { orderNumber: "104", identifier: "other-basket" }
                      : { identifier: order.identifier, orderNumber: "999" },
                ]
              : [order],
          })
        : Response.json({}),
    );
    const result = await f.start();
    expect(result.status).toBe("refused");
    expect(result.error).toContain("order identity");
  });

  it("#2 binds every identity-only record and source in the evidence digest", async () => {
    const f = fixture();
    const records = [order, { url: order.url, orderNumber: "104" }];
    const output = await extract(required(f.read.extraction), JSON.stringify({ items: records }), {
      baseUrl: O,
      redact: (v) => v,
    });
    const evidence = factsMoney(
      O,
      [{ step: 1, operation: f.read, url: `${O}/quote`, items: output.items }],
      [
        {
          step: 2,
          operation: f.pay,
          values: {},
          sources: {},
          compiled: compileOperation(f.pay, {}, O),
        },
      ],
      0,
    );
    expect(evidence?.binding.records).toHaveLength(2);
    expect(evidence?.binding.records[1]).toMatchObject({
      iri: order.url,
      amounts: [],
      currencies: [],
      identity: [[`${S}orderNumber`, ["104"]]],
    });
  });

  it.each([
    "contradiction",
    "consistent change",
  ])("#2 revalidates identity-only sources before consuming approval (%s)", async (change) => {
    const f = fixture();
    f.read.inputs = [
      param("delivery", ["deliveryMethod"], { location: "query", default: "standard" }),
    ];
    f.pay.inputs = [
      param("delivery", ["deliveryMethod"], { default: "standard", location: "form" }),
      param("order", ["object", "orderNumber"], { default: "104" }),
    ];
    f.pay.request.contentType = "application/x-www-form-urlencoded";
    const other = {
      ...f.read,
      id: "urn:identity",
      inputs: [],
      extraction: { ...required(f.read.extraction), itemType: `${S}Thing` },
      request: { method: "GET" as const, urlTemplate: `${O}/identity` },
    };
    f.model.operations.push(other);
    f.flow.steps.splice(2, 0, { operation: other.id, bind: {} });
    let changed = false;
    f.transport.mockImplementation(async (url, init) =>
      init?.method === "GET"
        ? Response.json({
            items: String(url).includes("/identity")
              ? [
                  {
                    url: order.url,
                    orderNumber: changed && change === "contradiction" ? "999" : "104",
                    ...(changed && change === "consistent change"
                      ? { identifier: order.identifier }
                      : {}),
                  },
                ]
              : [order],
          })
        : Response.json({}),
    );
    const executor = f.executor();
    const approval = await f.start(executor);
    expect(approval.status).toBe("needs-approval");
    changed = true;
    f.gate.approve(approval.approval?.id ?? "");
    const retry = await executor.execute(f.request, { approvalId: approval.approval?.id });
    expect(retry.status).toBe(change === "contradiction" ? "refused" : "needs-approval");
    if (change === "consistent change")
      expect(retry.approval?.digest).not.toBe(approval.approval?.digest);
    expect(
      f.transport.mock.calls.filter(([url]) => String(url).includes("/identity")),
    ).toHaveLength(2);
    expect(f.transport.mock.calls.filter(([url]) => String(url).includes("/prepare"))).toHaveLength(
      1,
    );
    expect(f.transport.mock.calls.some(([url]) => String(url).includes("/pay"))).toBe(false);
  });
});
