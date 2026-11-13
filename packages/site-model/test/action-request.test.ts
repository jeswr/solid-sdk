// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  isSchemaActionType,
  jsonLdToQuads,
  parseActionRequest,
  SiteModelError,
} from "../src/index.js";

const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";

const BUY_TTL = `
@prefix schema: <https://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<https://planner.test/req#1> a schema:BuyAction ;
  schema:object [ a schema:Product ; schema:sku "TR-42" ; schema:name "Trail runner", "Trail runner" ] ;
  schema:priceSpecification [ schema:maxPrice "20.00"^^xsd:decimal ; schema:priceCurrency "GBP" ] ;
  schema:seller <https://shop.test/> .
`;

describe("parseActionRequest (Turtle)", () => {
  const request = parseActionRequest(BUY_TTL);

  it("picks the action node and its types", () => {
    expect(request.node).toBe("https://planner.test/req#1");
    expect(request.types).toEqual([`${S}BuyAction`]);
  });

  it("follows property paths to lexical values and IRIs", () => {
    expect(request.values([`${S}object`, `${S}sku`])).toEqual(["TR-42"]);
    expect(request.values([`${S}object`, `${S}name`])).toEqual(["Trail runner"]);
    expect(request.values([`${S}priceSpecification`, `${S}maxPrice`])).toEqual(["20.00"]);
    expect(request.values([`${S}seller`])).toEqual(["https://shop.test/"]);
    expect(request.values([`${S}seller`, `${S}name`])).toEqual([]);
    expect(request.values([`${S}object`, `${S}sku`, `${S}name`])).toEqual([]);
    expect(request.values([`${S}missing`])).toEqual([]);
    expect(request.values([])).toEqual(["https://planner.test/req#1"]);
  });

  it("returns blank nodes as _:labels", () => {
    const [object] = request.values([`${S}object`]);
    expect(object).toMatch(/^_:/);
  });

  it("normalises http schema.org in the data and in paths", () => {
    const http = parseActionRequest(`
      @prefix schema: <http://schema.org/> .
      [] a schema:SearchAction ; schema:query "boots" ; schema:object [ schema:category <http://schema.org/Shoes> ] .`);
    expect(http.types).toEqual([`${S}SearchAction`]);
    expect(http.node).toMatch(/^_:/);
    expect(http.values([`${S}query`])).toEqual(["boots"]);
    expect(http.values(["http://schema.org/query"])).toEqual(["boots"]);
    expect(http.values([`${S}object`, `${S}category`])).toEqual([`${S}Shoes`]);
  });

  it("keeps every type of the action node, sorted", () => {
    const r = parseActionRequest(`@prefix schema: <https://schema.org/> .
      <urn:x:1> a schema:Thing, schema:OrderAction .`);
    expect(r.types).toEqual([`${S}OrderAction`, `${S}Thing`]);
  });

  it("resolves relative IRIs against baseIRI", () => {
    const r = parseActionRequest(
      `@prefix schema: <https://schema.org/> . <#a> a schema:ViewAction ; schema:object <p/1> .`,
      {
        baseIRI: "https://planner.test/req",
      },
    );
    expect(r.node).toBe("https://planner.test/req#a");
    expect(r.values([`${S}object`])).toEqual(["https://planner.test/p/1"]);
  });

  it.each([
    [
      "no action",
      `@prefix schema: <https://schema.org/> . [] a schema:Product .`,
      /no node typed with a schema\.org action/,
    ],
    ["no types at all", `<urn:a> <urn:p> "x" .`, /no node typed/],
    [
      "two actions",
      `@prefix schema: <https://schema.org/> . [] a schema:BuyAction . [] a schema:SearchAction .`,
      /2 schema\.org action nodes/,
    ],
    ["a non-schema action class", `[] a <https://example.test/BuyAction> .`, /no node typed/],
    ["broken Turtle", "[] a", /could not parse the action request/],
  ])("errors on %s", (_name, ttl, message) => {
    expect(() => parseActionRequest(ttl)).toThrow(SiteModelError);
    expect(() => parseActionRequest(ttl)).toThrow(message);
  });
});

describe("isSchemaActionType", () => {
  it.each([
    [`${S}BuyAction`, true],
    ["http://schema.org/AddToCartAction", true],
    [`${S}Action`, true],
    [`${S}Product`, false],
    [`${S}ns/FakeAction`, false],
    ["https://example.test/BuyAction", false],
  ])("%s -> %s", (iri, expected) => {
    expect(isSchemaActionType(iri)).toBe(expected);
  });
});

