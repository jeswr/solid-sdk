// AUTHORED-BY Codex GPT-6.1-Sol
import type { Extraction, Operation } from "@jeswr/site-model";
import { Parser } from "n3";
import { expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { factsMoney } from "../src/money.js";

const s = "https://schema.org/",
  x = "http://www.w3.org/2001/XMLSchema#";
const extraction: Extraction = {
  format: "json",
  itemPath: "/items",
  totalPath: "/totalRecords",
  itemType: `${s}Order`,
  fields: [
    { property: `${s}totalPrice`, path: "/total" },
    { property: `${s}priceCurrency`, path: "/currency" },
    { property: `${s}dateCreated`, path: "/created" },
  ],
};
const options = { baseUrl: "https://shop.test/orders", redact: (v: string) => v };
it("emits one integer ItemList total and marks unseen records as partial", async () => {
  const out = await extract(
    extraction,
    JSON.stringify({
      totalRecords: 40,
      items: [{ total: "$219.40", currency: "USD", created: "2023-05-31 02:55:09" }],
    }),
    options,
  );
  const quads = new Parser().parse(out.turtle);
  expect(quads.filter((q) => q.object.value === `${s}ItemList`)).toHaveLength(1);
  expect(quads.find((q) => q.predicate.value === `${s}numberOfItems`)?.object).toMatchObject({
    value: "40",
    datatype: { value: `${x}integer` },
  });
  expect(out.truncation.items).toBe(true);
  expect(out.items[0]?.terms?.get(`${s}totalPrice`)?.[0]).toMatchObject({
    value: "$219.40",
    datatype: { value: `${x}string` },
  });
  expect(out.turtle).toContain('"2023-05-31T02:55:09"^^xsd:dateTime');
});
it.each([
  ["1.234,50 €", "1234.50"],
  ["$1,234.50", "1234.50"],
  ["12,34", "12.34"],
])("normalizes formatted money only with a currency code: %s", async (text, numeric) => {
  const run = (currency?: string) =>
    extract(
      extraction,
      JSON.stringify({ totalRecords: 1, items: [{ total: text, currency, created: "yesterday" }] }),
      options,
    );
  expect((await run("EUR")).items[0]?.terms?.get(`${s}totalPrice`)?.[0]).toMatchObject({
    value: text,
    datatype: { value: `${x}string` },
  });
  expect(
    new Parser()
      .parse((await run("EUR")).turtle)
      .find((q) => q.predicate.value === `${s}totalPrice`)?.object,
  ).toMatchObject({ value: numeric, datatype: { value: `${x}decimal` } });
  expect((await run()).items[0]?.terms?.get(`${s}totalPrice`)?.[0]).toMatchObject({
    value: text,
    datatype: { value: `${x}string` },
  });
  expect((await run("EUR")).turtle).toContain('schema:dateCreated "yesterday"');
});
it("validates totals, handles empty lists, and keeps truncation on local limits", async () => {
  for (const totalRecords of ["40", -1, 1.2, 0])
    await expect(
      extract(extraction, JSON.stringify({ totalRecords, items: [{ total: "1" }] }), options),
    ).rejects.toThrow("invalid list total");
  const empty = await extract(extraction, '{"totalRecords":0,"items":[]}', options);
  expect(empty.turtle).toContain("schema:numberOfItems 0");
  expect(empty.truncation.items).toBe(false);
  expect(
    (await extract(extraction, '{"totalRecords":2,"items":[{},{}]}', { ...options, maxItems: 1 }))
      .truncation.items,
  ).toBe(true);
});
it("a displayed order list total cannot authorize payment", async () => {
  const output = await extract(
    extraction,
    '{"totalRecords":1,"items":[{"total":"$12.00","currency":"USD"}]}',
    options,
  );
  expect(output.truncation.items).toBe(false);
  const read = {
    id: "urn:read",
    extraction,
    inputs: [],
    request: { method: "GET", urlTemplate: options.baseUrl },
  } as unknown as Operation;
  const pay = { inputs: [] } as unknown as Operation;
  expect(() =>
    factsMoney(
      "https://shop.test",
      [
        {
          operation: read,
          url: options.baseUrl,
          step: 1,
          items: output.items,
          truncation: output.truncation,
        },
      ],
      [
        {
          operation: pay,
          values: {},
          sources: {},
          step: 2,
          compiled: {
            operation: "urn:pay",
            method: "POST",
            url: new URL("https://shop.test/pay"),
            headers: {},
            modelHeaders: [],
            csrf: [],
          },
        },
      ],
      0,
    ),
  ).toThrow(/invalid site monetary amounts/);
});
it("r9 preserves original monetary lexicals, including numeric JSON decimals and exponents", async () => {
  for (const [wire, lexical] of [
    ['"0012.00"', "0012.00"],
    ["12.00", "12.00"],
    ["1e1", "1e1"],
  ]) {
    const out = await extract(
      extraction,
      `{"totalRecords":1,"items":[{"total":${wire},"currency":"USD"}]}`,
      options,
    );
    expect(out.items[0]?.values.get(`${s}totalPrice`)).toEqual([lexical]);
    expect(out.total).toBe(1);
  }
});
it("does not coerce prose, invalid dates, ambiguous currency or secret echoes", async () => {
  const out = await extract(
    extraction,
    '{"totalRecords":1,"items":[{"total":"$12.00","currency":"USD","created":"2023-02-31T00:00:00"}]}',
    { ...options, redact: (v) => v.replace("$12.00", "[redacted]") },
  );
  expect(out.turtle).toContain('schema:totalPrice "[redacted]"');
  expect(out.turtle).not.toContain("xsd:dateTime");
});

it("adds endpoint text for refund records without inventing an invoice type", async () => {
  const out = await extract(
    { ...extraction, itemType: `${s}Thing` },
    '{"totalRecords":1,"items":[{"total":"12"}]}',
    { ...options, baseUrl: "https://shop.test/data?namespace=creditmemo_grid&search=invoice" },
  );
  expect(out.turtle).toContain('schema:additionalType "credit memo"');
  expect(out.turtle).not.toContain("schema:Invoice");
});
it("redacts a count or original formatted amount against the final secret set", async () => {
  const out = await extract(
    extraction,
    '{"totalRecords":40,"items":[{"total":"$12.00","currency":"USD"}]}',
    options,
  );
  const rerendered = await out.render((v) =>
    v.replace("40", "[redacted]").replace("$12.00", "[redacted]"),
  );
  expect(rerendered).not.toContain("numberOfItems");
  expect(rerendered).not.toContain("12.00");
  expect(rerendered).not.toContain('"[redacted]"^^xsd:decimal');
});
