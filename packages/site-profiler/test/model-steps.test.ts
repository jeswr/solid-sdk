// AUTHORED-BY Claude Opus 5.5
// Unit tests for labelling, operation building, flow inference and verification.

import type { Operation } from "@jeswr/site-model";
import { describe, expect, it } from "vitest";
import { buildFlow, type DemoStep } from "../src/demonstrations.js";
import { parseForms } from "../src/forms.js";
import { HeuristicLabeller, isLoginCandidate } from "../src/labeller.js";
import { buildOperation, operationId, toParameter } from "../src/operations.js";
import { candidateFromForm, candidateFromScriptCall, clusterRequests } from "../src/templates.js";
import type { EndpointCandidate, Label, RecordedRequest } from "../src/types.js";
import { s, sab, xsd } from "../src/util.js";
import { findProbeUrl, type Replayer, sampleValues, verifyOperations } from "../src/verify.js";

const O = "https://shop.test";
const labeller = new HeuristicLabeller();
let seq = 0;
function req(method: string, path: string, extra: Partial<RecordedRequest> = {}): RecordedRequest {
  return {
    seq: seq++,
    phase: "crawl",
    method,
    url: `${O}${path}`,
    resourceType: "document",
    requestHeaders: {},
    cookieNames: [],
    status: 200,
    contentType: "text/html",
    ...extra,
  };
}
const cand = (r: RecordedRequest[]) => clusterRequests(r, O)[0] as EndpointCandidate;
const json = { contentType: "application/json" };

describe("HeuristicLabeller", () => {
  const label = (c: EndpointCandidate) => labeller.label(c);
  it("labels reads", async () => {
    expect(await label(cand([req("GET", "/search?q=x")]))).toMatchObject({
      actionType: s("SearchAction"),
      label: "Search products",
      effect: "read",
    });
    expect((await label(cand([req("GET", "/api/search?query=x", json)]))).label).toBe(
      "Search products (JSON)",
    );
    expect(await label(cand([req("GET", "/product/1")]))).toMatchObject({
      actionType: s("ViewAction"),
      label: "View product",
    });
    expect((await label(cand([req("GET", "/api/products/1", json)]))).label).toBe(
      "View product (JSON)",
    );
    expect((await label(cand([req("GET", "/api/cart", json)]))).label).toBe("View cart (JSON)");
    expect((await label(cand([req("GET", "/")]))).label).toBe("View home page");
    expect((await label(cand([req("GET", "/orders")]))).label).toBe("View order");
    expect((await label(cand([req("GET", "/login")]))).skip).toBe(true);
    expect(
      (await label(cand([req("GET", "/feed.bin", { contentType: "application/octet-stream" })])))
        .skip,
    ).toBe(true);
  });
  it("labels writes, defaulting unknown writes to irreversible", async () => {
    const body = { postData: "a=1" };
    expect(await label(cand([req("POST", "/api/cart/items", body)]))).toMatchObject({
      actionType: s("AddToCartAction"),
      effect: "reversible-write",
    });
    expect(await label(cand([req("DELETE", "/api/cart/items/A-1")]))).toMatchObject({
      actionType: s("DeleteAction"),
      effect: "reversible-write",
    });
    expect(await label(cand([req("PATCH", "/basket")]))).toMatchObject({
      actionType: s("UpdateAction"),
      effect: "reversible-write",
    });
    expect(await label(cand([req("POST", "/checkout", body)]))).toMatchObject({
      actionType: s("OrderAction"),
      effect: "payment",
    });
    expect(await label(cand([req("POST", "/orders", body)]))).toMatchObject({
      actionType: s("OrderAction"),
      effect: "payment",
    });
    expect(await label(cand([req("POST", "/logout", body)]))).toMatchObject({
      actionType: sab("LogoutAction"),
    });
    expect(await label(cand([req("DELETE", "/posts/5")]))).toMatchObject({
      actionType: s("DeleteAction"),
      effect: "irreversible-write",
    });
    expect(await label(cand([req("PUT", "/posts/5")]))).toMatchObject({
      actionType: s("UpdateAction"),
      effect: "irreversible-write",
    });
    expect(await label(cand([req("POST", "/posts", body)]))).toMatchObject({
      actionType: s("CreateAction"),
      effect: "irreversible-write",
      label: "Create post",
    });
  });
  it("recognises password forms and token endpoints as logins", async () => {
    const [form] = parseForms(
      '<form method="post" action="/login"><input name="user"><input type="password" name="pw"></form>',
      `${O}/login`,
    );
    const login = candidateFromForm(form as never, `${O}/login`);
    expect(isLoginCandidate(login)).toBe(true);
    expect(await label(login)).toMatchObject({ actionType: sab("LoginAction"), label: "Sign in" });
    const token = candidateFromScriptCall({
      scriptUrl: `${O}/a.js`,
      method: "POST",
      urlPattern: `${O}/api/token`,
      headers: {},
      csrf: [],
      bodyKind: "form",
      bodyKeys: ["username", "password"],
      via: "fetch",
      line: 1,
    });
    expect(await label(token as never)).toMatchObject({ label: "Get access token" });
    expect(isLoginCandidate(cand([req("GET", "/login")]))).toBe(false);
    expect(isLoginCandidate(cand([req("POST", "/x", { postData: "user=a" })]))).toBe(false);
  });
});

