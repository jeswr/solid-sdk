// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import { Parser, Writer } from "n3";
import { describe, expect, it } from "vitest";
import {
  readSiteModel,
  renderCatalogue,
  SiteModelError,
  SKOLEM_PREFIX,
  validateSiteModel,
  writeSiteModel,
} from "../src/index.js";
import { M, model, S, X } from "./fixtures.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const example = /```turtle\n([\s\S]*?)```/.exec(readme)?.[1] as string;

const PREFIXES = `
@prefix sab: <https://jeswr.org/ns/site-action#> .
@prefix schema: <https://schema.org/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;
const HEAD = `${PREFIXES}
<https://a.test/m#it> a sab:SiteModel ; schema:url <https://a.test> ; schema:version "1" ;
  prov:generatedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime`;
const OP = (
  extra = "",
  request = `[ a schema:EntryPoint ; schema:httpMethod "GET" ; schema:urlTemplate "https://a.test/" ]`,
) => `
<https://a.test/m#op> a sab:Operation ; sab:actionType schema:ViewAction ; schema:name "Home" ;
  schema:target ${request} ; sab:session sab:NoSession ; sab:effect sab:Read ;
  prov:generatedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime ; sab:learnMethod "crawl" ; sab:confidence 1.0 ${extra} .`;

describe("readSiteModel on the README worked example", () => {
  const read = readSiteModel(example);

  it("reads blank-node children through skolem IRIs", () => {
    expect(read.id).toBe(`${M}#model`);
    expect(read.site).toBe("https://shop.test");
    expect(read.generatedAt).toBe("2026-11-13T10:00:00.000Z");
    expect(read.operations.map((o) => o.id)).toEqual([`${M}#add-to-cart`, `${M}#checkout`]);
    const add = read.operations[0];
    expect(add?.inputs).toEqual([
      {
        name: "sku",
        path: [`${S}object`, `${S}sku`],
        range: `${X}string`,
        required: true,
        location: "body",
      },
    ]);
    expect(add?.request).toEqual({
      method: "POST",
      urlTemplate: "https://shop.test/api/cart",
      contentType: "application/json",
      bodyTemplate: '{"sku": {sku}}',
    });
    expect(add?.session).toBe("signed-in");
    expect(add?.csrf).toEqual([
      {
        source: { kind: "cookie", name: "csrftoken" },
        target: { kind: "header", name: "X-CSRF-Token" },
      },
    ]);
    expect(add?.provenance).toEqual({
      derivedFrom: ["urn:uuid:5f0c2a9e-7d1b-4c3a-9e8f-0a1b2c3d4e5f"],
      learnedAt: "2026-11-01T09:30:00.000Z",
      method: "demonstration",
      confidence: 0.95,
    });
    expect(read.flows[0]?.steps).toEqual([
      { operation: `${M}#add-to-cart`, bind: { sku: "$input.sku" } },
      { operation: `${M}#checkout`, bind: { cart: `$step0.${S}orderNumber` } },
    ]);
    expect(read.login).toBeUndefined();
  });

  it("is valid and renders the documented catalogue", () => {
    expect(validateSiteModel(read)).toEqual([]);
    const documented = /renderCatalogue\(model\);\n((?:\/\/ .*\n)+)/.exec(readme)?.[1] as string;
    expect(renderCatalogue(read)).toBe(documented.replace(/^\/\/ /gm, "").trimEnd());
  });

  it("rewrites to named nodes and reads back the same model", async () => {
    const ttl = await writeSiteModel(read);
    expect(ttl).not.toContain(SKOLEM_PREFIX);
    expect(readSiteModel(ttl)).toEqual(read);
  });
});

describe("readSiteModel inputs", () => {
  it("accepts quads, N-Triples and the JSON-LD subset", async () => {
    const quads = new Parser().parse(await writeSiteModel(model));
    expect(readSiteModel(quads)).toEqual(model);
    const nt = new Writer({ format: "N-Triples" }).quadsToString(quads);
    expect(readSiteModel(nt, { format: "application/n-triples" })).toEqual(model);
    const jsonld = JSON.stringify({
      "@context": {
        "@vocab": "https://jeswr.org/ns/site-action#",
        schema: "https://schema.org/",
        prov: "http://www.w3.org/ns/prov#",
        xsd: "http://www.w3.org/2001/XMLSchema#",
      },
      "@id": "https://a.test/m#it",
      "@type": "SiteModel",
      "schema:url": { "@id": "https://a.test" },
      "schema:version": "2",
      "prov:generatedAtTime": { "@value": "2026-01-01T00:00:00Z", "@type": "xsd:dateTime" },
    });
    expect(readSiteModel(jsonld, { format: "application/ld+json" })).toMatchObject({
      site: "https://a.test",
      version: "2",
      operations: [],
    });
  });

  it("resolves relative IRIs against baseIRI", () => {
    const ttl = `${PREFIXES} <#it> a sab:SiteModel ; schema:url <https://a.test> ; schema:version "1" ; prov:generatedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime .`;
    expect(readSiteModel(ttl, { baseIRI: "https://a.test/model" }).id).toBe(
      "https://a.test/model#it",
    );
  });

  it("normalises http schema.org IRIs", () => {
    const ttl = `${HEAD} ; schema:potentialAction <https://a.test/m#op> .
      ${OP()}`.replace(
      "@prefix schema: <https://schema.org/>",
      "@prefix schema: <http://schema.org/>",
    );
    expect(ttl).toContain("<http://schema.org/>");
    const read = readSiteModel(ttl);
    expect(read.operations[0]?.actionType).toBe(`${S}ViewAction`);
    expect(read.operations[0]?.request.urlTemplate).toBe("https://a.test/");
  });

  it("rejects an integer confidence (the range is xsd:decimal)", () => {
    const ttl = `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP().replace("sab:confidence 1.0", "sab:confidence 1")}`;
    expect(() => readSiteModel(ttl)).toThrow(/not a valid Operation/);
  });

  it("orders unpositioned nodes by IRI after positioned ones", () => {
    const ttl = `${HEAD} ; schema:potentialAction <https://a.test/m#op>, <https://a.test/m#b>, <https://a.test/m#a> .
      ${OP()}
      ${OP("; schema:position 0").replace("m#op", "m#b")}
      ${OP().replace("m#op", "m#a")}`;
    expect(readSiteModel(ttl).operations.map((o) => o.id)).toEqual([
      "https://a.test/m#b",
      "https://a.test/m#a",
      "https://a.test/m#op",
    ]);
  });
});

