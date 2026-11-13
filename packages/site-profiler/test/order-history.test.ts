// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { applyExtraction, proposeHtmlExtraction } from "../src/extraction.js";
import { s, xsd } from "../src/util.js";

describe("HTML order history", () => {
  it("maps an evidenced order card to number, creation date and total", () => {
    const html =
      '<ul class="orders"><li class="order" data-order-id="5010"><a href="/orders/5010">Order 5010</a><time datetime="2026-11-01T12:00:00.000Z">1 November</time><span class="price" data-price="18.50" data-currency="GBP">£18.50</span></li></ul>';
    const extraction = proposeHtmlExtraction(html);
    expect(extraction).toMatchObject({
      itemType: s("Order"),
      fields: expect.arrayContaining([
        { property: s("orderNumber"), path: ":scope", attribute: "data-order-id" },
        {
          property: s("dateCreated"),
          path: "time",
          attribute: "datetime",
          datatype: xsd("dateTime"),
        },
        {
          property: s("totalPrice"),
          path: "span.price",
          attribute: "data-price",
          datatype: xsd("decimal"),
        },
      ]),
    });
    if (!extraction) throw new Error("Missing extraction");
    expect(applyExtraction(extraction, html, "https://shop.test/orders")[0]).toMatchObject({
      [s("orderNumber")]: ["5010"],
      [s("totalPrice")]: ["18.50"],
      [s("dateCreated")]: ["2026-11-01T12:00:00.000Z"],
    });
  });
  it("keeps ordinary priced product cards as products", () => {
    expect(
      proposeHtmlExtraction(
        '<ul><li class="product-card" data-product-id="104"><a href="/product/104">Example</a><span class="price">£20.00</span></li></ul>',
      )?.itemType,
    ).toBe(s("Product"));
  });
});
