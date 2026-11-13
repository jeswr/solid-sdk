// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { parseForms } from "../src/forms.js";
import {
  bodyTemplateFor,
  candidateFromForm,
  candidateFromScriptCall,
  clusterRequests,
  collectKnownIds,
  matchRequest,
  mergeCandidates,
  requestValues,
  templateForPage,
} from "../src/templates.js";
import type { RecordedRequest, ScriptCall } from "../src/types.js";
import {
  expandTemplate,
  slug,
  templateShape,
  templateVariables,
  valueKind,
  varName,
} from "../src/util.js";

const O = "https://shop.test";
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

describe("clusterRequests", () => {
  it("keeps examples local to the endpoint and excludes failed probe guesses", () => {
    const candidates = mergeCandidates(
      clusterRequests(
        [
          req("GET", "/api/search?delivery=canvas&q=canvas"),
          req("GET", "/api/checkout?delivery=canvas", { phase: "probe", status: 400 }),
          req("GET", "/api/checkout?delivery=standard", { phase: "demonstration" }),
          req("GET", "/api/checkout?delivery=express", { phase: "demonstration" }),
        ],
        O,
      ),
    );
    const checkout = candidates.find((c) => c.urlTemplate === `${O}/api/checkout{?delivery}`);
    expect(checkout?.params).toEqual([
      { name: "delivery", location: "query", examples: ["standard", "express"], required: true },
    ]);
    expect(
      candidates.find((c) => c.urlTemplate.startsWith(`${O}/api/search`))?.params[0]?.examples,
    ).toEqual(["canvas"]);
  });

  it("keeps demonstrated write values when a successful form submission redirects", () => {
    const [checkout] = clusterRequests(
      [
        req("POST", "/checkout", {
          phase: "demonstration",
          status: 303,
          postData: "delivery=express",
        }),
      ],
      O,
    );
    expect(checkout?.params[0]?.examples).toEqual(["express"]);
  });

  it("infers numeric, sku and known-id path variables and query parameters", () => {
    const reqs = [
      req("GET", "/product/101"),
      req("GET", "/product/104"),
      req("GET", "/item/trail-runner"),
      req("GET", "/search?q=trail"),
      req("GET", "/search?q=wool&page=2"),
      req("GET", "/search"),
      req("GET", "/static/app.js", { resourceType: "script" }),
      req("GET", "/logo.png", { resourceType: "other" }),
      req("POST", "/api/cart/items", { blocked: true }),
      req("GET", "/x", { resourceType: "replay-anonymous" }),
      req("OPTIONS", "/x"),
      { ...req("GET", "/x"), url: "https://other.test/x" },
      { ...req("GET", "/x"), url: "not a url" },
      req("DELETE", "/api/cart/items/SNK-TRAIL-01", { phase: "demonstration" }),
      req("GET", "/orders/5001/lines/3"),
      req("GET", "/u/0f8fad5b-d9cb-469f-a165-70867728950e"),
    ];
    const out = clusterRequests(reqs, O, new Set(["trail-runner"]));
    const byTemplate = Object.fromEntries(
      out.map((c) => [`${c.method} ${c.urlTemplate.replace(O, "")}`, c]),
    );
    expect(Object.keys(byTemplate).sort()).toEqual([
      "DELETE /api/cart/items/{sku}",
      "GET /item/{id}",
      "GET /orders/{orderId}/lines/{lineId}",
      "GET /product/{id}",
      "GET /search{?q,page}",
      "GET /u/{id}",
    ]);
    expect(byTemplate["GET /product/{id}"]?.params).toEqual([
      { name: "id", location: "path", examples: ["101", "104"], required: true, kind: "numeric" },
    ]);
    expect(byTemplate["GET /item/{id}"]?.params[0]?.kind).toBe("known-id");
    expect(byTemplate["GET /u/{id}"]?.params[0]?.kind).toBe("uuid");
    expect(byTemplate["GET /search{?q,page}"]?.params).toEqual([
      { name: "q", location: "query", examples: ["trail", "wool"], required: false },
      { name: "page", location: "query", examples: ["2"], required: false },
    ]);
    expect(byTemplate["DELETE /api/cart/items/{sku}"]?.sources).toEqual(["demonstration"]);
    expect(byTemplate["GET /search{?q,page}"]?.responseKind).toBe("html");
  });

  it("reads JSON and form bodies, static headers, CSRF headers copied from cookies and auth schemes", () => {
    const add = req("POST", "/api/cart/items", {
      phase: "demonstration",
      postData: '{"sku":"SNK-TRAIL-01","qty":1,"gift":false,"meta":{"a":1}}',
      requestHeaders: {
        "content-type": "application/json",
        "x-requested-with": "fetch",
        "x-csrf-token": "[redacted]",
        "user-agent": "x",
        accept: "application/json",
      },
      headersFromCookies: { "x-csrf-token": "csrf" },
      authScheme: "Bearer",
      contentType: "application/json",
    });
    const form = req("POST", "/checkout", {
      postData: "delivery=express&csrf_token=%5Bredacted%5D",
    });
    const [a, f] = clusterRequests([add, form], O);
    expect(a).toMatchObject({
      contentType: "application/json",
      bodyTemplate: '{"sku":"{sku}","qty":"{qty}","gift":"{gift}","meta":"{meta}"}',
      headers: { "x-requested-with": "fetch", accept: "application/json" },
      csrf: [
        {
          source: { kind: "cookie", name: "csrf" },
          target: { kind: "header", name: "x-csrf-token" },
        },
      ],
      authScheme: "Bearer",
      responseKind: "json",
    });
    expect(a?.params.map((p) => [p.name, p.location, p.jsonType])).toEqual([
      ["sku", "body", "string"],
      ["qty", "body", "integer"],
      ["gift", "body", "boolean"],
      ["meta", "body", "object"],
    ]);
    expect(f?.contentType).toBe("application/x-www-form-urlencoded");
    expect(f?.params.map((p) => [p.name, p.location])).toEqual([
      ["delivery", "form"],
      ["csrf_token", "form"],
    ]);
    expect(f?.bodyTemplate).toBeUndefined();
  });

  it("collects ids from JSON and HTML responses", () => {
    const ids = collectKnownIds([
      req("GET", "/a", {
        contentType: "application/json",
        bodySample: '{"items":[{"id":7,"sku":"A-1","slug":"x-y","name":"n"}],"orderId":"o9"}',
      }),
      req("GET", "/b", {
        bodySample: '<li data-product-id="104" data-sku="SNK-1" data-x="no"></li>',
      }),
      req("GET", "/c", { bodySample: undefined }),
    ]);
    expect([...ids].sort()).toEqual(["104", "7", "A-1", "SNK-1", "o9", "x-y"]);
  });
});

