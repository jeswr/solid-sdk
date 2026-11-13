// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { createApprovalGate, type Gate } from "../src/gate.js";
import { factsMoney } from "../src/money.js";
import { actionRequest } from "./helpers.js";

const O = "https://shop.test";
const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
const provenance = {
  derivedFrom: [],
  learnedAt: "2026-11-13",
  method: "manual" as const,
  confidence: 1,
};
const p = (name: string, path: string[], extra: Partial<Parameter> = {}): Parameter => ({
  name,
  path: path.map((v) => S + v),
  range: `${X}string`,
  required: true,
  location: "body",
  ...extra,
});
function fixture() {
  const read: Operation = {
    id: "urn:product",
    actionType: `${S}ViewAction`,
    label: "View product",
    effect: "read",
    session: "none",
    provenance,
    inputs: [p("id", ["object"], { range: `${S}Product`, location: "path" })],
    request: { method: "GET", urlTemplate: `${O}/product/{id}` },
    extraction: {
      format: "json",
      itemPath: "/items",
      itemType: `${S}Product`,
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        { property: `${S}sku`, path: "/sku" },
        { property: `${S}price`, path: "/price" },
        { property: `${S}priceCurrency`, path: "/currency" },
      ],
    },
  };
  const pay: Operation = {
    id: "urn:pay",
    actionType: `${S}PayAction`,
    label: "Checkout",
    effect: "payment",
    session: "none",
    provenance,
    inputs: [p("sku", ["object", "sku"]), p("qty", ["orderQuantity"], { range: `${X}decimal` })],
    request: { method: "POST", urlTemplate: `${O}/checkout`, contentType: "application/json" },
  };
  const flow: Flow = {
    id: "urn:buy",
    actionType: `${S}BuyAction`,
    label: "Buy",
    effect: "payment",
    provenance,
    inputs: [
      p("id", ["object"], { range: `${S}Product` }),
      p("qty", ["orderQuantity"], { required: false, default: "1", range: `${X}decimal` }),
    ],
    steps: [
      { operation: read.id, bind: { id: "$input.id" } },
      { operation: pay.id, bind: { sku: "$step0.schema:sku", qty: "$input.qty" } },
    ],
  };
  const model: SiteModel = {
    id: "urn:model",
    site: O,
    version: "1",
    generatedAt: "2026-11-13",
    operations: [read, pay],
    flows: [flow],
  };
  const payStep = flow.steps[1] as Flow["steps"][number];
  return { model, read, pay, flow, payStep };
}
const request = (claims = 'schema:price "20"; schema:priceCurrency "GBP";', quantity = "1") =>
  actionRequest(
    `[] a schema:BuyAction; schema:object <${O}/product/104>; schema:orderQuantity ${quantity}; ${claims} schema:name "purchase" .
  <${O}/product/104> schema:name "Trail Runner sneakers" .`,
  );
const product = (extra = {}) => ({
  url: `${O}/product/104`,
  sku: "TRAIL",
  price: "20.00",
  currency: "GBP",
  ...extra,
});
const allow = (): Gate & { authorize: ReturnType<typeof vi.fn<Gate["authorize"]>> } => ({
  authorize: vi.fn(async () => ({ kind: "allow" as const })),
});
const transport = (items: unknown[] = [product()]) =>
  vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "POST" ? Response.json({ order: 1 }) : Response.json({ items }),
  );

