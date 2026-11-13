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
