// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// End to end: profile the fictional test shop with a login and one demonstration (search, view a
// product, add it to the basket, check out) and check the learned model and the learning rule.

import type { Flow, Operation, SiteModel } from "@jeswr/site-model";
import { type RunningShop, startShop } from "@jeswr/test-shop";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchChromium, profileSite } from "../src/profile.js";
import type { Demonstration, ProfileResult } from "../src/types.js";
import { s, sab } from "../src/util.js";

let shop: RunningShop;
let browser: Browser;
let result: ProfileResult;
let model: SiteModel;
let demoWindow: { from: string; to: string };

function demonstration(): Demonstration {
  return {
    name: "buy-product",
    description: "Search for a product, open it, add it to the basket and check out.",
    async run(page) {
      const before = new Date().toISOString();
      await page.goto(`${shop.url}/`);
      await page.fill("#q", "trail");
      await Promise.all([page.waitForURL(/\/search\?/), page.press("#q", "Enter")]);
      await Promise.all([
        page.waitForURL(/\/product\/104$/),
        page.click("text=Trail Runner sneakers"),
      ]);
      await page.waitForFunction(
        () => (document.querySelector("#stock")?.textContent ?? "") !== "",
      );
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().endsWith("/api/cart/items") && r.request().method() === "POST",
        ),
        page.click("#add-to-cart"),
      ]);
      await page.goto(`${shop.url}/checkout`);
      await page.selectOption("#delivery", "express");
      await page.waitForFunction(
        () => document.querySelector(".total")?.textContent === "Total GBP 24.99",
      );
      await Promise.all([page.waitForURL(/\/orders\/\d+$/), page.click("#place-order")]);
      demoWindow = { from: before, to: new Date().toISOString() };
    },
  };
}

const op = (actionType: string, pred: (o: Operation) => boolean = () => true) =>
  model.operations.find((o) => o.actionType === s(actionType) && pred(o));

beforeAll(async () => {
  shop = await startShop();
  browser = await launchChromium();
  result = await profileSite({
    startUrl: shop.url,
    login: { username: "alex@example.test", password: "correct-horse" },
    demonstrations: [demonstration()],
    browser,
    now: () => new Date("2026-11-13T10:00:00Z"),
  });
  model = result.model;
  if (process.env.SAB_DUMP)
    console.log(JSON.stringify({ model, warnings: result.warnings }, null, 1));
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await shop?.close();
});

