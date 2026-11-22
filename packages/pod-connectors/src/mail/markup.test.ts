// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { extractEmailMarkup } from "./markup.js";
import { EMAIL_MARKUP_TYPES, emailMarkupTrust, MARKUP_PROPERTIES } from "./markup-types.js";

const ld = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
describe("email markup", () => {
  it.each(EMAIL_MARKUP_TYPES)("extracts %s as JSON-LD and nested microdata", (type) => {
    const item = { "@context": "https://schema.org", "@type": type, name: "Synthetic booking" };
    expect(extractEmailMarkup(ld(item))).toEqual([
      { type, properties: { name: ["Synthetic booking"] } },
    ]);
    expect(
      extractEmailMarkup(
        `<div itemscope itemtype="http://schema.org/${type}/"><span itemprop=name>Synthetic <b>booking</b></span></div>`,
      ),
    ).toEqual([{ type, properties: { name: ["Synthetic booking"] } }]);
  });
  it("requires aligned stored authentication", () => {
    expect(emailMarkupTrust()).toBe("unverified");
    expect(emailMarkupTrust({ dmarc: "pass" })).toBe("verified");
    expect(emailMarkupTrust({ spf: "pass", dkim: "pass" })).toBe("unverified");
    expect(
      emailMarkupTrust({ spf: "pass", dkim: "pass", spfAligned: true, dkimAligned: true }),
    ).toBe("verified");
  });
});

import { vi } from "vitest";
import {
  EMAIL_MARKUP_FIXTURES,
  jsonLdFixture,
  microdataFixture,
} from "../../test-support/markup-fixtures.js";
import {
  DEFAULT_MARKUP_MAX_BYTES,
  MAX_MARKUP_BYTES,
  MAX_MARKUP_SCRIPTS,
  MAX_MARKUP_STRING,
} from "./markup.js";