describe("operations", () => {
  const read: Label = {
    actionType: s("ViewAction"),
    label: "View order",
    effect: "read",
    confidence: 0.81234,
  };
  it("maps parameters onto the action node", () => {
    const order = cand([req("GET", "/orders/5001")]);
    expect(toParameter(order, order.params[0] as never, read)).toMatchObject({
      path: [s("object")],
      range: s("Order"),
      required: true,
      example: "5001",
    });
    const sku = cand([req("DELETE", "/cart/items/SNK-TRAIL-01")]);
    expect(toParameter(sku, sku.params[0] as never, read)).toMatchObject({
      path: [s("object"), s("sku")],
    });
    const misc = cand([
      req("POST", "/x", {
        postData: '{"id":"7","note":"hi","count":3,"ok":true,"ratio":0.5}',
        requestHeaders: { "content-type": "application/json" },
      }),
    ]);
    const ps = misc.params.map((p) => toParameter(misc, p, read));
    expect(ps.map((p) => [p.name, p.path, p.range])).toEqual([
      ["id", [s("object"), s("identifier")], xsd("string")],
      ["note", [sab("note")], xsd("string")],
      ["count", [sab("count")], xsd("integer")],
      ["ok", [sab("ok")], xsd("boolean")],
      ["ratio", [sab("ratio")], xsd("decimal")],
    ]);
    const paged = cand([req("GET", "/search?q=a&page=2&limit=5")]);
    expect(
      paged.params
        .map((p) => toParameter(paged, p, read))
        .map((p) => [p.name, p.required, p.default, p.range]),
    ).toEqual([
      ["q", true, undefined, xsd("string")],
      ["page", false, "1", xsd("integer")],
      ["limit", false, undefined, xsd("integer")],
    ]);
    const unknownThing = cand([req("GET", "/widgets/9")]);
    expect(toParameter(unknownThing, unknownThing.params[0] as never, read).range).toBe(s("Thing"));
    const user = cand([req("GET", "/users/9")]);
    expect(toParameter(user, user.params[0] as never, read).range).toBe(s("Person"));
  });
  it("builds an operation with request template, csrf, session and rounded confidence", () => {
    const c = cand([
      req("POST", "/api/cart/items", {
        phase: "demonstration",
        postData: '{"sku":"A-1","qty":2}',
        requestHeaders: { "content-type": "application/json", "x-requested-with": "fetch" },
        headersFromCookies: { "x-csrf-token": "csrf" },
        cookieNames: ["sid", "csrf"],
      }),
    ]);
    const used = new Set<string>();
    const op = buildOperation(
      c,
      {
        actionType: s("AddToCartAction"),
        label: "Add to basket",
        effect: "reversible-write",
        confidence: 0.854,
        description: "d",
      },
      {
        modelId: "urn:m",
        learnedAt: "2026-11-13T00:00:00Z",
        derivedFrom: ["urn:uuid:1"],
        method: "demonstration",
        usedIds: used,
        sessionCookies: ["sid"],
      },
    );
    expect(op).toMatchObject({
      id: "urn:m#add-to-basket",
      session: "signed-in",
      description: "d",
      request: {
        method: "POST",
        contentType: "application/json",
        bodyTemplate: '{"sku":"{sku}","qty":"{qty}"}',
        headers: { "x-requested-with": "fetch" },
      },
      csrf: [{ source: { kind: "cookie", name: "csrf" } }],
      provenance: { confidence: 0.85, method: "demonstration" },
    });
    expect(op.inputs.find((p) => p.name === "qty")).toMatchObject({
      default: "2",
      required: false,
    });
    expect(operationId("urn:m", "Add to basket", used)).toBe("urn:m#add-to-basket-2");
    const [form] = parseForms(
      '<form method="post" action="/login"><input type="hidden" name="csrf_token" value="t"><input type="hidden" name="next" value="/a"><input name="username"><input type="password" name="password"></form>',
      `${O}/login`,
    );
    const login = buildOperation(
      candidateFromForm(form as never, `${O}/login`),
      {
        actionType: sab("LoginAction"),
        label: "Sign in",
        effect: "reversible-write",
        confidence: 0.9,
      },
      {
        modelId: "urn:m",
        learnedAt: "x",
        derivedFrom: [],
        method: "form",
        usedIds: used,
        sessionCookies: [],
      },
    );
    expect(login.inputs.map((p) => [p.name, p.path.length, p.required, p.default])).toEqual([
      ["next", 1, false, "/a"],
      ["username", 0, true, undefined],
      ["password", 0, true, undefined],
    ]);
    expect(login.session).toBe("none");
    expect(login.inputs.find((p) => p.name === "password")?.example).toBeUndefined();
  });
});

