// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { Parser, Store } from "n3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor, planToRequests } from "../src/executor.js";
import { createApprovalGate, type Gate } from "../src/gate.js";
import {
  CSRF,
  INJECTION,
  type Shop,
  SID,
  SIGNED_IN,
  shopModel,
  startShop,
} from "./fixture-shop.js";
import { actionRequest } from "./helpers.js";

const S = "https://schema.org/";
const SAB = "https://jeswr.org/ns/site-action#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

let shop: Shop;
let sessions: InMemorySessions;

beforeEach(async () => {
  shop = await startShop();
  sessions = new InMemorySessions();
  sessions.set(shop.url, undefined, SIGNED_IN("127.0.0.1"));
});

afterEach(async () => {
  await shop.close();
});

function noSecrets(value: unknown, allowCookieWord = false): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SID);
  expect(text).not.toContain(CSRF);
  if (!allowCookieWord) expect(text.toLowerCase()).not.toContain("cookie");
}

describe("reads", () => {
  it("searches without approval and lifts JSON into RDF with untrusted text marked", async () => {
    const executor = createExecutor({ model: shopModel(shop.url), sessions });
    const result = await executor.execute(
      actionRequest(`[] a schema:SearchAction ; schema:query "sneakers" .`),
    );
    expect(result.status).toBe("done");
    expect(result.outcome).toBeUndefined();
    expect(result.requests).toBe(1);
    expect(result.target?.id).toBe("urn:op:search");
    const obs = result.observations[0];
    expect(obs?.itemCount).toBe(2);
    expect(obs?.status).toBe(200);
    const store = new Store(new Parser().parse(obs?.turtle ?? ""));
    const product = `${shop.url}/product/7`;
    expect(store.getQuads(product, `${S}sku`, null, null)[0]?.object.value).toBe("TR-20");
    expect(store.getQuads(product, `${S}price`, null, null)[0]?.object).toMatchObject({
      value: "20",
      datatype: { value: "http://www.w3.org/2001/XMLSchema#decimal" },
    });
    // The prompt-injection description is never a plain literal on the product.
    const desc = store.getQuads(product, `${S}description`, null, null)[0]?.object;
    expect(desc?.termType).toBe("BlankNode");
    expect(store.getQuads(desc ?? null, `${RDF}type`, `${SAB}UntrustedText`, null)).toHaveLength(1);
    expect(store.getQuads(desc ?? null, `${RDF}value`, null, null)[0]?.object.value).toBe(
      INJECTION,
    );
    expect(obs?.turtle).toContain("@prefix schema: <https://schema.org/>");
    const sent = shop.requests[0];
    expect(sent?.url).toBe("/api/search?q=sneakers&page=1");
    expect(sent?.headers["x-requested-with"]).toBe("fetch");
    expect(sent?.headers.accept).toBe("application/json");
    noSecrets(result);
  });

  it("views a product by IRI (id from the last path segment) and extracts HTML", async () => {
    const executor = createExecutor({ model: shopModel(shop.url), sessions });
    const result = await executor.execute(
      actionRequest(
        `[] a <http://schema.org/ViewAction> ; schema:object <${shop.url}/product/7> .`,
      ),
    );
    expect(result.status).toBe("done");
    expect(shop.requests[0]?.url).toBe("/product/7");
    const store = new Store(new Parser().parse(result.observations[0]?.turtle ?? ""));
    const product = `${shop.url}/product/7`;
    expect(store.getQuads(product, `${S}name`, null, null)[0]?.object.value).toBe(
      "Trail Runner sneakers",
    );
    const reviews = store.getQuads(product, `${S}review`, null, null);
    expect(reviews).toHaveLength(3);
    const texts = reviews.map(
      (q) => store.getQuads(q.object, `${RDF}value`, null, null)[0]?.object.value,
    );
    expect(texts).toEqual(["Great & comfy.", INJECTION, "Runs small."]);
    for (const q of reviews)
      expect(store.getQuads(q.object, `${RDF}type`, `${SAB}UntrustedText`, null)).toHaveLength(1);
    // Set-Cookie from the page is stored back through the session provider.
    const bundle = await sessions.get(shop.url);
    expect(bundle?.cookies.find((c) => c.name === "seen")?.value).toBe("product-7-seen");
    expect(bundle?.cookies.find((c) => c.name === "sid")?.value).toBe(SID);
  });
});

