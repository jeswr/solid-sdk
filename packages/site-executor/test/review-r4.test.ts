// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { parseActionRequest } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { extract } from "../src/extract.js";
import { createApprovalGate } from "../src/gate.js";

const actionRequest = (text: string) =>
  parseActionRequest(`@prefix schema: <https://schema.org/> . ${text}`);

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
type Transport = NonNullable<Parameters<typeof createExecutor>[0]["fetch"]>;
const O = "https://shop.test";
const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
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
const product = (extra = {}) => ({
  url: `${O}/product/104`,
  productID: "104",
  price: "20",
  currency: "GBP",
  ...extra,
});
function fixture(priorWrite = false) {
  const read: Operation = {
    id: "urn:read",
    actionType: `${S}ViewAction`,
    label: "Read",
    effect: "read",
    session: "none",
    provenance,
    inputs: [],
    request: { method: "GET", urlTemplate: `${O}/quote` },
    extraction: {
      format: "json",
      itemPath: "/items",
      itemType: `${S}Product`,
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        { property: `${S}object`, path: "/object", datatype: "iri" },
        ...["productID", "identifier", "orderNumber", "price", "currency", "totalPaymentDue"].map(
          (p) => ({ property: S + p, path: `/${p}` }),
        ),
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
    inputs: [param("item", ["object", "productID"])],
    request: { method: "POST", urlTemplate: `${O}/pay`, contentType: "application/json" },
  };
  const mutate: Operation = {
    ...pay,
    id: "urn:shipping",
    label: "Change shipping",
    effect: "irreversible-write",
    inputs: [],
    request: { method: "POST", urlTemplate: `${O}/shipping` },
  };
  const flow: Flow = {
    id: "urn:buy",
    label: "Buy",
    actionType: `${S}BuyAction`,
    effect: "payment",
    inputs: [],
    provenance,
    steps: [
      ...(priorWrite ? [{ operation: mutate.id, bind: {} }] : []),
      { operation: read.id, bind: {} },
      { operation: pay.id, bind: { item: "104" } },
    ],
  };
  if (priorWrite) {
    pay.inputs = [];
    required(flow.steps.at(-1)).bind = {};
  }
  const model: SiteModel = {
    id: "urn:model",
    site: O,
    version: "1",
    generatedAt: "2026-11-13",
    operations: [read, pay, mutate],
    flows: [flow],
  };
  const buy = () => actionRequest(`[] a schema:BuyAction; schema:object <${O}/product/104>.`);
  const transport =
    (items: unknown[] = [product()]): Transport =>
    async (_url, init) =>
      init?.method === "GET" ? Response.json({ items }) : Response.json({});
  const executor = (injected: Transport) =>
    createExecutor({
      model,
      fetch: injected,
      sessions: new InMemorySessions(),
      gate: { authorize: async () => ({ kind: "allow" }) },
    });
  return { model, read, pay, mutate, flow, buy, transport, executor };
}

describe("r4 complete money evidence", () => {
  it.each([
    false,
    true,
  ])("#1 combines separate amount-only and currency-only records (total=%s)", async (total) => {
    const f = fixture(total);
    if (total) required(f.read.extraction).itemType = `${S}Order`;
    const result = await f
      .executor(
        f.transport([
          { url: `${O}/product/104`, productID: "104", price: "20" },
          { url: `${O}/product/104`, productID: "104", currency: "GBP" },
        ]),
      )
      .execute(f.buy());
    expect(result.status).toBe("done");
    expect(result.outcome).toMatchObject({ amount: "20", currency: "GBP" });
  });

  it.each([
    false,
    true,
  ])("#1 aggregates partial amount and currency claims across records (total=%s)", async (total) => {
    for (const partial of [{ price: "1000" }, { currency: "USD" }]) {
      const f = fixture(total);
      if (total) required(f.read.extraction).itemType = `${S}Order`;
      const result = await f
        .executor(f.transport([product(), { productID: "104", ...partial }]))
        .execute(f.buy());
      expect(result.status).toBe("refused");
      expect(result.committed).toHaveLength(total ? 1 : 0);
    }
  });

  it.each([
    false,
    true,
  ])("#1 revalidates a separate partial-only monetary source (total=%s)", async (total) => {
    const f = fixture(total);
    if (total) required(f.read.extraction).itemType = `${S}Order`;
    const other = {
      ...f.read,
      id: "urn:other",
      request: { method: "GET" as const, urlTemplate: `${O}/other` },
    };
    f.model.operations.push(other);
    f.flow.steps.splice(f.flow.steps.length - 1, 0, { operation: other.id, bind: {} });
    let price = "20";
    const transport = vi.fn<Transport>(async (url) =>
      Response.json({
        items: String(url).endsWith("other") ? [{ productID: "104", price }] : [product()],
      }),
    );
    const gate = createApprovalGate();
    const executor = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
      gate,
      fetch: transport,
    });
    let first = await executor.execute(f.buy());
    if (total) {
      gate.approve(first.approval?.id ?? "");
      first = await executor.execute(f.buy(), { approvalId: first.approval?.id });
    }
    expect(first.status).toBe("needs-approval");
    price = "1000";
    gate.approve(first.approval?.id ?? "");
    const retry = await executor.execute(f.buy(), { approvalId: first.approval?.id });
    expect(retry.status).toBe("refused");
    expect(transport.mock.calls.filter(([url]) => String(url).endsWith("other"))).toHaveLength(2);
  });

  it.each([
    false,
    true,
  ])("#2 refuses hidden item conflicts after the extraction limit (total=%s)", async (total) => {
    const f = fixture(total);
    if (total) required(f.read.extraction).itemType = `${S}Order`;
    const items = [
      ...Array.from({ length: 200 }, () => product({ price: "1" })),
      product({ price: "1000" }),
    ];
    const result = await f.executor(f.transport(items)).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("incomplete");
  });

  it("#2 detects JSON and HTML item overflow with bounded materialization and reports value truncation", async () => {
    const f = fixture();
    const json = await extract(
      required(f.read.extraction),
      JSON.stringify({ items: Array.from({ length: 10000 }, () => product()) }),
      { baseUrl: O, redact: (v) => v, maxItems: 2 },
    );
    expect(json.items).toHaveLength(2);
    expect(json).toMatchObject({ truncation: { items: true, values: false } });
    const html = await extract(
      {
        format: "html",
        itemPath: "article",
        itemType: `${S}Product`,
        fields: [{ property: `${S}name`, path: "." }],
      },
      "<article>long name</article>".repeat(1000),
      { baseUrl: O, redact: (v) => v, maxItems: 2, maxValueLength: 4 },
    );
    expect(html.items).toHaveLength(2);
    expect(html).toMatchObject({ truncation: { items: true, values: true } });
  });

  it("#2 refuses a money-capable truncated read even when retained identities do not match", async () => {
    const f = fixture();
    const other = {
      ...f.read,
      id: "urn:other",
      request: { method: "GET" as const, urlTemplate: `${O}/other` },
    };
    f.model.operations.push(other);
    f.flow.steps.splice(1, 0, { operation: other.id, bind: {} });
    const result = await f
      .executor(async (url) =>
        Response.json({
          items: String(url).endsWith("other")
            ? [
                ...Array.from({ length: 200 }, () =>
                  product({ productID: "999", url: `${O}/product/999` }),
                ),
                product({ price: "1000" }),
              ]
            : [product()],
        }),
      )
      .execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("incomplete");
  });

  it("#2 refuses monetary evidence when an extracted value was truncated", async () => {
    const f = fixture();
    required(f.read.extraction).fields.push({ property: `${S}name`, path: "/name" });
    const result = await f
      .executor(f.transport([product({ name: "x".repeat(4001) })]))
      .execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("incomplete");
  });
});

