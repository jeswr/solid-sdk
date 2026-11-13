// AUTHORED-BY Claude Opus 5.5
// A fictional shop (shop.test). Every value is invented.
import type { Operation, SiteModel } from "../src/index.js";

export const S = "https://schema.org/";
export const X = "http://www.w3.org/2001/XMLSchema#";
export const M = "https://shop.test/.well-known/site-model";

const prov = (method: Operation["provenance"]["method"], confidence: number) => ({
  derivedFrom: ["urn:uuid:3b1f8a52-0c55-4f3e-9d1e-1a2b3c4d5e6f"],
  learnedAt: "2026-11-01T09:30:00.000Z",
  method,
  confidence,
});

export const search: Operation = {
  id: `${M}#search`,
  actionType: `${S}SearchAction`,
  label: "Search products",
  description: "Full-text product search.",
  inputs: [
    {
      name: "q",
      path: [`${S}query`],
      range: `${X}string`,
      required: true,
      location: "query",
      example: "trail shoes",
    },
    {
      name: "page",
      path: [],
      range: `${X}integer`,
      required: false,
      location: "query",
      default: "1",
    },
    {
      name: "sort",
      path: [`${S}object`, `${S}additionalProperty`],
      range: `${X}string`,
      required: false,
      location: "query",
      options: ["relevance", "price-asc", "price-desc"],
      default: "relevance",
      description: "Result order.",
    },
  ],
  request: {
    method: "GET",
    urlTemplate: "https://shop.test/api/search{?q,page,sort}",
    headers: { Accept: "application/json", "X-Requested-With": "fetch" },
  },
  session: "none",
  effect: "read",
  extraction: {
    format: "json",
    itemPath: "/results",
    itemType: `${S}Product`,
    idField: `${S}url`,
    fields: [
      { property: `${S}url`, path: "/href", datatype: "iri" },
      { property: `${S}name`, path: "/title", datatype: `${X}string` },
      { property: `${S}sku`, path: "/sku" },
      { property: `${S}price`, path: "/price/amount", datatype: `${X}decimal` },
      { property: `${S}description`, path: "/blurb", untrusted: true },
      { property: `${S}disambiguatingDescription`, path: "/tagline", untrusted: false },
    ],
  },
  returnsShape: "https://shop.test/.well-known/shapes#ProductList",
  provenance: {
    ...prov("crawl", 0.92),
    lastVerified: "2026-11-12T08:00:00.000Z",
    successes: 41,
    attempts: 42,
  },
};

export const viewProduct: Operation = {
  id: `${M}#view-product`,
  actionType: `${S}ViewAction`,
  label: "View a product",
  inputs: [
    {
      name: "slug",
      path: [`${S}object`, `${S}identifier`],
      range: `${S}Product`,
      required: true,
      location: "path",
    },
  ],
  request: { method: "GET", urlTemplate: "https://shop.test/p/{slug}" },
  session: "none",
  effect: "read",
  extraction: {
    format: "html",
    itemType: `${S}Product`,
    fields: [
      { property: `${S}name`, path: "h1.title" },
      { property: `${S}image`, path: "img.hero", attribute: "src", datatype: "iri" },
      { property: `${S}review`, path: ".review p", untrusted: true },
    ],
  },
  provenance: prov("form", 0.7),
};

export const addToCart: Operation = {
  id: `${M}#add-to-cart`,
  actionType: `${S}AddToCartAction`,
  label: "Add to cart",
  inputs: [
    {
      name: "sku",
      path: [`${S}object`, `${S}sku`],
      range: `${X}string`,
      required: true,
      location: "body",
    },
    {
      name: "quantity",
      path: [`${S}object`, `${S}orderQuantity`],
      range: `${X}integer`,
      required: false,
      location: "body",
      default: "1",
    },
  ],
  request: {
    method: "POST",
    urlTemplate: "https://shop.test/api/cart",
    contentType: "application/json",
    bodyTemplate: '{"sku": {sku}, "qty": {quantity}}',
  },
  session: "signed-in",
  csrf: [
    {
      source: { kind: "cookie", name: "csrftoken" },
      target: { kind: "header", name: "X-CSRF-Token" },
    },
  ],
  effect: "reversible-write",
  extraction: {
    format: "json",
    itemType: `${S}Order`,
    fields: [{ property: `${S}orderNumber`, path: "/cartId" }],
  },
  provenance: prov("demonstration", 0.95),
};