describe("approval gate", () => {
  const addToCart = (qty = 1) =>
    actionRequest(
      `[] a schema:AddToCartAction ; schema:orderQuantity ${qty} ; schema:object [ a schema:Product ; schema:sku "TR-20" ; schema:name "Trail Runner sneakers" ; schema:offers [ schema:price "20.00" ; schema:priceCurrency "GBP" ] ] .`,
    );

  it("asks before a write, sends nothing, then proceeds once approved", async () => {
    const gate = createApprovalGate();
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate });
    const first = await executor.execute(addToCart());
    expect(first.status).toBe("needs-approval");
    expect(first.outcome).toBeUndefined();
    expect(first.requests).toBe(0);
    expect(shop.requests).toHaveLength(0);
    const approval = first.approval;
    expect(approval?.summary).toBe(
      `Add to cart "Trail Runner sneakers" ("sku"="TR-20") on 127.0.0.1:${new URL(shop.url).port}`,
    );
    expect(approval?.effect).toBe("reversible-write");
    expect(approval?.amount).toBeUndefined();
    expect(approval?.currency).toBeUndefined();
    expect(approval?.inputs).toEqual({ sku: "TR-20", qty: "1" });
    noSecrets(first);

    // Retrying before the user answers still asks, with the same approval.
    const again = await executor.execute(addToCart(), { approvalId: approval?.id as string });
    expect(again.status).toBe("needs-approval");
    expect(again.approval?.id).toBe(approval?.id);

    expect(gate.approve(approval?.id as string)).toBe(true);
    const done = await executor.execute(addToCart(), { approvalId: approval?.id as string });
    expect(done.status).toBe("done");
    expect(shop.state.carts.get(SID)).toEqual([{ sku: "TR-20", qty: 1 }]);
    const sent = shop.requests.find((r) => r.method === "POST");
    expect(sent?.headers["x-csrf-token"]).toBe(CSRF);
    expect(JSON.parse(sent?.body ?? "")).toEqual({ sku: "TR-20", qty: 1 });
    noSecrets(done);
  });

  it("binds the approval to the exact inputs: a changed quantity needs a new approval", async () => {
    const gate = createApprovalGate();
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate });
    const first = await executor.execute(addToCart(1));
    gate.approve(first.approval?.id as string);
    const changed = await executor.execute(addToCart(10), {
      approvalId: first.approval?.id as string,
    });
    expect(changed.status).toBe("needs-approval");
    expect(changed.approval?.id).not.toBe(first.approval?.id);
    expect(changed.approval?.inputs.qty).toBe("10");
    expect(shop.requests).toHaveLength(0);
  });

  it("makes approvals single-use", async () => {
    const gate = createApprovalGate();
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate });
    const first = await executor.execute(addToCart());
    gate.approve(first.approval?.id as string);
    expect(
      (await executor.execute(addToCart(), { approvalId: first.approval?.id as string })).status,
    ).toBe("done");
    const replay = await executor.execute(addToCart(), {
      approvalId: first.approval?.id as string,
    });
    expect(replay.status).toBe("needs-approval");
    expect(shop.state.carts.get(SID)).toHaveLength(1);
  });

  it("lets only one of two concurrent retries use an approval", async () => {
    const gate = createApprovalGate();
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate });
    const first = await executor.execute(addToCart());
    gate.approve(first.approval?.id as string);
    const id = first.approval?.id as string;
    const [a, b] = await Promise.all([
      executor.execute(addToCart(), { approvalId: id }),
      executor.execute(addToCart(), { approvalId: id }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["done", "needs-approval"]);
    expect(shop.state.carts.get(SID)).toHaveLength(1);
  });

  it("refuses an approval id the executor never issued, even if a gate would allow it", async () => {
    const lax: Gate = {
      authorize: async (req) =>
        req.approvalId === "forged" || req.effect === "read"
          ? { kind: "allow" }
          : {
              kind: "ask",
              approval: {
                id: "a1",
                summary: req.summary,
                effect: req.effect,
                site: req.site,
                target: req.target,
                inputs: req.inputs,
                digest: req.digest,
              },
            },
    };
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate: lax });
    const result = await executor.execute(addToCart(), { approvalId: "forged" });
    expect(result.status).toBe("needs-approval");
    expect(shop.requests).toHaveLength(0);
  });

  it("overrides binding fields a gate misstates in its approval", async () => {
    const sloppy: Gate = {
      authorize: async (req) => ({
        kind: "ask",
        approval: {
          id: "x1",
          summary: req.summary,
          effect: "read",
          site: "https://evil.test",
          target: req.target,
          inputs: {},
          digest: "nope",
        },
      }),
    };
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate: sloppy });
    const result = await executor.execute(addToCart());
    expect(result.approval).toMatchObject({
      id: "x1",
      effect: "reversible-write",
      site: shop.url,
      inputs: { sku: "TR-20", qty: "1" },
    });
    expect(result.approval?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a gate that reuses an approval id for a different request", async () => {
    const reuse: Gate = {
      authorize: async (req) => ({
        kind: "ask",
        approval: {
          id: "same",
          summary: "",
          effect: req.effect,
          site: req.site,
          target: req.target,
          inputs: req.inputs,
          digest: req.digest,
        },
      }),
    };
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate: reuse });
    expect((await executor.execute(addToCart(1))).status).toBe("needs-approval");
    const second = await executor.execute(addToCart(2));
    expect(second.status).toBe("error");
    expect(second.errorKind).toBe("gate");
  });

  it("reports a denial and a failing gate without sending", async () => {
    const deny = createExecutor({
      model: shopModel(shop.url),
      sessions,
      gate: { authorize: async () => ({ kind: "deny", reason: "Spending limit reached" }) },
    });
    expect(await deny.execute(addToCart())).toMatchObject({
      status: "denied",
      error: "Spending limit reached",
      requests: 0,
    });
    const broken = createExecutor({
      model: shopModel(shop.url),
      sessions,
      gate: {
        authorize: async () => {
          throw new Error(`gate exploded with ${SID}`);
        },
      },
    });
    const r = await broken.execute(addToCart());
    expect(r).toMatchObject({ status: "error", errorKind: "gate" });
    noSecrets(r);
    expect(shop.requests).toHaveLength(0);
  });

  it("a user rejection denies the retry", async () => {
    const gate = createApprovalGate();
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate });
    const first = await executor.execute(addToCart());
    expect(gate.pending()).toHaveLength(1);
    gate.reject(first.approval?.id as string, "Not today");
    const r = await executor.execute(addToCart(), { approvalId: first.approval?.id as string });
    expect(r).toMatchObject({ status: "denied", error: "Not today" });
  });

  it("an allow-everything gate (standing spending limit) runs writes directly", async () => {
    const executor = createExecutor({
      model: shopModel(shop.url),
      sessions,
      gate: { authorize: async () => ({ kind: "allow" }) },
    });
    expect((await executor.execute(addToCart())).status).toBe("done");
  });

  it("does not consume an approval when the user is not signed in", async () => {
    const gate = createApprovalGate();
    const empty = new InMemorySessions();
    const executor = createExecutor({ model: shopModel(shop.url), sessions: empty, gate });
    const r = await executor.execute(addToCart());
    expect(r).toMatchObject({ status: "error", errorKind: "no-session" });
    expect(r.error).toContain("not signed in");
    expect(gate.pending()).toHaveLength(0);
    expect(shop.requests).toHaveLength(0);
  });

  it("passes the persona to the session provider and into the digest", async () => {
    const gate = createApprovalGate();
    const persona = new InMemorySessions();
    persona.set(shop.url, "work", SIGNED_IN("127.0.0.1"));
    const work = createExecutor({
      model: shopModel(shop.url),
      sessions: persona,
      gate,
      persona: "work",
    });
    const home = createExecutor({ model: shopModel(shop.url), sessions, gate });
    const a = await work.execute(addToCart());
    const b = await home.execute(addToCart());
    expect(a.status).toBe("needs-approval");
    expect(a.approval?.digest).not.toBe(b.approval?.digest);
  });
});