describe("transactional fixtures", () => {
  it.each(
    EMAIL_MARKUP_FIXTURES,
  )("retains realistic $@type structures in both encodings", (fixture) => {
    const json = extractEmailMarkup(jsonLdFixture(fixture));
    expect(json).toHaveLength(1);
    expect(extractEmailMarkup(microdataFixture(fixture))).toEqual(json);
    expect(json[0]?.type).toBe(fixture["@type"]);
  });
  it("keeps nested offers, order lines and parcel deliveries", () => {
    const order = extractEmailMarkup(ld(EMAIL_MARKUP_FIXTURES[0]))[0];
    expect(order?.properties.acceptedOffer?.[0]).toMatchObject({
      type: "Offer",
      properties: { price: ["39.95"] },
    });
    expect(order?.properties.orderedItem?.[0]).toMatchObject({ type: "OrderItem" });
    expect(order?.properties.orderDelivery?.[0]).toMatchObject({ type: "ParcelDelivery" });
  });
});
describe("hostile and ambiguous markup", () => {
  const order = { "@type": "Order", orderNumber: "TEST-42" };
  it("handles graphs, arrays, both schema spellings, @type arrays and implied context", () => {
    expect(
      extractEmailMarkup(
        ld({
          "@context": "http://schema.org/",
          "@graph": [
            [{ ...order, "@type": ["Unknown", "https://schema.org/Order/"] }],
            { "@graph": [order] },
          ],
        }),
      ),
    ).toHaveLength(2);
    expect(
      extractEmailMarkup(ld({ ...order, "@context": { "@vocab": "https://schema.org/" } })),
    ).toHaveLength(1);
  });
  it.each([
    "https://evil.example.test",
    "https://schema.org.evil.test/",
    { Order: "https://evil.test/Order" },
    null,
    ["https://schema.org", "https://evil.test/"],
  ])("refuses foreign or redefining context %j", (context) => {
    expect(extractEmailMarkup(ld({ ...order, "@context": context }))).toEqual([]);
    expect(extractEmailMarkup(ld({ "@context": context, "@graph": [order] }))).toEqual([]);
  });
  it("refuses foreign types, aliases and nested foreign definitions", () => {
    expect(extractEmailMarkup(ld({ ...order, "@type": "https://evil.test/Order" }))).toEqual([]);
    expect(extractEmailMarkup(ld({ ...order, "@type": "schema:Order" }))).toEqual([]);
    expect(
      extractEmailMarkup(
        ld({
          ...order,
          seller: { "@context": "https://evil.test/", "@type": "Organization", name: "Spoof" },
          unknown: "ignored",
        }),
      )[0]?.properties,
    ).toEqual({ orderNumber: ["TEST-42"] });
    expect(
      extractEmailMarkup(
        '<div itemscope itemtype="Order"><meta itemprop=orderNumber content=test></div>',
      ),
    ).toEqual([]);
  });
  it("bounds malformed JSON before JSON.parse and continues to a later valid block", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      const deep =
        '<script type="application/ld+json">' +
        "[".repeat(10000) +
        "0" +
        "]".repeat(10000) +
        "</script>";
      const huge = ld({ ...order, name: "x".repeat(MAX_MARKUP_STRING * 6 + 1) });
      expect(
        extractEmailMarkup(
          `${deep + huge}<script type="application/ld+json">{bad}</script>${ld(order)}`,
        ),
      ).toHaveLength(1);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      parse.mockRestore();
    }
  });
  it("caps script count, node count, scalar size and returned items", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(extractEmailMarkup(ld(order).repeat(100))).toHaveLength(MAX_MARKUP_SCRIPTS);
      expect(parse).toHaveBeenCalledTimes(MAX_MARKUP_SCRIPTS);
    } finally {
      parse.mockRestore();
    }
    expect(
      extractEmailMarkup(ld(Array.from({ length: 5000 }, () => order)), { maxItems: 1000 }),
    ).toHaveLength(1000);
    expect(
      extractEmailMarkup(ld([{ ...order, name: "x".repeat(MAX_MARKUP_STRING + 1) }, order]), {
        maxItems: 1,
      }),
    ).toEqual([{ type: "Order", properties: { orderNumber: ["TEST-42"] } }]);
    expect(extractEmailMarkup(ld(order), { maxItems: 0 })).toEqual([]);
  });
  it("counts UTF-8 bytes and refuses oversized HTML without encoding an unbounded input", () => {
    const html = ld(order);
    expect(
      extractEmailMarkup(html, { maxBytes: new TextEncoder().encode(html).length }),
    ).toHaveLength(1);
    expect(extractEmailMarkup(html, { maxBytes: html.length - 1 })).toEqual([]);
    expect(extractEmailMarkup("é".repeat(50) + html, { maxBytes: html.length + 50 })).toEqual([]);
    expect(extractEmailMarkup("x".repeat(DEFAULT_MARKUP_MAX_BYTES) + html)).toEqual([]);
    expect(
      extractEmailMarkup("x".repeat(MAX_MARKUP_BYTES) + html, {
        maxBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual([]);
  });
  it.each([-1, NaN, Infinity, 1.5])("rejects invalid limits %s", (limit) => {
    expect(() => extractEmailMarkup(ld(order), { maxItems: limit })).toThrow(TypeError);
    expect(() => extractEmailMarkup(ld(order), { maxBytes: limit })).toThrow(TypeError);
  });
  it("treats comments, raw blocks, external scripts and HTML attributes as inert", () => {
    const html = `<!--${ld(order)}--><style>${ld(order)}</style><textarea>${ld(order)}</textarea><div title='${ld(order)}'></div><script src="https://evil.test/a" type="application/ld+json">${JSON.stringify(order)}</script>`;
    expect(extractEmailMarkup(html)).toEqual([]);
    expect(
      extractEmailMarkup(
        `<script type="application/ld+json">${JSON.stringify(order)}</scriptX>${ld(order)}`,
      ),
    ).toEqual([]);
    expect(extractEmailMarkup(`İ${ld(order)}`)).toHaveLength(1);
  });
  it("handles quoted >, entities, boolean scopes, properties on void tags and nested scopes", () => {
    const html =
      '<DIV ITEMSCOPE ITEMTYPE="https://schema.org/Order"><span itemprop="name" title="x > y">A &amp; B &#x1f600;</span><div itemprop=seller itemscope itemtype="https://schema.org/Organization"><span itemprop=name>Retailer</span></div><meta itemprop="orderNumber identifier" content="42"><a itemprop=url href="https://shop.example.test/?a=1&amp;b=2">View</a><time itemprop=orderDate datetime="2026-12-01">Today</time></DIV>';
    expect(extractEmailMarkup(html)).toEqual([
      {
        type: "Order",
        properties: {
          name: ["A & B 😀"],
          seller: [{ type: "Organization", properties: { name: ["Retailer"] } }],
          orderNumber: ["42"],
          identifier: ["42"],
          url: ["https://shop.example.test/?a=1&b=2"],
          orderDate: ["2026-12-01"],
        },
      },
    ]);
  });
  it("keeps scope boundaries, skips itemref, and discards unfinished markup", () => {
    expect(
      extractEmailMarkup(
        '<div itemscope itemtype="https://schema.org/Order" itemref=x><div itemprop=seller itemscope itemtype="https://schema.org/Organization"><meta itemprop=name content=Retailer></div></div><span id=x itemprop=name>Outside</span>',
      )[0]?.properties,
    ).toEqual({ seller: [{ type: "Organization", properties: { name: ["Retailer"] } }] });
    expect(
      extractEmailMarkup(
        '<div itemscope itemtype="https://schema.org/Order"><span itemprop=name>Unfinished',
      ),
    ).toEqual([]);
    expect(extractEmailMarkup("<div ".repeat(10000) + ld(order))).toEqual([]);
    expect(extractEmailMarkup("<div>".repeat(40) + ld(order))).toHaveLength(1);
    expect(extractEmailMarkup("<br>".repeat(50001) + ld(order))).toEqual([]);
    expect(extractEmailMarkup('<script type="application/ld+json">{"@type":"Order"}')).toEqual([]);
  });
  it("treats prototype keys as inert JSON data", () => {
    expect(
      extractEmailMarkup(
        '<script type="application/ld+json">{"@type":"Order","__proto__":{"polluted":true},"name":"Safe"}</script>',
      ),
    ).toEqual([{ type: "Order", properties: { name: ["Safe"] } }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("additional fail-closed regressions", () => {
  it("recognizes a root type anywhere in a type array and retains nested provider @id inertly", () => {
    const [item] = extractEmailMarkup(
      ld({
        "@type": ["Organization", "Order"],
        seller: { "@type": "Organization", "@id": "https://retail.example.test/" },
      }),
    );
    expect(item).toEqual({
      type: "Order",
      properties: {
        seller: [
          { type: "Organization", properties: { identifier: ["https://retail.example.test/"] } },
        ],
      },
    });
  });
  it("does not truncate microdata identity fields or leak text across nested scope boundaries", () => {
    const html = `<div itemscope itemtype="https://schema.org/Order"><span itemprop=orderNumber>${"x".repeat(MAX_MARKUP_STRING + 1)}</span><span itemprop=name>Outer<div itemscope itemtype="https://schema.org/Person"><span itemprop=name>Inner</span></div></span></div>`;
    const [item] = extractEmailMarkup(html);
    expect(item?.properties.orderNumber).toBeUndefined();
    expect(item?.properties.name).toEqual(["Outer"]);
    expect(
      extractEmailMarkup(
        '<div itemscope itemtype="https://schema.org/Order"><span itemprop=name>&toString; &#x110000; &#0; &#xd800;</span></div>',
      )[0]?.properties.name,
    ).toEqual(["&toString; � � �"]);
  });
  it("requires positive, consistent stored sender authentication", () => {
    for (const auth of [
      { dmarc: "fail" as const },
      { spf: "pass" as const, dkim: "fail" as const, spfAligned: true, dkimAligned: true },
      { spf: "pass" as const, dkim: "pass" as const, spfAligned: true },
      {
        dmarc: "fail" as const,
        spf: "pass" as const,
        dkim: "pass" as const,
        spfAligned: true,
        dkimAligned: true,
      },
    ])
      expect(emailMarkupTrust(auth)).toBe("unverified");
  });
});

describe("work and allocation budgets", () => {
  it("caps total normalized property values as well as per-property values", () => {
    const wide = Object.fromEntries(
      MARKUP_PROPERTIES.map((prop) => [prop, Array.from({ length: 64 }, () => "test")]),
    );
    const items = extractEmailMarkup(
      ld(Array.from({ length: 4 }, () => ({ "@type": "Order", ...wide }))),
    );
    const count = items.reduce(
      (total, item) =>
        total + Object.values(item.properties).reduce((n, values) => n + (values?.length ?? 0), 0),
      0,
    );
    expect(count).toBe(16384);
  });
  it("bounds tag spelling, attributes and JSON separators, and counts astral UTF-8 correctly", () => {
    const good = ld({ "@type": "Order" });
    expect(extractEmailMarkup(`<div title="${"x".repeat(16384)}">${good}`)).toEqual([]);
    expect(
      extractEmailMarkup(
        `<div ${Array.from({ length: 65 }, (_, i) => `a${i}=x`).join(" ")}>${good}`,
      ),
    ).toEqual([]);
    expect(
      extractEmailMarkup(
        `<script type="application/ld+json">[${"0,".repeat(50001)}0]</script>${good}`,
      ),
    ).toHaveLength(1);
    const html = `😀${good}`;
    expect(
      extractEmailMarkup(html, { maxBytes: new TextEncoder().encode(html).length }),
    ).toHaveLength(1);
    expect(
      extractEmailMarkup(html, { maxBytes: new TextEncoder().encode(html).length - 1 }),
    ).toEqual([]);
  });
});

it("bounds nested microdata amplification and JSON scalar totals by character count", async () => {
  const { extractEmailMarkupResult, MAX_MARKUP_SCALAR_CHARS } = await import("./markup.js");
  const { serialize } = await import("@jeswr/rdf-serialize");
  const { DataFactory, Store } = await import("n3");
  const { MailMarkupResource } = await import("./markup-vocab.js");
  const props = MARKUP_PROPERTIES.slice(0, 16).join(" ");
  const block = `<div itemscope itemtype="https://schema.org/Order">${`<span itemprop="${props}">`.repeat(25)}${"x".repeat(8192)}${"</span>".repeat(25)}</div>`;
  for (const html of [
    block.repeat(4),
    ld(Array.from({ length: 40 }, () => ({ "@type": "Order", name: "x".repeat(8192) }))),
  ]) {
    const result = extractEmailMarkupResult(html);
    expect(result.truncated).toBe(true);
    const count = (value: unknown): number => {
      if (typeof value !== "object" || value === null) return String(value).length;
      if (Array.isArray(value)) return value.reduce((n, child) => n + count(child), 0);
      return Object.values(
        (value as { properties: Record<string, unknown> }).properties,
      ).reduce<number>((n, child) => n + count(child), 0);
    };
    expect(result.items.reduce((n, item) => n + count(item), 0)).toBeLessThanOrEqual(
      MAX_MARKUP_SCALAR_CHARS,
    );
    expect(result.scalarCharacters).toBeLessThanOrEqual(MAX_MARKUP_SCALAR_CHARS);
    expect(result.items.length).toBeGreaterThan(0);
    const dataset = new Store();
    const resource = new MailMarkupResource("https://example.test/item", dataset, DataFactory);
    for (const item of result.items)
      for (const [prop, values] of Object.entries(item.properties))
        for (const value of values ?? [])
          if (typeof value !== "object")
            resource.addLiteral(prop as (typeof MARKUP_PROPERTIES)[number], value);
    // RDF escaping/metadata has a separate writer cap; this also detects extraction expansion.
    expect(new TextEncoder().encode(await serialize([...dataset])).length).toBeLessThan(
      2 * MAX_MARKUP_SCALAR_CHARS,
    );
  }
});

it("finds a later JSON-LD script after forty unclosed elements", () => {
  expect(
    extractEmailMarkup("<p>".repeat(40) + ld({ "@type": "Order", orderNumber: "late" })),
  ).toEqual([{ type: "Order", properties: { orderNumber: ["late"] } }]);
});
