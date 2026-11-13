// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  formCsrfRules,
  isCsrfFieldName,
  metaCsrfRules,
  parseForms,
  sampleGetUrl,
} from "../src/forms.js";
import {
  attrValue,
  parseHtml,
  parseSelector,
  selectAll,
  selectOne,
  simpleSelector,
  text,
} from "../src/html.js";

const PAGE = `<html><head><meta name="csrf-token" content="m-123"><meta name="viewport" content="x"></head><body>
<div id="main" class="wrap">
  <ul class="list"><li class="card" data-id="1"><a href="/p/1">One</a><span class="price">£1.00</span></li>
  <li class="card hot" data-id="2"><a href="/p/2">Two</a></li></ul>
  <p class="note">Hello   <b>world</b></p>
</div>
<form id="search" action="/search"><label for="q">Find</label><input id="q" name="q"><input type="hidden" name="lang" value="en">
  <select name="sort"><option value="new">New</option><option value="price" selected>Price</option></select>
  <input type="checkbox" name="instock" value="1"><input type="submit" value="Go"></form>
<form method="POST" action="/checkout" class="co"><input type="hidden" name="csrf_token" value="tok"><input type="hidden" name="cartId" value="c1">
  <label>Notes <textarea name="notes"></textarea></label>
  <input type="radio" name="speed" value="slow"><input type="radio" name="speed" value="fast" checked>
  <select name="delivery" required><option>standard</option><option>express</option></select>
  <input name="ignored" disabled><input type="file" name="upload"><button>Place order</button></form>
<form method="post" action="/login"><input name="user" type="email" placeholder="Email"><input name="pw" type="password"><button type="submit">Sign in</button></form>
<form method="post" action="/login"><input name="other"></form>
<form method="post"><input name="noaction"></form>
</body></html>`;