describe("CSRF sources", () => {
  const allow: Gate = { authorize: async () => ({ kind: "allow" }) };

  it("json pointer source -> header", async () => {
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate: allow });
    const r = await executor.execute(
      actionRequest(`[] a schema:LikeAction ; schema:object [ schema:sku "HB-12" ] .`),
    );
    expect(r.status).toBe("done");
    expect(r.requests).toBe(2);
    expect(shop.state.wishlist).toEqual(["HB-12"]);
    expect(shop.requests[0]?.url).toBe("/api/csrf");
    expect(shop.requests[0]?.headers.cookie).toContain(`sid=${SID}`);
    noSecrets(r);
  });

  it("meta source (page URL expanded from the inputs) -> query parameter", async () => {
    const executor = createExecutor({ model: shopModel(shop.url), sessions, gate: allow });
    const r = await executor.execute(
      actionRequest(
        `[] a schema:ReviewAction ; schema:object <${shop.url}/product/8> ; schema:resultReview [ schema:reviewBody "Fits well & looks good" ] .`,
      ),
    );
    expect(r.status).toBe("done");
    expect(shop.requests[0]?.url).toBe("/product/8");
    expect(shop.requests[1]?.url).toBe(`/api/reviews?_csrf=${CSRF}`);
    expect(shop.state.reviews).toEqual([{ id: "8", body: "Fits well & looks good" }]);
    noSecrets(r);
  });

  it("cookie source missing -> csrf error before the write is sent", async () => {
    const s = new InMemorySessions();
    s.set(shop.url, undefined, {
      cookies: [{ name: "sid", value: SID, domain: "127.0.0.1", path: "/" }],
    });
    const executor = createExecutor({ model: shopModel(shop.url), sessions: s, gate: allow });
    const r = await executor.execute(
      actionRequest(`[] a schema:AddToCartAction ; schema:object [ schema:sku "TR-20" ] .`),
    );
    expect(r).toMatchObject({ status: "error", errorKind: "csrf", requests: 0 });
    expect(shop.requests).toHaveLength(0);
  });

  it("html source not found -> csrf error", async () => {
    const model = shopModel(shop.url);
    const checkout = model.operations.find((o) => o.id === "urn:op:checkout");
    if (checkout) checkout.effect = "irreversible-write";
    model.flows = [];
    if (checkout?.csrf?.[0])
      checkout.csrf[0].source = {
        kind: "html",
        urlTemplate: `${shop.url}/checkout`,
        selector: "input[name=nope]",
        attribute: "value",
      };
    const executor = createExecutor({ model, sessions, gate: allow });
    const r = await executor.execute(
      actionRequest(
        `[] a schema:PayAction; schema:amount [ schema:value 20; schema:currency "GBP" ] .`,
      ),
    );
    expect(r).toMatchObject({ status: "error", errorKind: "csrf" });
    expect(shop.state.orders).toHaveLength(0);
  });
});