describe("parseActionRequest (JSON-LD subset)", () => {
  const jsonld = (value: unknown, baseIRI?: string) =>
    parseActionRequest(JSON.stringify(value), {
      format: "application/ld+json",
      ...(baseIRI ? { baseIRI } : {}),
    });

  it("reads a planner's compact schema.org request", () => {
    const r = jsonld({
      "@context": "https://schema.org",
      "@type": "BuyAction",
      object: { "@type": "Product", sku: "TR-42", name: ["Trail runner"] },
      priceSpecification: { maxPrice: 20, priceCurrency: "GBP" },
      instrument: { "@id": "https://wallet.test/cards/1" },
      seller: null,
    });
    expect(r.types).toEqual([`${S}BuyAction`]);
    expect(r.node).toMatch(/^_:/);
    expect(r.values([`${S}object`, `${S}sku`])).toEqual(["TR-42"]);
    expect(r.values([`${S}object`, `${S}name`])).toEqual(["Trail runner"]);
    expect(r.values([`${S}priceSpecification`, `${S}maxPrice`])).toEqual(["20"]);
    expect(r.values([`${S}instrument`])).toEqual(["https://wallet.test/cards/1"]);
    expect(r.values([`${S}seller`])).toEqual([]);
  });

  it.each([
    "http://schema.org",
    "http://schema.org/",
    "https://schema.org/",
  ])("accepts the %s context", (context) => {
    expect(
      jsonld({ "@context": context, "@type": "SearchAction", query: "x" }).values([`${S}query`]),
    ).toEqual(["x"]);
  });

  it("supports inline contexts, prefixes, typed terms, value objects and @graph", () => {
    const r = jsonld(
      {
        "@context": [
          "https://schema.org",
          {
            ex: "https://example.test/ns#",
            when: { "@id": "startTime", "@type": "xsd:dateTime" },
            xsd: "http://www.w3.org/2001/XMLSchema#",
            ref: { "@id": "url", "@type": "@id" },
            kind: { "@type": "@vocab" },
            "@language": "en",
          },
        ],
        "@graph": [
          {
            "@id": "req",
            "@type": ["ReserveAction", "ex:Booking"],
            when: "2026-12-01T19:00:00Z",
            ref: "tables/7",
            kind: "Restaurant",
            "ex:party": 4,
            "ex:ratio": 0.5,
            "ex:vip": true,
            description: { "@value": "window seat", "@language": "en-GB" },
            "ex:code": { "@value": "A1", "@type": "xsd:token" },
            "ex:plain": { "@value": 7 },
            name: "Dinner",
          },
          { "@id": "_:other", name: "not an action" },
        ],
      },
      "https://planner.test/r/",
    );
    expect(r.node).toBe("https://planner.test/r/req");
    expect(r.types).toEqual(["https://example.test/ns#Booking", `${S}ReserveAction`]);
    expect(r.values([`${S}startTime`])).toEqual(["2026-12-01T19:00:00Z"]);
    expect(r.values([`${S}url`])).toEqual(["https://planner.test/r/tables/7"]);
    expect(r.values([`${S}kind`])).toEqual([`${S}Restaurant`]);
    expect(r.values(["https://example.test/ns#party"])).toEqual(["4"]);
    expect(r.values(["https://example.test/ns#ratio"])).toEqual(["0.5"]);
    expect(r.values(["https://example.test/ns#vip"])).toEqual(["true"]);
    expect(r.values([`${S}description`])).toEqual(["window seat"]);
    expect(r.values(["https://example.test/ns#code"])).toEqual(["A1"]);
    expect(r.values(["https://example.test/ns#plain"])).toEqual(["7"]);
  });

  it("produces the expected RDF terms", () => {
    const quads = jsonLdToQuads(
      JSON.stringify({
        "@context": { "@vocab": S, "@language": "en", n: { "@id": "num", "@type": `${X}decimal` } },
        "@id": "_:a",
        "@type": "BuyAction",
        name: "Shoes",
        n: 3,
        count: 2,
        ratio: 1.5,
        ok: false,
        friend: { "@id": "_:a" },
        nested: { "@context": null, "https://example.test/p": "x" },
      }),
    );
    const find = (p: string) => quads.find((q) => q.predicate.value === p)?.object;
    expect(find(`${S}name`)).toMatchObject({ termType: "Literal", value: "Shoes", language: "en" });
    expect(find(`${S}num`)).toMatchObject({ value: "3", datatype: { value: `${X}decimal` } });
    expect(find(`${S}count`)).toMatchObject({ value: "2", datatype: { value: `${X}integer` } });
    expect(find(`${S}ratio`)).toMatchObject({ value: "1.5", datatype: { value: `${X}double` } });
    expect(find(`${S}ok`)).toMatchObject({ value: "false", datatype: { value: `${X}boolean` } });
    expect(find(`${S}friend`)?.equals(quads[0]?.subject)).toBe(true);
    expect(find("https://example.test/p")).toMatchObject({
      termType: "Literal",
      value: "x",
      language: "",
    });
  });

  it.each([
    ["invalid JSON", "{", /not valid JSON/],
    [
      "a remote context",
      { "@context": "https://example.test/ctx", "@type": "BuyAction" },
      /remote context/,
    ],
    [
      "@list",
      { "@context": "https://schema.org", "@type": "BuyAction", object: { "@list": [1] } },
      /keyword @list/,
    ],
    [
      "@reverse",
      { "@context": "https://schema.org", "@type": "BuyAction", "@reverse": {} },
      /keyword @reverse/,
    ],
    [
      "containers",
      { "@context": { "@vocab": S, x: { "@container": "@set" } }, "@type": "BuyAction" },
      /term definition key @container/,
    ],
    [
      "named graphs",
      { "@context": "https://schema.org", "@id": "urn:g", "@graph": [], name: "x" },
      /named graphs/,
    ],
    ["a scalar at the top", "42", /top-level values must be node objects/],
    [
      "nested arrays",
      { "@context": "https://schema.org", "@type": "BuyAction", object: [[1]] },
      /nested arrays/,
    ],
    ["an unexpandable term", { "@type": "BuyAction" }, /cannot expand "BuyAction" without @vocab/],
    [
      "a relative @id without a base",
      { "@context": "https://schema.org", "@id": "req", "@type": "BuyAction" },
      /without a base IRI/,
    ],
    [
      "a non-string @id",
      { "@context": "https://schema.org", "@id": 4, "@type": "BuyAction" },
      /@id must be a string/,
    ],
    [
      "a non-string @type",
      { "@context": "https://schema.org", "@type": [4] },
      /@type values must be strings/,
    ],
    [
      "a bad value object",
      {
        "@context": "https://schema.org",
        "@type": "BuyAction",
        name: { "@value": "x", "@index": "y" },
      },
      /value object key @index/,
    ],
    [
      "@type with @language",
      {
        "@context": "https://schema.org",
        "@type": "BuyAction",
        name: { "@value": "x", "@type": "Text", "@language": "en" },
      },
      /together/,
    ],
    [
      "a non-scalar @value",
      { "@context": "https://schema.org", "@type": "BuyAction", name: { "@value": [] } },
      /@value must be a scalar/,
    ],
    [
      "a numeric @language",
      {
        "@context": "https://schema.org",
        "@type": "BuyAction",
        name: { "@value": "x", "@language": 4 },
      },
      /must be strings/,
    ],
    [
      "a context keyword",
      { "@context": { "@protected": true }, "@type": "x" },
      /context keyword @protected/,
    ],
    ["a numeric context", { "@context": 4 }, /a context must be/],
    ["a numeric @vocab", { "@context": { "@vocab": 4 } }, /@vocab must be a string/],
    ["a numeric @base", { "@context": { "@base": 4 } }, /@base must be a string/],
    [
      "a numeric default language",
      { "@context": { "@language": 4 } },
      /@language must be a string/,
    ],
    ["@version 1.0", { "@context": { "@version": 1.0 } }, /@version must be 1.1/],
    ["a numeric term definition", { "@context": { a: 4 } }, /term definition for "a"/],
    [
      "a blank-node property",
      { "@context": { "@vocab": S, p: "_:p" }, "@type": "BuyAction", p: "x" },
      /expands to a blank node/,
    ],
  ])("rejects %s", (_name, value, message) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    expect(() => parseActionRequest(text, { format: "application/ld+json" })).toThrow(
      SiteModelError,
    );
    expect(() => parseActionRequest(text, { format: "application/ld+json" })).toThrow(message);
  });

  it("resets and nulls context entries", () => {
    const r = jsonld({
      "@context": [
        {
          "@vocab": "https://example.test/",
          "@base": "https://b.test/",
          "@language": "fr",
          x: "https://example.test/x",
        },
        { "@vocab": null, "@base": null, "@language": null, x: null },
        "https://schema.org",
      ],
      "@type": "BuyAction",
      x: "y",
    });
    expect(r.values([`${S}x`])).toEqual(["y"]);
  });

  it("expands terms defined by @vocab-relative ids and compact IRIs", () => {
    const r = jsonld({
      "@context": { "@vocab": S, s: S, price: {}, "@base": "https://b.test/" },
      "@id": "x",
      "@type": "s:BuyAction",
      price: "3",
      "s:name": "n",
      "https://example.test/abs": "a",
      "s://not-a-prefix": "b",
    });
    expect(r.node).toBe("https://b.test/x");
    expect(r.values([`${S}price`])).toEqual(["3"]);
    expect(r.values([`${S}name`])).toEqual(["n"]);
    expect(r.values(["https://example.test/abs"])).toEqual(["a"]);
    expect(r.values(["s://not-a-prefix"])).toEqual(["b"]);
  });
});
