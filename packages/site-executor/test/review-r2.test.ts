// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessions, type SessionBundle } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { createApprovalGate, summarise } from "../src/gate.js";
import { secretRedactor } from "../src/secrets.js";
import { actionRequest } from "./helpers.js";

const O = "https://shop.test";
const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
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
const product = (extra = {}) => ({
  url: `${O}/product/104`,
  sku: "TRAIL",
  productID: "104",
  price: "20",
  currency: "GBP",
  ...extra,
});
function fixture() {
  const read: Operation = {
    id: "urn:read",
    actionType: `${S}ViewAction`,
    label: "Read price",
    effect: "read",
    session: "none",
    provenance,
    inputs: [],
    request: { method: "GET", urlTemplate: `${O}/product/104` },
    extraction: {
      format: "json",
      itemPath: "/items",
      itemType: `${S}Product`,
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        ...[
          "sku",
          "productID",
          "identifier",
          "price",
          "priceCurrency",
          "currency",
          "orderQuantity",
        ].map((p) => ({ property: S + p, path: `/${p === "priceCurrency" ? "currency" : p}` })),
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
    inputs: [
      param("id", ["object", "productID"]),
      param("qty", ["orderQuantity"], { range: `${X}integer`, default: "1" }),
    ],
    request: { method: "POST", urlTemplate: `${O}/checkout`, contentType: "application/json" },
  };
  const flow: Flow = {
    id: "urn:buy",
    actionType: `${S}BuyAction`,
    label: "Buy",
    effect: "payment",
    provenance,
    inputs: [],
    steps: [
      { operation: read.id, bind: {} },
      { operation: pay.id, bind: { id: "104", qty: "1" } },
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
  const buy = () => actionRequest("[] a schema:BuyAction.");
  const transport = (items: unknown[] = [product()]) =>
    vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === "GET" ? Response.json({ items }) : Response.json({}),
    );
  const run = (fetch: typeof globalThis.fetch = transport()) =>
    createExecutor({
      model,
      fetch,
      sessions: new InMemorySessions(),
      gate: { authorize: async () => ({ kind: "allow" }) },
    }).execute(buy());
  return { model, read, pay, flow, buy, transport, run };
}

function total(f: ReturnType<typeof fixture>, id = "urn:total"): Operation {
  const op: Operation = {
    ...f.read,
    id,
    request: { method: "GET", urlTemplate: `${O}/${id.slice(4)}` },
    extraction: { ...required(f.read.extraction), itemType: `${S}Order` },
  };
  f.model.operations.push(op);
  return op;
}

describe("review r2 money regressions", () => {
  it.each([
    { price: ["1", "1000"] },
    { currency: ["GBP", "USD"] },
    { price: "1", value: "1000" },
    { price: "1", amount: "1000" },
    { price: ["1", "invalid"] },
  ])("refuses all conflicting monetary values on the selected item: %j", async (extra) => {
    const f = fixture();
    f.read.extraction?.fields.push(
      { property: `${S}value`, path: "/value" },
      { property: `${S}amount`, path: "/amount" },
    );
    const result = await f.run(f.transport([product(extra)]));
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringMatching(/conflicting.*(amount|currenc)/),
    });
  });

  it("binds every equivalent amount and currency value on approval retry", async () => {
    const f = fixture();
    let price = ["20", "20.0"];
    const gate = createApprovalGate();
    const ex = createExecutor({
      model: f.model,
      gate,
      sessions: new InMemorySessions(),
      fetch: async () => Response.json({ items: [product({ price })] }),
    });
    const first = await ex.execute(f.buy());
    gate.approve(required(first.approval).id);
    price = ["20", "20.00"];
    const next = await ex.execute(f.buy(), { approvalId: first.approval?.id });
    expect(next.status).toBe("needs-approval");
    expect(next.approval?.digest).not.toBe(first.approval?.digest);
  });

  it.each(["sku", "identifier"])("never matches productID to a colliding %s", async (key) => {
    const f = fixture();
    const result = await f.run(
      f.transport([
        product({ url: `${O}/product/999`, productID: "999", [key]: "104", price: "1" }),
      ]),
    );
    expect(result.status).toBe("refused");
  });

  it("requires exact normalized request IRI agreement even when the SKU matches", async () => {
    const f = fixture();
    f.flow.inputs = [param("item", ["object"], { range: `${S}Product` })];
    f.pay.inputs[0] = param("item", ["object"], { range: `${S}Product` });
    required(f.flow.steps[1]).bind = { item: "$input.item", qty: "1" };
    const ex = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
      fetch: f.transport([product({ url: `${O}/product/999`, sku: "104", productID: "999" })]),
    });
    const result = await ex.execute(
      actionRequest(`[] a schema:BuyAction; schema:object <https://SHOP.test:443/product/104>.`),
    );
    expect(result.status).toBe("refused");
  });

  it("refuses ambiguous suffix fallback when a second item matches another identifier type", async () => {
    const f = fixture();
    f.pay.inputs[0] = param("id", ["object"], { range: `${S}Product` });
    const result = await f.run(
      f.transport([
        product(),
        product({ url: `${O}/product/999`, productID: "999", sku: "104", price: "1" }),
      ]),
    );
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("ambiguous"),
    });
  });

  it("refuses a second fallback candidate even when its IRI is duplicated", async () => {
    const f = fixture();
    f.pay.inputs[0] = param("id", ["object"], { range: `${S}Product` });
    const result = await f.run(f.transport([product(), product({ price: "1" })]));
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("ambiguous"),
    });
  });

  it("ignores a quote for the wrong payment quantity and uses unit price times quantity", async () => {
    const f = fixture();
    const quote = total(f);
    f.flow.steps.splice(1, 0, { operation: quote.id, bind: {} });
    required(f.flow.steps[2]).bind.qty = "1000";
    const result = await f.run(async (url, init) =>
      init?.method === "POST"
        ? Response.json({})
        : Response.json({
            items: [
              product({ price: String(url).endsWith("/total") ? "1" : "20", orderQuantity: "1" }),
            ],
          }),
    );
    expect(result.outcome?.amount).toBe("20000");
  });

  it.each([
    "irreversible-write",
    "payment",
  ] as const)("invalidates a total before a preceding %s", async (effect) => {
    const f = fixture();
    const quote = total(f);
    const mutation: Operation = {
      ...f.pay,
      id: "urn:shipping",
      effect,
      inputs:
        effect === "payment"
          ? [
              param("amount", ["amount"], { default: "0" }),
              param("currency", ["currency"], { default: "GBP" }),
            ]
          : [],
      request: { method: "POST", urlTemplate: `${O}/shipping` },
    };
    f.pay.inputs = [];
    f.flow.steps = [
      { operation: quote.id, bind: {} },
      { operation: mutation.id, bind: {} },
      { operation: f.pay.id, bind: {} },
    ];
    f.model.operations.push(mutation);
    const result = await f.run(async () =>
      Response.json({ items: [product({ price: effect === "payment" ? "0" : "20" })] }),
    );
    expect(result.status).toBe("refused");
    expect(result.error).toMatch(/needs one fresh basket total|product identity/);
  });

  it("refuses two distinct fresh total readings", async () => {
    const f = fixture();
    const a = total(f, "urn:totalA"),
      b = total(f, "urn:totalB");
    f.pay.inputs = [];
    const prepare = {
      ...f.pay,
      inputs: [],
      id: "urn:prepare",
      effect: "irreversible-write" as const,
    };
    f.model.operations.push(prepare);
    f.flow.steps = [
      { operation: prepare.id, bind: {} },
      { operation: a.id, bind: {} },
      { operation: b.id, bind: {} },
      { operation: f.pay.id, bind: {} },
    ];
    const result = await f.run(async (url) =>
      Response.json({ items: [product({ price: String(url).endsWith("totalA") ? "1" : "1000" })] }),
    );
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("conflicting"),
    });
  });

  it("requires a basket total for repeated irreversible quantity writes", async () => {
    const f = fixture();
    const add: Operation = {
      ...f.pay,
      id: "urn:add",
      effect: "irreversible-write",
      request: { ...f.pay.request, urlTemplate: `${O}/cart` },
    };
    f.model.operations.push(add);
    f.pay.inputs = [];
    f.flow.steps = [
      { operation: f.read.id, bind: {} },
      { operation: add.id, bind: { id: "104", qty: "1" } },
      { operation: add.id, bind: { id: "104", qty: "1" } },
      { operation: f.pay.id, bind: {} },
    ];
    const result = await f.run();
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("needs one fresh basket total"),
    });
  });

  it("accounts for an unidentified checkout quantity after an identified cart write", async () => {
    const f = fixture();
    const add: Operation = {
      ...f.pay,
      id: "urn:add",
      effect: "reversible-write",
      request: { ...f.pay.request, urlTemplate: `${O}/cart` },
    };
    f.model.operations.push(add);
    f.pay.inputs = [param("qty", ["orderQuantity"], { range: `${X}integer` })];
    f.flow.steps.splice(1, 0, { operation: add.id, bind: { id: "104", qty: "1" } });
    required(f.flow.steps[2]).bind = { qty: "1000" };
    const result = await f.run();
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("needs one fresh basket total"),
    });
  });
});