describe("flows", () => {
  const buy = (name = "Trail Runner sneakers", delivery = "express") =>
    actionRequest(
      `[] a schema:BuyAction ; schema:deliveryMethod "${delivery}" ; schema:object [ a schema:Product ; schema:name "${name}" ; schema:offers [ schema:price 20 ; schema:priceCurrency "gbp" ] ] .`,
    );

  it("prefers the flow, gates each write by its effect and binds $step0 values into later steps", async () => {
    const gate = createApprovalGate();
    const executor = createExecutor({
      model: shopModel(shop.url),
      sessions,
      gate,
      writeResponses: { "urn:op:checkout": { createdLocationPattern: "/orders/{id}" } },
    });
    const ask = await executor.execute(buy());
    expect(ask.status).toBe("needs-approval");
    expect(ask.target).toMatchObject({ kind: "flow", id: "urn:flow:buy" });
    expect(ask.approval?.effect).toBe("reversible-write");
    expect(ask.approval?.summary).toMatch(
      /^Buy "Trail Runner sneakers" \("sku"="TR-20"\) for GBP 20.00 on 127\.0\.0\.1:\d+$/,
    );
    gate.approve(ask.approval?.id as string);
    const checkout = await executor.execute(buy(), { approvalId: ask.approval?.id as string });
    expect(checkout.status, checkout.error).toBe("needs-approval");
    expect(checkout.approval).toMatchObject({ effect: "payment", amount: "20", currency: "GBP" });
    gate.approve(checkout.approval?.id as string);
    const r = await executor.execute(buy(), { approvalId: checkout.approval?.id as string });
    expect(r.status).toBe("done");
    expect(r.observations.map((o) => o.operation)).toEqual([
      "urn:flow:buy",
      "urn:op:search",
      "urn:op:add-to-cart",
      "urn:op:total",
      "urn:op:checkout",
    ]);
    expect(shop.state.orders).toEqual([
      { id: 1000, sid: SID, delivery: "express", items: [{ sku: "TR-20", qty: 1 }] },
    ]);
    // CSRF is inserted before each payment approval check, including its retry.
    expect(r.requests).toBe(9);
    expect(shop.requests.map((q) => `${q.method} ${q.url}`)).toEqual([
      "GET /api/search?q=Trail%20Runner%20sneakers&page=1",
      "GET /api/search?q=Trail%20Runner%20sneakers&page=1",
      "POST /api/cart/items",
      "GET /api/total?delivery=express&amount=20.0&currency=GBP",
      "GET /checkout",
      "GET /api/total?delivery=express&amount=20.0&currency=GBP",
      "GET /checkout",
      "POST /checkout",
      "GET /orders/1000",
    ]);
    expect(shop.requests[8]?.body).toBe("");
    expect(shop.requests[7]?.body).toBe(
      `delivery=express&amount=20.0&currency=GBP&csrf_token=${CSRF}`,
    );
    expect(r.outcome).toEqual({
      status: "completed",
      target: "Buy a product",
      effect: "payment",
      amount: "20",
      currency: "GBP",
      result: `${shop.url}/orders/1000`,
    });
    const receipt = new Store(new Parser().parse(r.observations[0]?.turtle ?? ""));
    expect(receipt.getQuads(null, `${RDF}type`, `${SAB}ActionOutcome`, null)).toHaveLength(1);
    expect(receipt.getQuads(null, `${SAB}status`, `${SAB}Completed`, null)).toHaveLength(1);
    expect(receipt.getQuads(null, `${S}result`, `${shop.url}/orders/1000`, null)).toHaveLength(1);
    expect(
      receipt.getQuads(`${shop.url}/orders/1000`, `${S}orderNumber`, null, null)[0]?.object.value,
    ).toBe("1000");
    const order = new Store(new Parser().parse(r.observations.at(-1)?.turtle ?? ""));
    expect(order.getQuads(null, `${S}orderNumber`, null, null)[0]?.object.value).toBe("1000");
    noSecrets(r);
  });

  it("stops at the first failing step with a clear error", async () => {
    const executor = createExecutor({
      model: shopModel(shop.url),
      sessions,
      gate: { authorize: async () => ({ kind: "allow" }) },
    });
    const r = await executor.execute(buy("Nonexistent"));
    expect(r.status).toBe("error");
    expect(r.errorKind).toBe("binding");
    expect(r.error).toContain("step 1 (Add to cart) failed");
    expect(r.observations).toHaveLength(2);
    expect(r.outcome).toMatchObject({ status: "failed", effect: "payment" });
    expect(shop.requests).toHaveLength(1);
  });

  it("rejects an option value outside the parameter's options", async () => {
    const executor = createExecutor({
      model: shopModel(shop.url),
      sessions,
      gate: { authorize: async () => ({ kind: "allow" }) },
    });
    const r = await executor.execute(buy("Trail", "drone"));
    expect(r.status).toBe("error");
    expect(r.requests).toBe(0);
    expect(r.error).toContain("allowed options");
    expect(shop.state.orders).toHaveLength(0);
  });

  it("gates on the strongest step effect when a flow under-declares", async () => {
    const model = shopModel(shop.url);
    (model.flows[0] as { effect: string }).effect = "read";
    const gate = createApprovalGate();
    const executor = createExecutor({
      model,
      sessions,
      gate,
      writeResponses: { "urn:op:checkout": { createdLocationPattern: "/orders/{id}" } },
    });
    const first = await executor.execute(buy());
    expect(first.approval?.effect).toBe("reversible-write");
    gate.approve(first.approval?.id ?? "");
    const r = await executor.execute(buy(), { approvalId: first.approval?.id });
    expect(r.status, r.error).toBe("needs-approval");
    expect(r.approval?.effect).toBe("payment");
  });

  it("treats an unknown effect class as payment", async () => {
    const model = shopModel(shop.url);
    (model.operations[0] as { effect: string }).effect = "harmless-promise";
    const executor = createExecutor({ model, sessions });
    const r = await executor.execute(
      actionRequest(`[] a schema:SearchAction ; schema:query "x" .`),
    );
    expect(r.status).toBe("refused");
    expect(r.errorKind).toBe("binding");
    expect(r.requests).toBe(0);
  });

  it("refuses forward step references and unknown step operations", async () => {
    const allow: Gate = { authorize: async () => ({ kind: "allow" }) };
    const model = shopModel(shop.url);
    const flow = model.flows[0];
    if (flow?.steps[1]) flow.steps[1].bind.sku = `$step1.${S}sku`;
    expect(() => createExecutor({ model, sessions, gate: allow })).toThrow("has not run yet");
    const model2 = shopModel(shop.url);
    if (model2.flows[0]?.steps[0]) model2.flows[0].steps[0].operation = "urn:op:missing";
    expect(() => createExecutor({ model: model2, sessions, gate: allow })).toThrow(
      "unknown operation",
    );
  });
});