describe("candidates from forms and scripts", () => {
  const call = (over: Partial<ScriptCall>): ScriptCall => ({
    scriptUrl: `${O}/app.js`,
    method: "GET",
    urlPattern: `${O}/api/search?q={q}&page={page}`,
    headers: {},
    csrf: [],
    bodyKeys: [],
    via: "fetch",
    line: 1,
    ...over,
  });

  it("turns script URL patterns into templates", () => {
    expect(candidateFromScriptCall(call({}))?.urlTemplate).toBe(`${O}/api/search{?q,page}`);
    const fixed = candidateFromScriptCall(call({ urlPattern: `${O}/api/x?format=json&q={q}` }));
    expect(fixed?.urlTemplate).toBe(`${O}/api/x?format=json{&q}`);
    const post = candidateFromScriptCall(
      call({
        method: "POST",
        urlPattern: `${O}/api/cart/items/{sku}`,
        bodyKind: "json",
        bodyKeys: ["qty"],
        headers: { "Content-Type": "application/json", "X-Client": "web" },
        authScheme: "Bearer",
      }),
    );
    expect(post).toMatchObject({
      contentType: "application/json",
      bodyTemplate: '{"qty":"{qty}"}',
      headers: { "X-Client": "web" },
      authScheme: "Bearer",
    });
    expect(post?.params.map((p) => [p.name, p.location, p.kind])).toEqual([
      ["sku", "path", "sku"],
      ["qty", "body", undefined],
    ]);
    expect(
      candidateFromScriptCall(call({ method: "POST", bodyKind: "form", bodyKeys: ["a"] }))
        ?.contentType,
    ).toBe("application/x-www-form-urlencoded");
    expect(
      candidateFromScriptCall(call({ method: "POST", bodyKind: "multipart" }))?.contentType,
    ).toBe("multipart/form-data");
    expect(candidateFromScriptCall(call({ method: "HEAD" }))).toBeUndefined();
  });

  it("turns forms into candidates without their CSRF field", () => {
    const [search, checkout] = parseForms(
      `<form action="/search"><input name="q"></form>
       <form method="post" action="/checkout?step=2" id="co"><input type="hidden" name="csrf_token" value="t"><input type="hidden" name="cart" value="c1"><select name="delivery"><option>standard</option><option selected>express</option></select></form>`,
      `${O}/checkout`,
    );
    const s = candidateFromForm(search as never, `${O}/`);
    expect(s).toMatchObject({ method: "GET", urlTemplate: `${O}/search{?q}`, sources: ["form"] });
    const c = candidateFromForm(checkout as never, `${O}/checkout`);
    expect(c.urlTemplate).toBe(`${O}/checkout?step=2`);
    expect(c.contentType).toBe("application/x-www-form-urlencoded");
    expect(c.params.map((p) => p.name)).toEqual(["cart", "delivery"]);
    expect(c.params[1]).toMatchObject({ options: ["standard", "express"], selected: "express" });
    expect(c.params[0]).toMatchObject({ hidden: true, examples: ["c1"] });
    expect(c.csrf[0]?.source).toMatchObject({
      kind: "html",
      selector: 'form#co input[name="csrf_token"]',
    });
  });

  it("merges evidence for the same endpoint, recorded names first", () => {
    const recorded = clusterRequests([req("GET", "/search?q=trail", { phase: "crawl" })], O)[0];
    const fromScript = candidateFromScriptCall(
      call({ urlPattern: `${O}/search?q={q}&page={page}` }),
    );
    const [form] = parseForms(
      '<form action="/search"><input name="q" value="x"><select name="sort"><option>a</option></select></form>',
      `${O}/`,
    );
    const merged = mergeCandidates([
      fromScript as never,
      candidateFromForm(form as never, `${O}/`),
      recorded as never,
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.urlTemplate).toBe(`${O}/search{?q,sort,page}`);
    expect(merged[0]?.sources).toEqual(["crawl", "form", "js-analysis"]);
    expect(merged[0]?.params.find((p) => p.name === "sort")).toMatchObject({
      options: ["a"],
      required: false,
    });
    expect(merged[0]?.params.find((p) => p.name === "q")?.examples).toEqual(["trail", "x"]);
    expect(merged[0]?.script).toBeDefined();
    expect(merged[0]?.form).toBeDefined();

    const demo = clusterRequests(
      [
        req("POST", "/api/cart/items", {
          phase: "demonstration",
          postData: '{"sku":"A-1"}',
          requestHeaders: { "content-type": "application/json" },
        }),
      ],
      O,
    )[0];
    const js = candidateFromScriptCall(
      call({
        method: "POST",
        urlPattern: `${O}/api/cart/items`,
        bodyKind: "json",
        bodyKeys: ["sku", "qty"],
        csrf: [
          {
            source: { kind: "cookie", name: "csrf" },
            target: { kind: "header", name: "X-CSRF-Token" },
          },
        ],
      }),
    );
    const [m] = mergeCandidates([js as never, demo as never]);
    expect(m?.csrf).toHaveLength(1);
    expect(m?.params.map((p) => [p.name, p.required])).toEqual([
      ["sku", true],
      ["qty", false],
    ]);
    expect(m?.bodyTemplate).toBe('{"sku":"{sku}"}');
  });

  it("pairs path variables by position when merging", () => {
    const a = clusterRequests([req("GET", "/p/1")], O)[0];
    const b = candidateFromScriptCall(call({ urlPattern: `${O}/p/{productId}` }));
    const [m] = mergeCandidates([a as never, b as never]);
    expect(m?.urlTemplate).toBe(`${O}/p/{id}`);
  });
});

describe("matching requests to candidates", () => {
  const [product] = clusterRequests([req("GET", "/product/101"), req("GET", "/product/104")], O);
  const [search] = clusterRequests([req("GET", "/search?q=a")], O);
  const [add] = clusterRequests(
    [
      req("POST", "/api/cart/items", {
        postData: '{"sku":"A-1","qty":2}',
        requestHeaders: { "content-type": "application/json" },
      }),
    ],
    O,
  );
  it("decomposes a request into parameter values", () => {
    expect(matchRequest(product as never, req("GET", "/product/107"))).toEqual({ id: "107" });
    expect(matchRequest(search as never, req("GET", "/search?q=trail"))).toEqual({ q: "trail" });
    expect(
      matchRequest(
        add as never,
        req("POST", "/api/cart/items", {
          postData: '{"sku":"B-2","qty":1}',
          requestHeaders: { "content-type": "application/json" },
        }),
      ),
    ).toEqual({ sku: "B-2", qty: "1" });
  });
  it("rejects other methods, paths and origins", () => {
    expect(matchRequest(product as never, req("POST", "/product/107"))).toBeUndefined();
    expect(matchRequest(product as never, req("GET", "/product/107/reviews"))).toBeUndefined();
    expect(matchRequest(product as never, req("GET", "/item/107"))).toBeUndefined();
    expect(
      matchRequest(product as never, {
        ...req("GET", "/product/1"),
        url: "https://evil.test/product/1",
      }),
    ).toBeUndefined();
  });
  it("finds the template that served a page", () => {
    expect(templateForPage([product as never], `${O}/product/104?x=1`)).toBe(`${O}/product/{id}`);
    expect(templateForPage([add as never], `${O}/checkout`)).toBe(`${O}/checkout`);
  });
  it("reads request values for other content types", () => {
    expect(requestValues(req("POST", "/x", { postData: "a=1&b=2" })).body.map((b) => b[0])).toEqual(
      ["a", "b"],
    );
    expect(
      requestValues(
        req("POST", "/x", {
          postData: "[1,2]",
          requestHeaders: { "content-type": "application/json" },
        }),
      ).body,
    ).toEqual([]);
    expect(
      requestValues(
        req("POST", "/x", { postData: "raw", requestHeaders: { "content-type": "text/plain" } }),
      ).body,
    ).toEqual([]);
    expect(
      requestValues(
        req("POST", "/x", {
          postData: "--b",
          requestHeaders: { "content-type": "multipart/form-data; boundary=b" },
        }),
      ).body,
    ).toEqual([]);
    expect(bodyTemplateFor(req("POST", "/x", { postData: "[1]" }))).toBeUndefined();
  });
});

describe("util", () => {
  it("expands the RFC 6570 subset with correct encoding", () => {
    expect(
      expandTemplate("https://s.test/search{?q,page}", { q: "trail runner & co", page: "2" }),
    ).toBe("https://s.test/search?q=trail%20runner%20%26%20co&page=2");
    expect(expandTemplate("https://s.test/search{?q,page}", { q: "x" })).toBe(
      "https://s.test/search?q=x",
    );
    expect(expandTemplate("https://s.test/search{?q}", {})).toBe("https://s.test/search");
    expect(expandTemplate("https://s.test/x?a=1{&b}", { b: "it's" })).toBe(
      "https://s.test/x?a=1&b=it%27s",
    );
    expect(expandTemplate("https://s.test/p/{id}", { id: "a/b" })).toBe("https://s.test/p/a%2Fb");
    expect(expandTemplate("https://s.test{/a,b}", { a: "x", b: "y z" })).toBe(
      "https://s.test/x/y%20z",
    );
    expect(expandTemplate("https://s.test/{+path}", { path: "a/b c" })).toBe(
      "https://s.test/a/b%20c",
    );
    expect(templateVariables("https://s.test/{id}/x{?q,page}{&id}")).toEqual(["id", "q", "page"]);
    expect(templateShape("get", "https://s.test/p/{id}{?q}")).toBe("GET https://s.test/p/{}");
  });
  it("classifies values and names", () => {
    expect(valueKind("104")).toBe("numeric");
    expect(valueKind("SNK-TRAIL-01")).toBe("sku");
    expect(valueKind("TRAIL-RUNNER")).toBe("text");
    expect(valueKind("hello")).toBe("text");
    expect(varName("filter[brand]")).toBe("filter%5Bbrand%5D");
    expect(varName("")).toBe("v");
    expect(slug("  View product (JSON) ")).toBe("view-product-json");
    expect(slug("!!!")).toBe("x");
  });
});