describe("readSiteModel errors", () => {
  const bad: [string, string, RegExp][] = [
    ["no site model", PREFIXES, /exactly one sab:SiteModel, found 0/],
    ["two site models", `${HEAD} . <https://a.test/m#two> a sab:SiteModel .`, /found 2/],
    [
      "a missing required field",
      `${PREFIXES} <https://a.test/m#it> a sab:SiteModel ; schema:url <https://a.test> .`,
      /<https:\/\/a\.test\/m#it> is not a valid SiteModel/,
    ],
    [
      "an untyped action",
      `${HEAD} ; schema:potentialAction <https://a.test/m#x> .`,
      /neither a sab:Operation nor a sab:Flow/,
    ],
    [
      "an operation without a request",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP().replace(/schema:target \[[^\]]*\] ;/, "")}`,
      /not a valid Operation/,
    ],
    [
      "a malformed request",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP("", '[ a schema:EntryPoint ; schema:httpMethod "FETCH" ; schema:urlTemplate "https://a.test/" ]')}`,
      /not a valid EntryPoint/,
    ],
    [
      "an unknown effect",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP().replace("sab:Read", "sab:Explode")}`,
      /not a valid Operation/,
    ],
    [
      "a cookie CSRF source without a name",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:csrfRule [ a sab:CsrfRule ; sab:csrfSource [ a sab:CsrfSource ; sab:sourceKind "cookie" ] ; sab:csrfTarget [ a sab:CsrfTarget ; sab:targetKind "header" ; schema:name "X" ] ]')}`,
      /of kind cookie needs schema:name/,
    ],
    [
      "an html CSRF source without a selector",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:csrfRule [ a sab:CsrfRule ; sab:csrfSource [ a sab:CsrfSource ; sab:sourceKind "html" ; schema:urlTemplate "https://a.test/" ; sab:attribute "value" ] ; sab:csrfTarget [ a sab:CsrfTarget ; sab:targetKind "form" ; schema:name "t" ] ]')}`,
      /of kind html needs sab:selector/,
    ],
    [
      "a json CSRF source without a pointer",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:csrfRule [ a sab:CsrfRule ; sab:csrfSource [ a sab:CsrfSource ; sab:sourceKind "json" ; schema:urlTemplate "https://a.test/" ] ; sab:csrfTarget [ a sab:CsrfTarget ; sab:targetKind "form" ; schema:name "t" ] ]')}`,
      /of kind json needs sab:pointer/,
    ],
    [
      "a meta CSRF source without a template",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:csrfRule [ a sab:CsrfRule ; sab:csrfSource [ a sab:CsrfSource ; sab:sourceKind "meta" ; schema:name "csrf" ] ; sab:csrfTarget [ a sab:CsrfTarget ; sab:targetKind "form" ; schema:name "t" ] ]')}`,
      /of kind meta needs schema:urlTemplate/,
    ],
    [
      "two value paths",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:input [ a sab:Parameter ; schema:valueName "q" ; sab:valuePath schema:query, schema:name ; sab:range xsd:string ; schema:valueRequired true ; sab:location "query" ]')}`,
      /2 values for <https:\/\/jeswr\.org\/ns\/site-action#valuePath>/,
    ],
    [
      "a value path list of literals",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:input [ a sab:Parameter ; schema:valueName "q" ; sab:valuePath ( "a" "b" ) ; sab:range xsd:string ; schema:valueRequired true ; sab:location "query" ]')}`,
      /malformed value path list/,
    ],
    [
      "an options value that is not a list",
      `${HEAD} ; schema:potentialAction <https://a.test/m#op> . ${OP('; sab:input [ a sab:Parameter ; schema:valueName "q" ; sab:option "a" ; sab:range xsd:string ; schema:valueRequired true ; sab:location "query" ]')}`,
      /malformed options list/,
    ],
    [
      "a repeated binding name",
      `${HEAD} ; schema:potentialAction <https://a.test/m#f> . <https://a.test/m#f> a sab:Flow ; sab:actionType schema:BuyAction ; schema:name "B" ; sab:effect sab:Read ; prov:generatedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime ; sab:learnMethod "manual" ; sab:confidence 1.0 ; sab:step [ a sab:FlowStep ; schema:position 0 ; sab:operation <https://a.test/m#op> ; sab:binding [ a schema:PropertyValue ; schema:name "q" ; schema:value "1" ], [ a schema:PropertyValue ; schema:name "q" ; schema:value "2" ] ] .`,
      /repeats the name "q"/,
    ],
    ["invalid Turtle", "this is not turtle", /could not parse the site model as text\/turtle/],
  ];
  it.each(bad)("%s", (_name, ttl, message) => {
    expect(() => readSiteModel(ttl)).toThrow(SiteModelError);
    expect(() => readSiteModel(ttl)).toThrow(message);
  });
});