describe("review r2 evidence binding boundaries", () => {
  it("refuses a total bound to another item and uses the requested product price", async () => {
    const f = fixture();
    const quote = total(f);
    f.flow.steps.splice(1, 0, { operation: quote.id, bind: {} });
    const result = await f.run(async (url) =>
      Response.json({
        items: [
          product(
            String(url).endsWith("/total")
              ? { price: "1", productID: "999", orderQuantity: "1" }
              : {},
          ),
        ],
      }),
    );
    expect(result.outcome?.amount).toBe("20");
  });

  it("refuses a quantity-mismatched total when no product price can explain the payment", async () => {
    const f = fixture();
    const quote = total(f);
    f.flow.steps = [
      { operation: quote.id, bind: {} },
      { operation: f.pay.id, bind: { id: "104", qty: "1000" } },
    ];
    const result = await f.run(async () =>
      Response.json({ items: [product({ orderQuantity: "1" })] }),
    );
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("needs one unambiguous product price"),
    });
  });

  it("refuses two fresh totals for distinct baskets even with equal money", async () => {
    const f = fixture();
    const a = total(f, "urn:totalA"),
      b = total(f, "urn:totalB");
    f.pay.inputs = [param("order", ["referencesOrder"])];
    const prepare = {
      ...f.pay,
      inputs: [],
      id: "urn:prepare",
      effect: "irreversible-write" as const,
    };
    f.model.operations.push(prepare);
    f.flow.steps = [
      { operation: prepare.id, bind: {} },
      { operation: a.id, bind: {} },
      { operation: b.id, bind: {} },
      { operation: f.pay.id, bind: { order: `${O}/totalA` } },
    ];
    const result = await f.run(async (url) =>
      Response.json({
        items: [
          product({ url: String(url), orderQuantity: String(url).endsWith("A") ? "1" : "1000" }),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: "refused",
      error: expect.stringContaining("order identity"),
    });
  });

  it("revalidates every equivalent fresh total before consuming approval", async () => {
    const f = fixture();
    const a = total(f, "urn:totalA"),
      b = total(f, "urn:totalB");
    f.pay.inputs = [];
    const prepare = {
      ...f.pay,
      inputs: [],
      id: "urn:prepare",
      effect: "irreversible-write" as const,
    };
    f.model.operations.push(prepare);
    f.flow.steps = [
      { operation: prepare.id, bind: {} },
      { operation: a.id, bind: {} },
      { operation: b.id, bind: {} },
      { operation: f.pay.id, bind: {} },
    ];
    let changed = false;
    const fetch = f.transport();
    fetch.mockImplementation(async (url) =>
      Response.json({
        items: [product({ price: changed && String(url).endsWith("B") ? "1000" : "20" })],
      }),
    );
    const approvals = createApprovalGate();
    const gate = {
      authorize: (req: Parameters<typeof approvals.authorize>[0]) =>
        req.inputs.$step === "0"
          ? Promise.resolve({ kind: "allow" as const })
          : approvals.authorize(req),
    };
    const ex = createExecutor({ model: f.model, fetch, gate, sessions: new InMemorySessions() });
    const first = await ex.execute(f.buy());
    expect(first.status).toBe("needs-approval");
    approvals.approve(first.approval?.id ?? "");
    changed = true;
    const next = await ex.execute(f.buy(), { approvalId: first.approval?.id ?? "" });
    expect(next.status).toBe("refused");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("accepts exact WHATWG normalized IRIs and refuses untyped suffix fallback", async () => {
    for (const byIri of [false, true]) {
      const f = fixture();
      f.pay.inputs[0] = param("id", ["object"], { range: `${S}Product` });
      if (byIri) {
        f.flow.inputs = [param("id", ["object"], { range: `${S}Product` })];
        required(f.flow.steps[1]).bind.id = "$input.id";
      }
      const result = await createExecutor({
        model: f.model,
        fetch: f.transport(),
        sessions: new InMemorySessions(),
      }).execute(
        byIri
          ? actionRequest(
              `[] a schema:BuyAction; schema:object <https://SHOP.test:443/product/104>.`,
            )
          : f.buy(),
      );
      expect(byIri ? result.approval?.amount : result.status).toBe(byIri ? "20" : "refused");
    }
  });
});

describe("review r2 execution regressions", () => {
  it.each([
    "json",
    "body",
    "redirect",
    "cookies",
    "later",
  ])("retains a committed write before %s processing fails", async (failure) => {
    const f = fixture();
    f.pay.inputs = [param("id", ["object", "productID"], { default: "104" })];
    f.pay.extraction = { format: "json", itemType: `${S}Order`, fields: [] };
    if (failure === "later") f.flow.steps.push({ operation: f.read.id, bind: {} });
    let reads = 0;
    const ex = createExecutor({
      model: f.model,
      sessions: {
        get: async () => undefined,
        update: async () => {
          throw new Error("store failure");
        },
      },
      gate: { authorize: async () => ({ kind: "allow" }) },
      maxResponseBytes: failure === "body" ? 200 : 50000,
      fetch: async (_url, init) => {
        if (init?.method === "GET")
          return ++reads > 1
            ? new Response(null, { status: 500 })
            : Response.json({ items: [product()] });
        if (failure === "redirect")
          return new Response(null, {
            status: 303,
            headers: { location: "https://attacker.test/" },
          });
        if (failure === "cookies")
          return new Response("{}", { headers: { "set-cookie": "sid=changed; Path=/" } });
        return new Response(
          failure === "body" ? "x".repeat(500) : failure === "json" ? "malformed" : "{}",
        );
      },
    });
    const result = await ex.execute(f.buy());
    expect(result.status).toBe("error");
    expect(result).toMatchObject({
      committed: [
        { target: { id: f.pay.id }, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      ],
      outcome: { status: "uncertain" },
    });
    expect(result.observations[0]?.turtle).toContain("sab:Uncertain");
  });

  it("canonicalizes write fingerprints across typed lexicals, unused inputs, URLs and JSON order", () => {
    const f = fixture();
    f.model.flows = [];
    f.pay.effect = "irreversible-write";
    f.pay.inputs = [
      param("qty", ["orderQuantity"], { range: `${X}integer` }),
      param("unused", ["name"], { required: false }),
    ];
    f.pay.request.urlTemplate = "https://SHOP.test:443/checkout?b=2&a=1";
    f.pay.request.bodyTemplate = '{"z":true,"qty":{qty}}';
    const ex = createExecutor({ model: f.model, sessions: new InMemorySessions() });
    const one = ex.planToRequests(actionRequest("[] a schema:PayAction; schema:orderQuantity 1."));
    const two = ex.planToRequests(
      actionRequest(
        '[] a schema:PayAction; schema:orderQuantity "+01"^^xsd:integer; schema:name "ignored".',
      ),
    );
    f.pay.request.urlTemplate = `${O}/checkout?a=1&b=2`;
    f.pay.request.bodyTemplate = '{"qty":{qty},"z":true}';
    const three = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
    }).planToRequests(actionRequest("[] a schema:PayAction; schema:orderQuantity 1."));
    const fp = (p: typeof one) => p.requests[0]?.fingerprint;
    expect(fp(one)).toMatch(/^[a-f0-9]{64}$/);
    expect(fp(two)).toBe(fp(one));
    expect(fp(three)).toBe(fp(one));
  });

  it.each(
    ["form", "query", "path", "header"].flatMap((surface) => [
      { surface, type: "integer", lexical: "+01", canonical: "1" },
      { surface, type: "decimal", lexical: "+01.000", canonical: "1.0" },
      { surface, type: "boolean", lexical: "1", canonical: "true" },
      { surface, type: "double", lexical: "001.0", canonical: "1.0E0" },
    ]),
  )("canonicalizes typed $type on the $surface wire surface", ({
    surface,
    type,
    lexical,
    canonical,
  }) => {
    const f = fixture();
    f.model.flows = [];
    f.pay.effect = "irreversible-write";
    f.pay.inputs = [
      param("qty", ["orderQuantity"], {
        range: X + type,
        location: surface as Parameter["location"],
      }),
    ];
    f.pay.request = {
      method: "POST",
      urlTemplate: `${O}/checkout${surface === "path" ? "/{qty}" : ""}`,
      contentType: surface === "form" ? "application/x-www-form-urlencoded" : undefined,
    };
    const plan = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
    }).planToRequests(
      actionRequest(
        `[] a schema:PayAction; schema:orderQuantity ${JSON.stringify(lexical)}^^xsd:${type}.`,
      ),
    );
    expect(plan.status).toBe("planned");
    const wire = required(plan.requests[0]);
    expect(wire.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    if (surface === "form") expect(wire.body).toBe(`qty=${canonical}`);
    if (surface === "query") expect(new URL(wire.url).searchParams.get("qty")).toBe(canonical);
    if (surface === "path") expect(new URL(wire.url).pathname).toBe(`/checkout/${canonical}`);
    if (surface === "header") expect(wire.headers.qty).toBe(canonical);
  });

  it("redacts complete display names before normalization and truncation", async () => {
    const f = fixture();
    const secret = "SECRET-\tTOKEN-ABCDEFGHIJKL";
    const sessions = new InMemorySessions();
    sessions.set(O, undefined, {
      cookies: [{ name: "sid", value: secret, domain: "shop.test", path: "/" }],
    });
    const req = actionRequest(
      `[] a schema:BuyAction; schema:object [schema:name ${JSON.stringify("x".repeat(68) + secret)}].`,
    );
    const result = await createExecutor({ model: f.model, sessions, fetch: f.transport() }).execute(
      req,
    );
    expect(result.status).toBe("needs-approval");
    expect(result.approval?.summary).not.toContain("SECRET");
    expect(result.approval?.summary).toContain("[redacted]");
  });

  it("redacts complete model labels and monetary lexicals before display formatting", () => {
    const f = fixture();
    const secret = "SECRET-TOKEN-ABCDEFGHIJKL";
    const summary = summarise(
      f.buy(),
      {
        kind: "flow",
        id: f.flow.id,
        label: "x".repeat(68) + secret,
        actionType: f.flow.actionType,
      },
      O,
      { amount: "00020.00", currency: "GBP" },
      secretRedactor(new Set([secret, "00020.00", "GBP"])),
    );
    expect(summary).not.toContain("SECRET");
    expect(summary).not.toContain("20.00");
    expect(summary).not.toContain("GBP");
    expect(summary).toContain("[redacted]");
  });

  it("passes the original session revision unchanged to every cookie update", async () => {
    const f = fixture();
    const update = vi.fn(
      async (_site: string, _persona: string | undefined, _bundle: SessionBundle) => {},
    );
    const bundle: SessionBundle = { cookies: [], revision: "vault-version-7" };
    await createExecutor({
      model: f.model,
      sessions: { get: async () => bundle, update },
      gate: { authorize: async () => ({ kind: "allow" }) },
      fetch: async () =>
        Response.json({ items: [product()] }, { headers: { "set-cookie": "sid=changed; Path=/" } }),
    }).execute(f.buy());
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.every((call) => call[2].revision === "vault-version-7")).toBe(true);
  });

  it("retains all cookie updates when an execution starts without a session bundle", async () => {
    const f = fixture();
    const sessions = new InMemorySessions();
    const ex = createExecutor({
      model: f.model,
      sessions,
      gate: { authorize: async () => ({ kind: "allow" }) },
      fetch: async (_url, init) =>
        Response.json(
          { items: [product()] },
          {
            headers: {
              "set-cookie": init?.method === "GET" ? "csrf=before; Path=/" : "sid=after; Path=/",
            },
          },
        ),
    });
    expect((await ex.execute(f.buy())).status).toBe("done");
    const bundle = await sessions.get(O);
    expect(bundle?.cookies.map((c) => c.name)).toEqual(["csrf", "sid"]);
    expect(bundle?.revision).toEqual(expect.any(String));
  });

  it("InMemorySessions issues revisions and silently rejects a stale session update", async () => {
    const sessions = new InMemorySessions();
    sessions.set(O, undefined, { cookies: [], headers: { authorization: "old" } });
    const stale = await sessions.get(O);
    expect(stale).toHaveProperty("revision", expect.any(String));
    sessions.set(O, undefined, { cookies: [], headers: { authorization: "new" } });
    await sessions.update(O, undefined, required(stale));
    expect((await sessions.get(O))?.headers?.authorization).toBe("new");
  });

  it("reports required missing input names for the closest IRI-only Buy candidate", async () => {
    const f = fixture();
    f.flow.inputs = [
      param("query", ["object", "name"]),
      param("qty", ["orderQuantity"], { default: "1" }),
    ];
    const ex = createExecutor({ model: f.model, sessions: new InMemorySessions() });
    const req = actionRequest(`[] a schema:BuyAction; schema:object <${O}/product/104>.`);
    expect(await ex.execute(req)).toMatchObject({
      status: "no-path",
      missing: ["query"],
      committed: [],
    });
    expect(ex.planToRequests(req)).toMatchObject({ status: "no-path", missing: ["query"] });
  });
});