describe("r4 payment configuration and effects", () => {
  it("#3 refuses configuration declared on a total read but absent from its request", async () => {
    const f = fixture(true);
    required(f.read.extraction).itemType = `${S}Order`;
    f.read.inputs = [param("delivery", ["deliveryMethod"], { default: "express" })];
    f.pay.inputs = [param("delivery", ["deliveryMethod"])];
    required(f.flow.steps.at(-1)).bind = { delivery: "express" };
    const result = await f.executor(f.transport()).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("which the basket total did not cover");
  });

  it("#3 checks configuration against every contributing total read", async () => {
    const f = fixture(true);
    required(f.read.extraction).itemType = `${S}Order`;
    f.read.inputs = [
      param("delivery", ["deliveryMethod"], { location: "query", default: "standard" }),
    ];
    const other = {
      ...f.read,
      id: "urn:other",
      inputs: [param("delivery", ["deliveryMethod"], { location: "query", default: "express" })],
    };
    f.model.operations.push(other);
    f.flow.steps.splice(f.flow.steps.length - 1, 0, { operation: other.id, bind: {} });
    f.pay.inputs.push(param("delivery", ["deliveryMethod"]));
    required(f.flow.steps.at(-1)).bind.delivery = "express";
    const result = await f.executor(f.transport()).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("which the basket total did not cover");
  });

  it.each([
    "delivery",
    "qty",
    "coupon",
  ])("#3 refuses a total for different or absent checkout configuration (%s)", async (name) => {
    const f = fixture(true);
    required(f.read.extraction).itemType = `${S}Order`;
    const path = name === "qty" ? ["orderQuantity"] : [name];
    f.read.inputs =
      name === "coupon"
        ? []
        : [param(name, path, { location: "query", default: name === "qty" ? "1" : "standard" })];
    f.pay.inputs.push(param(name, path));
    required(f.flow.steps.at(-1)).bind[name] =
      name === "qty" ? "1000" : name === "delivery" ? "express" : "extra";
    const result = await f.executor(f.transport()).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("which the basket total did not cover");
    expect(result.committed).toHaveLength(1);
  });

  it("#3 refuses unaccounted direct-buy options and an unmapped quantity", async () => {
    for (const [name, path] of [
      ["delivery", ["delivery"]],
      ["qty", []],
    ] as const) {
      const f = fixture();
      f.pay.inputs.push(param(name, [...path]));
      required(f.flow.steps.at(-1)).bind[name] = "1000";
      const result = await f.executor(f.transport()).execute(f.buy());
      expect(result.status).toBe("refused");
      expect(result.error).toContain("which the basket total did not cover");
    }
  });

  it.each([
    "name",
    "path",
  ])("#3 Rule W refuses JSON pointer/name differences despite canonical matching by %s", async (match) => {
    const f = fixture(true);
    required(f.read.extraction).itemType = `${S}Order`;
    f.read.inputs = [
      param(match === "name" ? "qty" : "count", ["orderQuantity"], {
        location: "query",
        range: `${X}integer`,
        default: "01",
      }),
    ];
    f.pay.inputs.push(
      param("qty", match === "name" ? [] : ["orderQuantity"], { range: `${X}integer` }),
    );
    required(f.flow.steps.at(-1)).bind.qty = "+1";
    const result = await f.executor(f.transport()).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("payment sends /qty");
  });

  it("#3 accounts for a mapped direct-buy quantity by exact multiplication", async () => {
    const f = fixture();
    f.pay.inputs.push(param("qty", ["orderQuantity"], { range: `${X}integer` }));
    required(f.flow.steps.at(-1)).bind.qty = "3";
    const result = await f.executor(f.transport()).execute(f.buy());
    expect(result.status).toBe("done");
    expect(result.outcome?.amount).toBe("60");
  });

  it("#4 rejects a payment flow without a payment operation at construction", () => {
    const f = fixture();
    f.pay.effect = "irreversible-write";
    expect(() => f.executor(f.transport())).toThrow("payment operation");
  });

  it("#4 gates preparatory writes by their own effect and requires evidence on every payment-gated write", async () => {
    const f = fixture(true);
    required(f.read.extraction).itemType = `${S}Order`;
    const effects: string[] = [];
    const executor = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
      fetch: f.transport(),
      gate: {
        authorize: async (r) => {
          effects.push(r.effect);
          if (r.effect === "payment") {
            expect(r.amount).toBe("20");
            expect(r.currency).toBe("GBP");
          }
          return { kind: "allow" };
        },
      },
    });
    expect((await executor.execute(f.buy())).status).toBe("done");
    expect(effects).toEqual(["irreversible-write", "read", "payment"]);
  });
});

