// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { endpointItemType } from "../src/index.js";

it.each([
  ["sales_order_invoice_grid", "Invoice"],
  ["sales_order_shipment_grid", "ParcelDelivery"],
  ["sales_order_creditmemo_grid", "Thing", "credit memo"],
  ["refunds", "Thing", "refund"],
  ["customer_listing", "Person"],
  ["products", "Product"],
  ["orders", "Order"],
  ["customer_groups", "Thing"],
])("uses the most specific endpoint-owned word: %s", (word, type, additionalType?: string) => {
  expect(endpointItemType(`https://shop.test/data?namespace=${word}&search=invoice`)).toEqual({
    itemType: `https://schema.org/${type}`,
    ...(additionalType ? { additionalType } : {}),
  });
});
it("ignores user search words", () =>
  expect(endpointItemType("https://shop.test/data?search=invoice")).toBeUndefined());

it("extracts server redirect identities with a canonical display slug, without keeping its query", async () => {
  const { responseIdentity } = await import("../src/response-identity.js");
  expect(responseIdentity("https://forum.test/topics/42/a-test-story?tracking=1#reply")).toEqual({
    url: "https://forum.test/topics/42/a-test-story",
    identifier: "42",
  });
  expect(responseIdentity("https://forum.test/topics/a-test-story")).toBeUndefined();
  expect(responseIdentity("https://forum.test/topics/42/edit")).toBeUndefined();
});