export const checkout: Operation = {
  id: `${M}#checkout`,
  actionType: `${S}PayAction`,
  label: "Place order",
  inputs: [
    { name: "cart", path: [], range: `${X}string`, required: true, location: "form" },
    {
      name: "maxPrice",
      path: [`${S}price`],
      range: `${X}decimal`,
      required: false,
      location: "form",
    },
  ],
  request: {
    method: "POST",
    urlTemplate: "https://shop.test/checkout",
    contentType: "application/x-www-form-urlencoded",
  },
  session: "signed-in",
  csrf: [
    {
      source: {
        kind: "html",
        urlTemplate: "https://shop.test/checkout",
        selector: "input[name=_token]",
        attribute: "value",
      },
      target: { kind: "form", name: "_token" },
    },
    {
      source: { kind: "json", urlTemplate: "https://shop.test/api/session", pointer: "/csrf" },
      target: { kind: "query", name: "nonce" },
    },
  ],
  effect: "payment",
  provenance: prov("demonstration", 0.88),
};

export const signIn: Operation = {
  id: `${M}#sign-in`,
  actionType: `${S}LoginAction`,
  label: "Sign in",
  inputs: [
    {
      name: "email",
      path: [`${S}agent`, `${S}email`],
      range: `${X}string`,
      required: true,
      location: "form",
    },
    { name: "password", path: [], range: `${X}string`, required: true, location: "form" },
  ],
  request: {
    method: "POST",
    urlTemplate: "https://shop.test/login",
    contentType: "multipart/form-data",
  },
  session: "none",
  csrf: [
    {
      source: { kind: "meta", urlTemplate: "https://shop.test/login", name: "csrf-token" },
      target: { kind: "form", name: "authenticity_token" },
    },
  ],
  effect: "reversible-write",
  provenance: prov("manual", 1),
};

export const model: SiteModel = {
  id: `${M}#model`,
  site: "https://shop.test",
  version: "1.4.0",
  generatedAt: "2026-11-13T10:00:00.000Z",
  operations: [search, viewProduct, addToCart, checkout, signIn],
  flows: [
    {
      id: `${M}#buy`,
      actionType: `${S}BuyAction`,
      label: "Buy a product",
      description: "Add one product to the cart and pay for it.",
      inputs: [
        {
          name: "sku",
          path: [`${S}object`, `${S}sku`],
          range: `${S}Product`,
          required: true,
          location: "body",
        },
        {
          name: "quantity",
          path: [`${S}object`, `${S}orderQuantity`],
          range: `${X}integer`,
          required: false,
          location: "body",
        },
        {
          name: "maxPrice",
          path: [`${S}priceSpecification`, `${S}maxPrice`],
          range: `${X}decimal`,
          required: true,
          location: "form",
        },
      ],
      steps: [
        { operation: addToCart.id, bind: { sku: "$input.sku", quantity: "$input.quantity" } },
        {
          operation: checkout.id,
          bind: { cart: `$step0.${S}orderNumber`, maxPrice: "$input.maxPrice" },
        },
      ],
      effect: "payment",
      provenance: { ...prov("demonstration", 0.9), successes: 3, attempts: 3 },
    },
  ],
  login: [
    { method: "password", operation: signIn.id, sessionCookies: ["remember_me", "session_id"] },
    {
      method: "sso:google",
      probeUrl: "https://shop.test/api/me",
      refresh: {
        urlTemplate: "https://shop.test/oauth/refresh",
        tokenPointer: "/access_token",
        expiresInPointer: "/expires_in",
      },
    },
    {
      method: "passkey",
      refresh: { urlTemplate: "https://shop.test/token", tokenPointer: "/token" },
    },
  ],
};