describe("r4 response term kinds", () => {
  it("#6 normalizes response IRIs through scalar bindings and repeat fingerprints while literals stay verbatim", async () => {
    for (const iri of [true, false]) {
      const f = fixture();
      f.pay.effect = "irreversible-write";
      f.flow.effect = "irreversible-write";
      f.pay.inputs = [param("item", [])];
      required(f.flow.steps.at(-1)).bind.item = `$step0.${S}object`;
      const field = required(f.read.extraction).fields.find((r) => r.property === `${S}object`);
      required(field).datatype = iri ? "iri" : undefined;
      let value = `${O}/product/104`;
      const transport = vi.fn<Transport>(async (_url, init) =>
        init?.method === "GET"
          ? Response.json({ items: [product({ object: value })] })
          : Response.json({}),
      );
      const executor = f.executor(transport);
      const first = await executor.execute(f.buy());
      expect(first.status).toBe("done");
      value = "https://SHOP.test:443/product/104";
      const second = await executor.execute(f.buy(), {
        excludeFingerprints: first.committed.map((e) => e.fingerprint),
      });
      expect(second.status).toBe(iri ? "refused" : "done");
      if (iri) expect(second.errorKind).toBe("repeat");
      else expect(transport.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({ item: value }));
    }
  });

  it("#6 retains normalized NamedNode kinds alongside verbatim literals in structured items", async () => {
    const output = await extract(
      {
        format: "json",
        itemType: `${S}Product`,
        fields: [
          { property: `${S}url`, path: "/iri", datatype: "iri" },
          { property: `${S}name`, path: "/text" },
        ],
      },
      JSON.stringify({
        iri: "https://SHOP.test:443/product/104",
        text: "https://SHOP.test:443/product/104",
      }),
      { baseUrl: O, redact: (v) => v },
    );
    expect(output.items[0]?.values.get(`${S}url`)).toEqual([`${O}/product/104`]);
    expect(output.items[0]?.values.get(`${S}name`)).toEqual(["https://SHOP.test:443/product/104"]);
    expect(output.items[0]).toMatchObject({
      terms: new Map([
        [
          `${S}url`,
          [expect.objectContaining({ termType: "NamedNode", value: `${O}/product/104` })],
        ],
        [
          `${S}name`,
          [
            expect.objectContaining({
              termType: "Literal",
              value: "https://SHOP.test:443/product/104",
            }),
          ],
        ],
      ]),
    });
  });
});