describe("money from trusted reads in the same flow", () => {
  it.each([
    ['schema:price "19"; schema:priceCurrency "GBP";', "cap"],
    ['schema:price "20"; schema:priceCurrency "EUR";', "currency"],
  ])("refuses a planner %s before offering approval (%s)", async (claims) => {
    const { model } = fixture();
    const fetch = transport();
    const gate = allow();
    const result = await createExecutor({
      model,
      fetch,
      gate,
      sessions: new InMemorySessions(),
    }).execute(request(claims));
    expect(result).toMatchObject({ status: "refused", error: expect.stringContaining("GBP 20") });
    expect(result.approval).toBeUndefined();
    expect(gate.authorize.mock.calls.map(([r]) => r.effect)).toEqual(["read"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "",
    'schema:price "25"; schema:priceCurrency "GBP";',
  ])("shows the real site amount with planner claims %j", async (claims) => {
    const { model } = fixture();
    const result = await createExecutor({
      model,
      fetch: transport(),
      sessions: new InMemorySessions(),
    }).execute(request(claims));
    expect(result.status).toBe("needs-approval");
    expect(result.approval).toMatchObject({
      amount: "20",
      currency: "GBP",
      summary: "Buy Trail Runner sneakers for GBP 20.00 on shop.test",
    });
  });

  it.each(["price", "priceCurrency"])("ignores an untrusted %s field", async (property) => {
    const { model, read } = fixture();
    const field = read.extraction?.fields.find((f) => f.property === S + property);
    if (!field) throw new Error("Missing fixture field");
    field.untrusted = true;
    const fetch = transport();
    const result = await createExecutor({
      model,
      fetch,
      gate: allow(),
      sessions: new InMemorySessions(),
    }).execute(request());
    expect(result.status).toBe("refused");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.observations.some((o) => o.turtle.includes("sab:UntrustedText"))).toBe(true);
  });

  it("ignores off-origin items and unrelated products, then takes the first matching item", async () => {
    const { model, payStep } = fixture();
    const fetch = transport([
      product({ url: "https://attacker.test/product/104", price: "1" }),
      product({ url: `${O}/product/999`, sku: "OTHER", price: "2" }),
      product(),
    ]);
    // Match the concrete SKU being purchased, not the first response item's SKU.
    payStep.bind.sku = "TRAIL";
    const result = await createExecutor({ model, fetch, sessions: new InMemorySessions() }).execute(
      request(),
    );
    expect(result.approval?.amount).toBe("20");
  });

  it("rejects off-origin read provenance even for an on-origin item", () => {
    const { read } = fixture();
    expect(
      factsMoney(
        O,
        [
          {
            step: 0,
            operation: read,
            url: "https://attacker.test/quote",
            items: [
              {
                iri: `${O}/product/104`,
                values: new Map([
                  [`${S}price`, ["1"]],
                  [`${S}priceCurrency`, ["GBP"]],
                ]),
              },
            ],
          },
        ],
        [],
        -1,
      ),
    ).toBeUndefined();
  });

  it("matches a product IRI to the bound id without requiring a SKU field", async () => {
    const { model, pay, payStep } = fixture();
    pay.inputs[0] = p("id", ["object"], { range: `${S}Product` });
    payStep.bind = { id: "$input.id", qty: "$input.qty" };
    const result = await createExecutor({
      model,
      fetch: transport([product({ sku: undefined })]),
      sessions: new InMemorySessions(),
    }).execute(request());
    expect(result.approval?.amount).toBe("20");
  });

  it("requires the product's SKU and id to agree with all write bindings", async () => {
    const { model, pay } = fixture();
    pay.inputs.push(p("id", ["object", "identifier"], { default: "999" }));
    const fetch = transport();
    const result = await createExecutor({
      model,
      fetch,
      gate: allow(),
      sessions: new InMemorySessions(),
    }).execute(request());
    expect(result.status).toBe("refused");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    `${S}orderQuantity`,
    "https://jeswr.org/ns/site-action#quantity",
  ])("multiplies bound %s using exact decimals", async (quantityProperty) => {
    const { model, pay } = fixture();
    const qty = pay.inputs.find((p) => p.name === "qty");
    if (!qty) throw new Error("Missing fixture quantity");
    qty.path = [quantityProperty];
    const result = await createExecutor({
      model,
      fetch: transport([product({ price: "0.1234567890123456789" })]),
      sessions: new InMemorySessions(),
    }).execute(request("", "2.5"));
    expect(result.approval?.amount).toBe("0.30864197253086419725");
    expect(result.approval?.summary).toContain("GBP 0.30864197253086419725");
  });

  it.each(
    ["Order", "Invoice", "Product", "dynamicOrder"].flatMap((type) =>
      [true, false].map((fresh) => ({ type, fresh })),
    ),
  )("uses a purchase-bound $type total only after the last write (fresh=$fresh)", async ({
    type,
    fresh,
  }) => {
    const { model, read, pay, flow, payStep } = fixture();
    const add = {
      ...pay,
      id: "urn:add",
      actionType: `${S}AddToCartAction`,
      effect: "reversible-write" as const,
      request: { ...pay.request, urlTemplate: `${O}/cart` },
    };
    const total: Operation = {
      ...read,
      id: "urn:total",
      inputs: pay.inputs.map((input) => ({
        ...input,
        location: "query",
        default: input.name === "sku" ? "TRAIL" : "1",
      })),
      request: { method: "GET", urlTemplate: `${O}/total` },
      extraction: {
        format: "json",
        itemType: S + (type === "dynamicOrder" ? "Thing" : type),
        fields: [
          { property: S + (type === "Product" ? "totalPaymentDue" : "value"), path: "/total" },
          { property: `${S}currency`, path: "/currency" },
          { property: `${S}sku`, path: "/sku" },
          { property: `${S}orderQuantity`, path: "/qty" },
          { property: `${S}object`, path: "/object", datatype: "iri" },
          {
            property: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
            path: "/type",
            datatype: "iri",
          },
        ],
      },
    };
    pay.request.contentType = "application/x-www-form-urlencoded";
    model.operations.push(add, total);
    const additions = [
      { operation: add.id, bind: { ...payStep.bind } },
      { operation: total.id, bind: {} },
    ];
    flow.steps.splice(1, 0, ...(fresh ? additions : additions.reverse()));
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) =>
      new URL(String(url)).pathname === "/total"
        ? Response.json({
            total: "23.45",
            currency: "GBP",
            sku: "TRAIL",
            qty: "1",
            object: `${O}/product/104`,
            type: type === "dynamicOrder" ? `${S}Order` : undefined,
          })
        : init?.method === "GET"
          ? Response.json({ items: [product()] })
          : Response.json({}),
    );
    const gate = allow();
    const result = await createExecutor({
      model,
      fetch,
      gate,
      sessions: new InMemorySessions(),
    }).execute(request('schema:price "30";'));
    expect(result.status, result.error).toBe(fresh ? "done" : "refused");
    expect(
      gate.authorize.mock.calls.filter(([r]) => r.effect === "payment").map(([r]) => r.amount),
    ).toEqual(fresh ? ["23.45"] : []);
  });

  it("voids approval for a changed price and refuses a different source item", async () => {
    const { model } = fixture();
    let price = "20.00";
    let iri = `${O}/product/104`;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) =>
      init?.method === "POST"
        ? Response.json({})
        : Response.json({ items: [product({ price, url: iri })] }),
    );
    const gate = createApprovalGate();
    const ex = createExecutor({ model, fetch, gate, sessions: new InMemorySessions() });
    const req = request('schema:price "30";');
    const first = await ex.execute(req);
    gate.approve(first.approval?.id ?? "");
    price = "21.00";
    const second = await ex.execute(req, { approvalId: first.approval?.id ?? "" });
    expect(second.status).toBe("needs-approval");
    expect(second.approval?.amount).toBe("21");
    expect(second.approval?.digest).not.toBe(first.approval?.digest);
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    gate.approve(second.approval?.id ?? "");
    iri = `${O}/product/another-iri`;
    const third = await ex.execute(req, { approvalId: second.approval?.id ?? "" });
    expect(third.status).toBe("refused");
    expect(third.error).toContain("identity");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("refuses disagreement between wire money and site facts", async () => {
    const { model, pay, payStep } = fixture();
    pay.inputs.push(
      p("amount", ["amount"], { default: "21" }),
      p("currency", ["currency"], { default: "GBP" }),
    );
    payStep.bind.amount = "21";
    payStep.bind.currency = "GBP";
    const fetch = transport();
    const result = await createExecutor({
      model,
      fetch,
      gate: allow(),
      sessions: new InMemorySessions(),
    }).execute(request(""));
    expect(result.status).toBe("refused");
    expect(result.error).toContain("payment sends /amount");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps wire-mapping validation even when trusted facts are available", async () => {
    const { model, pay } = fixture();
    pay.inputs.push(p("amount", ["amount"], { default: "20" }));
    pay.request.bodyTemplate = '{"sku":{sku},"qty":{qty}}';
    const fetch = transport();
    const result = await createExecutor({
      model,
      fetch,
      gate: allow(),
      sessions: new InMemorySessions(),
    }).execute(request());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("sent exactly once as a whole value");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a price increase above the cap on re-read without sending the payment", async () => {
    const { model } = fixture();
    let price = "20";
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ items: [product({ price })] }),
    );
    const gate = createApprovalGate();
    const ex = createExecutor({ model, fetch, gate, sessions: new InMemorySessions() });
    const first = await ex.execute(request());
    gate.approve(first.approval?.id ?? "");
    price = "20.0000000000000000001";
    const result = await ex.execute(request(), { approvalId: first.approval?.id ?? "" });
    expect(result.status).toBe("refused");
    expect(result.error).toContain("GBP 20.0000000000000000001");
    expect(result.approval).toBeUndefined();
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("revalidates the price without replaying a completed basket write", async () => {
    const { model, read, pay, flow, payStep } = fixture();
    const add: Operation = {
      ...pay,
      id: "urn:add",
      effect: "reversible-write",
      request: { ...pay.request, urlTemplate: `${O}/cart` },
    };
    const total: Operation = {
      ...read,
      id: "urn:total",
      inputs: pay.inputs.map((input) => ({
        ...input,
        location: "query",
        default: input.name === "sku" ? "TRAIL" : "1",
      })),
      request: { method: "GET", urlTemplate: `${O}/total` },
      extraction: {
        format: "json",
        itemType: `${S}Order`,
        fields: [
          { property: `${S}price`, path: "/price" },
          { property: `${S}currency`, path: "/currency" },
        ],
      },
    };
    pay.request.contentType = "application/x-www-form-urlencoded";
    model.operations.push(add, total);
    flow.steps.splice(
      1,
      0,
      { operation: add.id, bind: { ...payStep.bind } },
      { operation: total.id, bind: {} },
    );
    let price = "20";
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) =>
      new URL(String(url)).pathname === "/total"
        ? Response.json({ price, currency: "GBP" })
        : init?.method === "GET"
          ? Response.json({ items: [product({ price })] })
          : Response.json({}),
    );
    const approvals = createApprovalGate();
    const gate: Gate = {
      authorize: (req) =>
        req.inputs.$step === "1" ? Promise.resolve({ kind: "allow" }) : approvals.authorize(req),
    };
    const ex = createExecutor({ model, fetch, gate, sessions: new InMemorySessions() });
    const req = request('schema:price "30";');
    const first = await ex.execute(req);
    expect(first.status, first.error).toBe("needs-approval");
    approvals.approve(first.approval?.id ?? "");
    price = "21";
    const changed = await ex.execute(req, { approvalId: first.approval?.id ?? "" });
    expect(changed.status).toBe("needs-approval");
    approvals.approve(changed.approval?.id ?? "");
    expect((await ex.execute(req, { approvalId: changed.approval?.id ?? "" })).status).toBe("done");
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => String(url)),
    ).toEqual([`${O}/cart`, `${O}/checkout`]);
  });

  it("does not use a previous action's observations to authorize a standalone payment", async () => {
    const { model } = fixture();
    const fetch = transport();
    const ex = createExecutor({ model, fetch, gate: allow(), sessions: new InMemorySessions() });
    expect(
      (
        await ex.execute(
          actionRequest(`[] a schema:ViewAction; schema:object <${O}/product/104> .`),
        )
      ).status,
    ).toBe("done");
    const result = await ex.execute(
      actionRequest(
        '[] a schema:PayAction; schema:object [schema:sku "TRAIL"]; schema:orderQuantity 1; schema:price "20"; schema:priceCurrency "GBP" .',
      ),
    );
    expect(result.status).toBe("refused");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