function op(
  id: string,
  actionType: string,
  effect: Operation["effect"],
  inputs: Operation["inputs"],
  extraction?: Operation["extraction"],
): Operation {
  const o: Operation = {
    id: `urn:m#${id}`,
    actionType: s(actionType),
    label: id,
    inputs,
    request: { method: effect === "read" ? "GET" : "POST", urlTemplate: `${O}/${id}` },
    session: "none",
    effect,
    provenance: { derivedFrom: [], learnedAt: "x", method: "crawl", confidence: 0.8 },
  };
  if (extraction) o.extraction = extraction;
  return o;
}

const listEx = {
  format: "json" as const,
  itemPath: "/items",
  itemType: s("Product"),
  fields: [
    { property: s("identifier"), path: "/id" },
    { property: s("url"), path: "/url", datatype: "iri" },
    { property: s("sku"), path: "/sku" },
  ],
};
const oneEx = {
  format: "json" as const,
  itemType: s("Product"),
  fields: [
    { property: s("sku"), path: "/sku" },
    { property: s("name"), path: "/name" },
  ],
};

describe("buildFlow", () => {
  const search = op(
    "search",
    "SearchAction",
    "read",
    [{ name: "q", path: [s("query")], range: xsd("string"), required: true, location: "query" }],
    listEx,
  );
  const view = op(
    "view",
    "ViewAction",
    "read",
    [{ name: "id", path: [s("object")], range: s("Product"), required: true, location: "path" }],
    oneEx,
  );
  const add = op("add", "AddToCartAction", "reversible-write", [
    {
      name: "sku",
      path: [s("object"), s("sku")],
      range: xsd("string"),
      required: true,
      location: "body",
    },
    {
      name: "qty",
      path: [sab("quantity")],
      range: xsd("integer"),
      required: false,
      location: "body",
      default: "1",
    },
  ]);
  const pay = op("pay", "OrderAction", "payment", [
    {
      name: "delivery",
      path: [sab("delivery")],
      range: xsd("string"),
      required: false,
      location: "form",
      options: ["standard", "express"],
      default: "standard",
    },
    { name: "note", path: [], range: xsd("string"), required: true, location: "form" },
  ]);
  const searchBody = JSON.stringify({
    items: [
      { id: 104, url: "https://shop.test/product/104", sku: "SNK-TRAIL-01" },
      { id: 107, url: "u", sku: "CAP-1" },
    ],
  });
  const viewBody = JSON.stringify({ sku: "SNK-TRAIL-01", name: "Trail Runner sneakers" });
  const step = (o: Operation, values: Record<string, string>, body?: string): DemoStep => ({
    operation: o,
    values,
    request: req(
      o.request.method,
      `/${o.id.split("#")[1]}`,
      body ? { bodySample: body, contentType: "application/json" } : {},
    ),
  });
  const ctx = () => ({
    modelId: "urn:m",
    learnedAt: "t",
    derivedFrom: ["urn:uuid:d"],
    usedIds: new Set<string>(),
  });

  it("binds a write to the latest step showing the value and reads to the earliest", () => {
    const steps = [
      step(search, { q: "trail" }, searchBody),
      step(view, { id: "104" }, viewBody),
      step(view, { id: "104" }, viewBody),
      step(add, { sku: "SNK-TRAIL-01", qty: "1" }),
      step(pay, { delivery: "express", csrf_token: "[redacted]" }),
    ];
    const { flow, warnings } = buildFlow(
      { name: "buy-product", description: "Buy it" },
      steps,
      ctx(),
    );
    expect(flow?.steps.map((st) => [st.operation.split("#")[1], st.bind])).toEqual([
      ["search", { q: "$input.q" }],
      ["view", { id: `$step0.${s("identifier")}` }],
      ["add", { sku: `$step1.${s("sku")}`, qty: "$input.qty" }],
      ["pay", { delivery: "$input.delivery" }],
    ]);
    expect(flow).toMatchObject({
      id: "urn:m#flow-buy-product",
      actionType: s("BuyAction"),
      effect: "payment",
      label: "Buy product",
      description: "Buy it",
    });
    expect(flow?.inputs.map((p) => [p.name, p.path, p.required, p.default, p.example])).toEqual([
      ["q", [s("object"), s("name")], true, undefined, "trail"],
      ["qty", [sab("quantity")], false, "1", "1"],
      ["delivery", [sab("delivery")], false, "standard", "express"],
    ]);
    expect(warnings).toEqual(["demonstration buy-product: step 3 has no value for note"]);
  });

  it("falls back to an IRI's last segment and to flow inputs", () => {
    const viewFromUrl = op("v2", "ViewAction", "read", [
      { name: "id", path: [s("object")], range: s("Product"), required: true, location: "path" },
    ]);
    const addById = op("a2", "AddToCartAction", "reversible-write", [
      { name: "pid", path: [], range: xsd("string"), required: true, location: "body" },
    ]);
    const body = JSON.stringify({ items: [{ url: "https://shop.test/product/104", sku: "X-1" }] });
    const urlOnly = {
      ...listEx,
      fields: [
        { property: s("url"), path: "/url", datatype: "iri" },
        { property: s("sku"), path: "/sku" },
      ],
    };
    const s2 = { ...search, extraction: urlOnly };
    const { flow } = buildFlow(
      { name: "add" },
      [step(s2, { q: "t" }, body), step(viewFromUrl, { id: "104" }), step(addById, { pid: "104" })],
      ctx(),
    );
    expect(flow?.steps.map((st) => st.bind)).toEqual([
      { q: "$input.q" },
      { pid: `$step0.${s("url")}` },
    ]);
    expect(flow?.actionType).toBe(s("AddToCartAction"));
    expect(flow?.effect).toBe("reversible-write");
    expect(flow?.inputs.map((p) => p.name)).toEqual(["q"]);
  });

  it("keeps clashing input names apart and dedupes flow ids", () => {
    const a = op("a", "CreateAction", "irreversible-write", [
      {
        name: "name",
        path: [sab("title")],
        range: xsd("string"),
        required: true,
        location: "form",
      },
    ]);
    const b = op("b", "CreateAction", "irreversible-write", [
      {
        name: "name",
        path: [sab("other")],
        range: xsd("string"),
        required: true,
        location: "form",
      },
    ]);
    const c = ctx();
    c.usedIds.add("urn:m#flow-x");
    const { flow } = buildFlow(
      { name: "x" },
      [step(a, { name: "one" }), step(b, { name: "two" })],
      c,
    );
    expect(flow?.id).toBe("urn:m#flow-x-2");
    expect(flow?.inputs.map((p) => p.name)).toEqual(["name", "name_1"]);
    expect(flow?.steps[1]?.bind).toEqual({ name: "$input.name_1" });
  });

  it("makes no flow from a read-only demonstration", () => {
    const r = buildFlow({ name: "look" }, [step(search, { q: "x" }, searchBody)], ctx());
    expect(r.flow).toBeUndefined();
    expect(r.warnings[0]).toMatch(/no write requests/);
  });
});

