// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { emptyListProbe } from "../src/empty-list-probe.js";
import { proposeJsonExtraction } from "../src/extraction.js";
import type { RecordedRequest } from "../src/types.js";

it("learns only sibling safe integer totals at least as large as the returned page", () => {
  const items = [{ id: 1, name: "Example" }];
  expect(proposeJsonExtraction({ data: { items, totalRecords: 40 } })?.totalPath).toBe(
    "/data/totalRecords",
  );
  for (const totalRecords of [0, 1.2, "40", -1])
    expect(proposeJsonExtraction({ items, totalRecords })?.totalPath).toBeUndefined();
  expect(proposeJsonExtraction({ items, stock: 40 })?.totalPath).toBeUndefined();
  expect(proposeJsonExtraction({ items, other: { count: 40 } })?.totalPath).toBeUndefined();
});
it("maps currency suffixes and uses endpoint nouns before row heuristics", () => {
  const ex = proposeJsonExtraction(
    { items: [{ id: 1, grand_total: "$12.00", base_currency_code: "USD" }] },
    "https://shop.test/invoices",
  );
  expect(ex?.itemType).toBe("https://schema.org/Invoice");
  expect(ex?.fields).toContainEqual({
    property: "https://schema.org/priceCurrency",
    path: "/base_currency_code",
  });
});

it("clears a witnessed empty list's saved search with a bounded read, preserving dispatch and session material", () => {
  const sample: RecordedRequest = {
    seq: 1,
    phase: "crawl",
    method: "GET",
    url: "https://shop.test/data?namespace=products&search=missing&paging[current]=12&paging[pageSize]=200&ticket=session-source",
    resourceType: "xhr",
    requestHeaders: {},
    cookieNames: [],
    status: 200,
    contentType: "application/json",
    bodySample: '{"items":[],"totalRecords":0}',
  };
  const url = new URL(emptyListProbe(sample) ?? "https://invalid.test");
  expect(url.searchParams.get("search")).toBe("");
  expect(url.searchParams.get("paging[current]")).toBe("1");
  expect(url.searchParams.get("paging[pageSize]")).toBe("25");
  expect(url.searchParams.get("namespace")).toBe("products");
  expect(url.searchParams.get("ticket")).toBe("session-source");
  expect(emptyListProbe({ ...sample, method: "POST" })).toBeUndefined();
  expect(emptyListProbe({ ...sample, bodySample: '{"items":[{"id":1}]}' })).toBeUndefined();
});
