// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { compactIri, renderCatalogue, type SiteModel, shortName } from "../src/index.js";
import { model, S, search } from "./fixtures.js";

describe("renderCatalogue", () => {
  const catalogue = renderCatalogue(model);

  it("lists flows, then operations, one line each, in model order", () => {
    expect(catalogue.split("\n")).toEqual([
      'buy  BuyAction  payment  inputs: object/sku(schema:Product, required) object/orderQuantity(xsd:integer) priceSpecification/maxPrice(xsd:decimal, required)  "Buy a product"',
      'search  SearchAction  read  inputs: query(xsd:string, required) object/additionalProperty(xsd:string, one of "relevance"|"price-asc"|"price-desc")  "Search products"',
      'view-product  ViewAction  read  inputs: object/identifier(schema:Product, required)  "View a product"',
      'add-to-cart  AddToCartAction  reversible-write  inputs: object/sku(xsd:string, required) object/orderQuantity(xsd:integer)  "Add to cart"',
      'checkout  PayAction  payment  inputs: price(xsd:decimal)  "Place order"',
      'sign-in  LoginAction  reversible-write  inputs: agent/email(xsd:string, required)  "Sign in"',
    ]);
  });

  it("never shows URLs, templates, CSRF or session details", () => {
    expect(catalogue).not.toMatch(/https?:\/\//);
    expect(catalogue).not.toMatch(/\{|csrf|token|cookie|signed-in|session/i);
    expect(catalogue).not.toContain("page");
    expect(catalogue).not.toContain("Full-text product search");
  });

  it("is deterministic", () => {
    expect(renderCatalogue(structuredClone(model))).toBe(catalogue);
  });

  it("shows foreign IRIs by short name and handles inputless actions", () => {
    const odd: SiteModel = {
      ...model,
      flows: [],
      operations: [
        {
          ...search,
          id: "https://shop.test/ops/find",
          actionType: "https://example.test/vocab#FindAction",
          inputs: [
            {
              name: "a",
              path: ["https://example.test/vocab#colour", `${search.inputs[0]?.path[0]}`],
              range: "https://example.test/vocab#Colour",
              required: false,
              location: "query",
            },
            { name: "b", path: [], range: `${S}Text`, required: true, location: "query" },
          ],
        },
        { ...search, id: "urn:op:none", inputs: [] },
      ],
    };
    expect(renderCatalogue(odd).split("\n")).toEqual([
      'find  FindAction  read  inputs: colour/query(Colour)  "Search products"',
      'none  SearchAction  read  inputs: none  "Search products"',
    ]);
  });
});

describe("compactIri and shortName", () => {
  it.each([
    [`${S}Product`, "schema:Product"],
    ["http://www.w3.org/2001/XMLSchema#integer", "xsd:integer"],
    ["https://jeswr.org/ns/site-action#Payment", "sab:Payment"],
    [`${S}a/b`, "b"],
    ["https://example.test/x/Thing", "Thing"],
  ])("compactIri(%s) = %s", (iri, expected) => {
    expect(compactIri(iri)).toBe(expected);
  });

  it.each([
    ["https://shop.test/m#buy", "buy"],
    ["https://shop.test/ops/buy/", "buy"],
    ["https://shop.test/m#", "m"],
    ["urn:op:x", "x"],
    ["", ""],
  ])("shortName(%s) = %s", (iri, expected) => {
    expect(shortName(iri)).toBe(expected);
  });
});