describe("selector engine", () => {
  const doc = parseHtml(PAGE);
  it("matches type, id, class, attribute, child and descendant selectors", () => {
    expect(selectAll(doc, "li.card")).toHaveLength(2);
    expect(selectAll(doc, "li.card.hot")).toHaveLength(1);
    expect(selectAll(doc, "div#main > ul.list > li")).toHaveLength(2);
    expect(selectAll(doc, "div#main li a")).toHaveLength(2);
    expect(selectAll(doc, "div#main > li")).toHaveLength(0);
    expect(selectAll(doc, 'li[data-id="2"] a').map(text)).toEqual(["Two"]);
    expect(selectAll(doc, "li[data-id=1]")).toHaveLength(1);
    expect(selectAll(doc, "li[data-id='1']")).toHaveLength(1);
    expect(selectAll(doc, "[data-id]")).toHaveLength(2);
    expect(selectAll(doc, "* > b")).toHaveLength(1);
    expect(selectAll(doc, "b, a")).toHaveLength(3);
    expect(selectAll(doc, 'input[name="q"]')).toHaveLength(1);
  });
  it("scopes to an element and supports :scope", () => {
    const li = selectOne(doc, "li.card") as NonNullable<ReturnType<typeof selectOne>>;
    expect(selectAll(li, "a")).toHaveLength(1);
    expect(selectAll(li, "li")).toHaveLength(0);
    expect(selectAll(li, ":scope")).toEqual([li]);
    expect(selectAll(li, ":scope > a")).toHaveLength(1);
    expect(selectAll(li, "ul a")).toHaveLength(0);
    expect(selectAll(doc, ":scope")).toHaveLength(0);
  });
  it("rejects selectors outside the subset", () => {
    expect(() => parseSelector("a:hover")).toThrow(SyntaxError);
    expect(() => parseSelector("a + b")).toThrow(SyntaxError);
    expect(() => parseSelector("")).toThrow(SyntaxError);
    expect(() => parseSelector("a,")).toThrow(SyntaxError);
    expect(() => parseSelector(".1bad")).toThrow(SyntaxError);
    expect(() => parseSelector("[=x]")).toThrow(SyntaxError);
  });
  it("collapses text and builds simple selectors", () => {
    expect(text(selectOne(doc, "p.note") as never)).toBe("Hello world");
    expect(simpleSelector(selectOne(doc, "div#main") as never)).toBe("div#main");
    expect(simpleSelector(selectOne(doc, "li.hot") as never)).toBe("li.card.hot");
    expect(simpleSelector(selectOne(doc, "b") as never)).toBe("b");
    expect(attrValue('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(selectAll(parseHtml('<i data-x="a&quot;b"></i>'), 'i[data-x="a\\"b"]')).toHaveLength(1);
  });
});

describe("forms", () => {
  const forms = parseForms(PAGE, "https://shop.test/page");
  it("reads method, action, fields, options and submit labels", () => {
    expect(forms.map((f) => `${f.method} ${f.action} ${f.selector}`)).toEqual([
      "GET https://shop.test/search form#search",
      'POST https://shop.test/checkout form[action="/checkout"]',
      'POST https://shop.test/login form[action="/login"][method="post"]',
      'POST https://shop.test/login form[action="/login"][method="post"]',
      "POST https://shop.test/page form",
    ]);
    const search = forms[0];
    expect(search?.fields).toEqual([
      { name: "q", type: "text", required: false, hidden: false, label: "Find" },
      { name: "lang", type: "hidden", required: false, hidden: true, value: "en" },
      {
        name: "sort",
        type: "select",
        required: false,
        hidden: false,
        options: ["new", "price"],
        selected: "price",
        value: "price",
      },
      { name: "instock", type: "checkbox", required: false, hidden: false, options: ["1"] },
    ]);
    expect(search?.submitLabels).toEqual(["Go"]);
    const co = forms[1];
    expect(co?.fields.map((f) => f.name)).toEqual([
      "csrf_token",
      "cartId",
      "notes",
      "speed",
      "speed",
      "delivery",
    ]);
    expect(co?.fields.find((f) => f.name === "notes")?.label).toBe("Notes");
    expect(co?.fields.find((f) => f.name === "delivery")).toMatchObject({
      required: true,
      options: ["standard", "express"],
      selected: "standard",
    });
    expect(co?.submitLabels).toEqual(["Place order"]);
    expect(forms[2]?.hasPassword).toBe(true);
    expect(forms[2]?.fields[0]?.label).toBe("Email");
  });
  it("turns hidden anti-forgery fields into html CSRF rules", () => {
    expect(formCsrfRules(forms[1] as never, "https://shop.test/checkout")).toEqual([
      {
        source: {
          kind: "html",
          urlTemplate: "https://shop.test/checkout",
          selector: 'form[action="/checkout"] input[name="csrf_token"]',
          attribute: "value",
        },
        target: { kind: "form", name: "csrf_token" },
      },
    ]);
    expect(formCsrfRules(forms[0] as never, "x")).toEqual([]);
    expect(
      ["csrf_token", "authenticity_token", "_token", "XSRF", "__RequestVerificationToken"].every(
        isCsrfFieldName,
      ),
    ).toBe(true);
    expect(isCsrfFieldName("cartId")).toBe(false);
  });
  it("reads csrf meta tags", () => {
    expect(metaCsrfRules(PAGE, "https://shop.test/page")).toEqual([
      {
        source: { kind: "meta", urlTemplate: "https://shop.test/page", name: "csrf-token" },
        target: { kind: "header", name: "X-CSRF-Token" },
      },
    ]);
  });
  it("fills GET forms with sample values and refuses POST forms", () => {
    expect(sampleGetUrl(forms[0] as never, "trail")).toBe(
      "https://shop.test/search?q=trail&lang=en&sort=price",
    );
    expect(sampleGetUrl(forms[1] as never, "trail")).toBeUndefined();
    const [num] = parseForms(
      '<form action="/f?drop=1"><input name="n" type="number"><input name="v" value="keep"><select name="e"></select></form>',
      "https://shop.test/",
    );
    expect(sampleGetUrl(num as never, "w")).toBe("https://shop.test/f?n=1&v=keep&e=");
  });
  it("skips forms whose action does not parse", () => {
    expect(parseForms('<form action="http://[bad"></form>', "https://shop.test/")).toEqual([]);
  });
});