describe("matching", () => {
  it("no-path and ambiguous", async () => {
    const executor = createExecutor({ model: shopModel(shop.url), sessions });
    expect((await executor.execute(actionRequest(`[] a schema:DonateAction .`))).status).toBe(
      "no-path",
    );
    const model = shopModel(shop.url);
    const search = model.operations[0];
    if (search)
      model.operations.push({ ...search, id: "urn:op:search2", label: "Search everything" });
    const r = await createExecutor({ model, sessions }).execute(
      actionRequest(`[] a schema:SearchAction ; schema:query "x" .`),
    );
    expect(r).toMatchObject({
      status: "ambiguous",
      candidates: ["Search products", "Search everything"],
    });
  });
});

describe("dry run", () => {
  it("plans a flow without sending, with placeholders and no credentials", () => {
    const plan = planToRequests(
      shopModel("https://shop.test"),
      actionRequest(`[] a schema:BuyAction ; schema:object [ schema:name "Trail Runner" ] .`),
    );
    expect(plan.status).toBe("planned");
    expect(plan.effect).toBe("payment");
    expect(plan.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://shop.test/api/search?q=Trail%20Runner&page=1",
      "POST https://shop.test/api/cart/items",
      "GET https://shop.test/api/total?delivery=standard&amount=%24step0.https%3A%2F%2Fschema.org%2Fprice&currency=%24step0.https%3A%2F%2Fschema.org%2FpriceCurrency",
      "POST https://shop.test/checkout",
    ]);
    expect(plan.requests[1]?.body).toBe(`{"sku":"$step0.${S}sku","qty":1}`);
    expect(plan.requests[1]?.session).toBe(true);
    expect(plan.requests[1]?.csrf).toEqual(["header X-CSRF-Token <- cookie csrf"]);
    expect(plan.requests[3]?.body).toBe(
      `delivery=standard&amount=%24step0.https%3A%2F%2Fschema.org%2Fprice&currency=%24step0.https%3A%2F%2Fschema.org%2FpriceCurrency`,
    );
    noSecrets(plan, true);
  });

  it("reports no-path, ambiguous and errors", () => {
    const model = shopModel("https://shop.test");
    expect(planToRequests(model, actionRequest(`[] a schema:DonateAction .`)).status).toBe(
      "no-path",
    );
    const search = model.operations[0];
    if (search) {
      model.operations.push({ ...search, id: "urn:op:s2", label: "S2" });
    }
    expect(
      planToRequests(model, actionRequest(`[] a schema:SearchAction ; schema:query "x" .`)).status,
    ).toBe("ambiguous");
    const bad = shopModel("https://shop.test");
    if (bad.operations[0]) bad.operations[0].request.urlTemplate = "https://evil.test/{q}";
    const plan = planToRequests(
      bad,
      actionRequest(`[] a schema:SearchAction ; schema:query "x" .`),
    );
    expect(plan.status).toBe("error");
    expect(plan.error).toContain("not on the site origin");
  });
});