describe("profiling the test shop", () => {
  it("names the model after the site", () => {
    expect(model.site).toBe(shop.url);
    expect(model.id).toBe(`urn:sab:model:${new URL(shop.url).host}`);
    expect(model.generatedAt).toBe("2026-11-13T10:00:00.000Z");
  });

  it("learns search operations over HTML and the JSON API, verified by replay", () => {
    const html = op("SearchAction", (o) => o.request.urlTemplate.startsWith(`${shop.url}/search`));
    // The crawl's sample search has one page of results, so page is only known from the bundle.
    expect(html?.request.urlTemplate).toMatch(/\/search\{\?q(,page)?\}$/);
    expect(html?.inputs.find((p) => p.name === "q")).toMatchObject({
      path: [s("query")],
      required: true,
    });
    expect(html?.extraction).toMatchObject({
      format: "html",
      itemPath: "ul#results > li.product-card",
      itemType: s("Product"),
    });
    expect(html?.session).toBe("none");
    expect(html?.provenance).toMatchObject({
      attempts: 1,
      successes: 1,
      lastVerified: "2026-11-13T10:00:00.000Z",
    });
    const api = op("SearchAction", (o) => o.request.urlTemplate.includes("/api/search"));
    expect(api?.request.urlTemplate).toBe(`${shop.url}/api/search{?q,page}`);
    expect(api?.provenance.method).toBe("js-analysis");
    expect(api?.extraction).toMatchObject({ format: "json", itemPath: "/items" });
  });

  it("learns view operations with path variables", () => {
    const page = op("ViewAction", (o) => o.request.urlTemplate === `${shop.url}/product/{id}`);
    expect(page?.inputs).toEqual([
      expect.objectContaining({
        name: "id",
        location: "path",
        path: [s("object")],
        range: s("Product"),
        required: true,
      }),
    ]);
    const api = op("ViewAction", (o) => o.request.urlTemplate === `${shop.url}/api/products/{id}`);
    const untrusted = api?.extraction?.fields.filter((f) => f.untrusted).map((f) => f.property);
    expect(untrusted).toContain(s("review"));
    expect(untrusted).toContain(s("description"));
    const orders = op("ViewAction", (o) => o.request.urlTemplate === `${shop.url}/orders/{id}`);
    expect(orders?.session).toBe("signed-in");
  });

  it("learns add-to-basket from the demonstration with a cookie-to-header CSRF rule", () => {
    const add = op("AddToCartAction");
    expect(add).toBeDefined();
    expect(add?.request).toMatchObject({
      method: "POST",
      urlTemplate: `${shop.url}/api/cart/items`,
      contentType: "application/json",
      bodyTemplate: '{"sku":"{sku}","qty":"{qty}"}',
    });
    expect(add?.csrf).toEqual([
      {
        source: { kind: "cookie", name: "csrf" },
        target: { kind: "header", name: "x-csrf-token" },
      },
    ]);
    expect(add?.inputs.map((p) => [p.name, p.path, p.required])).toEqual([
      ["sku", [s("object"), s("sku")], true],
      ["qty", [sab("quantity")], false],
    ]);
    expect(add?.session).toBe("signed-in");
    expect(add?.effect).toBe("reversible-write");
    expect(add?.provenance.method).toBe("demonstration");
  });

  it("learns checkout with an HTML hidden-field CSRF rule and the delivery options", () => {
    const order = op("OrderAction");
    expect(order?.request).toMatchObject({
      method: "POST",
      urlTemplate: `${shop.url}/checkout`,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(order?.effect).toBe("payment");
    expect(order?.csrf).toEqual([
      {
        source: {
          kind: "html",
          urlTemplate: `${shop.url}/checkout`,
          selector: 'form#checkout-form input[name="csrf_token"]',
          attribute: "value",
        },
        target: { kind: "form", name: "csrf_token" },
      },
    ]);
    expect(order?.inputs).toEqual([
      expect.objectContaining({
        name: "delivery",
        location: "form",
        options: ["standard", "express"],
        default: "standard",
      }),
    ]);
    expect(order?.provenance.method).toBe("demonstration");
  });

  it("builds a Buy flow whose bindings follow the values through the steps", () => {
    const flow = model.flows[0] as Flow;
    expect(model.flows).toHaveLength(1);
    expect(flow.actionType).toBe(s("BuyAction"));
    expect(flow.effect).toBe("payment");
    const ops = flow.steps.map((st) => model.operations.find((o) => o.id === st.operation));
    expect(ops.map((o) => o?.actionType.replace(s(""), ""))).toEqual([
      "SearchAction",
      "ViewAction",
      "AddToCartAction",
      "ViewAction", // the basket total, read after the last write (payment evidence)
      "OrderAction",
    ]);
    const [search, view, add, total, order] = flow.steps;
    expect(total?.bind).toEqual({ delivery: "$input.delivery" });
    expect(search?.bind).toEqual({ q: "$input.q" });
    expect(view?.bind).toEqual({ id: `$step0.${s("identifier")}` });
    expect(add?.bind).toEqual({ sku: `$step1.${s("sku")}`, qty: "$input.qty" });
    expect(order?.bind).toEqual({ delivery: "$input.delivery" });
    expect(flow.inputs.find((p) => p.name === "q")).toMatchObject({
      path: [s("object"), s("name")],
      required: true,
      example: "trail",
    });
    expect(flow.inputs.find((p) => p.name === "delivery")).toMatchObject({
      required: false,
      default: "standard",
      example: "express",
    });
    expect(flow.provenance.method).toBe("demonstration");
  });

  it("learns the password login route with a session cookie and a probe URL", () => {
    const route = model.login?.find((r) => r.operation?.endsWith("#sign-in"));
    expect(route).toMatchObject({
      method: "password",
      sessionCookies: ["sid"],
      probeUrl: `${shop.url}/account`,
    });
    const loginOp = model.operations.find((o) => o.id === route?.operation);
    expect(loginOp?.request).toMatchObject({ method: "POST", urlTemplate: `${shop.url}/login` });
    expect(loginOp?.inputs.filter((p) => p.path.length === 0).map((p) => p.name)).toEqual([
      "username",
      "password",
    ]);
    expect(loginOp?.csrf?.[0]?.target).toEqual({ kind: "form", name: "csrf_token" });
  });

  it("finds the bearer token endpoint and its refresh route in the bundle", () => {
    const bearer = model.login?.find((r) => r.refresh);
    expect(bearer?.refresh).toEqual({
      urlTemplate: `${shop.url}/api/token/refresh`,
      tokenPointer: "/access_token",
      expiresInPointer: "/expires_in",
    });
    const tokenOp = model.operations.find((o) => o.id === bearer?.operation);
    expect(tokenOp?.request.urlTemplate).toBe(`${shop.url}/api/token`);
    expect(tokenOp?.provenance.method).toBe("js-analysis");
  });

  it("keeps writes nobody demonstrated out of the model", () => {
    expect(model.operations.some((o) => o.request.method === "DELETE")).toBe(false);
    expect(model.operations.some((o) => o.request.urlTemplate.endsWith("/logout"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("DELETE") && w.includes("demonstrations"))).toBe(
      true,
    );
    for (const o of model.operations) {
      if (o.effect !== "read" && o.actionType !== sab("LoginAction"))
        expect(o.provenance.method).toBe("demonstration");
    }
  });

  it("sent no non-GET request outside the login and the demonstration", () => {
    const writes = shop.state.requests.filter((r) => r.method !== "GET");
    const outside = writes.filter(
      (r) =>
        !(r.method === "POST" && r.url.startsWith("/login")) &&
        !(r.at >= demoWindow.from && r.at <= demoWindow.to),
    );
    expect(outside).toEqual([]);
    expect(writes.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST /login",
      "POST /api/cart/items",
      "POST /checkout",
    ]);
    expect(shop.state.orders).toHaveLength(1);
    expect(shop.state.logins).toHaveLength(1);
  });

  it("never puts credentials or session values in the trace", () => {
    const text = JSON.stringify(result.trace);
    expect(text).not.toContain("correct-horse");
    for (const r of result.trace) {
      expect(Object.keys(r.requestHeaders)).not.toContain("cookie");
      expect(Object.keys(r.requestHeaders)).not.toContain("authorization");
    }
    const add = result.trace.find((r) => r.method === "POST" && r.url.endsWith("/api/cart/items"));
    expect(add?.requestHeaders["x-csrf-token"]).toBe("[redacted]");
    expect(add?.headersFromCookies).toEqual({ "x-csrf-token": "csrf" });
  });

  it("returns a structurally sound model", () => {
    const ids = [...model.operations.map((o) => o.id), ...model.flows.map((f) => f.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const flow of model.flows) {
      for (const st of flow.steps) {
        const target = model.operations.find((o) => o.id === st.operation);
        expect(target).toBeDefined();
        for (const name of Object.keys(st.bind))
          expect(target?.inputs.map((p) => p.name)).toContain(name);
      }
    }
  });
});