describe("verification", () => {
  const read = op(
    "search",
    "SearchAction",
    "read",
    [
      {
        name: "q",
        path: [s("query")],
        range: xsd("string"),
        required: true,
        location: "query",
        example: "trail",
      },
      {
        name: "page",
        path: [sab("page")],
        range: xsd("integer"),
        required: false,
        location: "query",
        default: "1",
      },
    ],
    listEx,
  );
  read.request.urlTemplate = `${O}/api/search{?q,page}`;
  const fake = (
    routes: Record<string, { anon: number; auth: number; body?: string }>,
  ): Replayer & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      async get(url, { signedIn }) {
        calls.push(`${signedIn ? "auth" : "anon"} ${url}`);
        const r = routes[url];
        if (!r) throw new Error("down");
        return {
          status: signedIn ? r.auth : r.anon,
          body: r.body ?? "",
          contentType: "application/json",
        };
      },
    };
  };
  const now = () => new Date("2026-11-13T10:00:00Z");

  it("replays reads, sets session and counters, flags empty extraction, drops failures", async () => {
    const privateRead = {
      ...read,
      id: "urn:m#private",
      label: "private",
      request: { ...read.request, urlTemplate: `${O}/mine{?q}` },
    };
    const broken = {
      ...read,
      id: "urn:m#broken",
      label: "broken",
      request: { ...read.request, urlTemplate: `${O}/broken{?q}` },
    };
    const noValues = op("nov", "ViewAction", "read", [
      { name: "id", path: [s("object")], range: s("Thing"), required: true, location: "path" },
    ]);
    const write = op("add", "AddToCartAction", "reversible-write", []);
    const replayer = fake({
      [`${O}/api/search?q=trail&page=1`]: {
        anon: 200,
        auth: 200,
        body: JSON.stringify({ items: [{ id: 1 }] }),
      },
      [`${O}/mine?q=trail`]: { anon: 302, auth: 200, body: "{}" },
      [`${O}/broken?q=trail`]: { anon: 500, auth: 500 },
    });
    const { operations, warnings } = await verifyOperations(
      [read, privateRead, broken, noValues, write],
      { replayer, now, haveSession: true },
    );
    expect(operations.map((o) => o.label)).toEqual(["search", "private", "nov", "add"]);
    expect(operations[0]?.session).toBe("none");
    expect(operations[0]?.provenance).toMatchObject({
      attempts: 1,
      successes: 1,
      lastVerified: "2026-11-13T10:00:00.000Z",
      confidence: 0.8,
    });
    expect(operations[1]?.session).toBe("signed-in");
    expect(operations[1]?.provenance.confidence).toBe(0.4);
    expect(warnings).toEqual([
      "verify: private extraction found nothing on replay",
      `verify: dropped broken (${O}/broken?q=trail answered 500 / 500)`,
      "verify: no sample values for nov; left unverified",
    ]);
    expect(replayer.calls).not.toContain(`auth ${O}/api/search?q=trail&page=1`);
    expect(sampleValues(read)).toEqual({ q: "trail", page: "1" });
  });

  it("finds a probe URL that refuses anonymous visitors", async () => {
    const replayer = fake({
      [`${O}/open`]: { anon: 200, auth: 200 },
      [`${O}/teapot`]: { anon: 418, auth: 200 },
      [`${O}/account`]: { anon: 302, auth: 200 },
    });
    expect(
      await findProbeUrl([`${O}/down`, `${O}/open`, `${O}/teapot`, `${O}/account`], replayer),
    ).toBe(`${O}/account`);
    expect(await findProbeUrl([`${O}/open`], replayer)).toBeUndefined();
  });
});
