// AUTHORED-BY Codex GPT-6.1-Sol
// Explicit UI demonstration for the disposable Magento benchmark. No production-site heuristics.
import { randomUUID } from "node:crypto";
import type { Demonstration } from "@jeswr/site-profiler";

type Page = Parameters<Demonstration["run"]>[0];
export function productFixture() {
  const suffix = randomUUID().slice(0, 12);
  return { name: `SAB Test Widget ${suffix}`, sku: `sab-${suffix}`, price: "12.34", quantity: "5" };
}
export type ProductFixture = ReturnType<typeof productFixture>;
export async function productGrid(page: Page, origin: string) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "localhost")
      throw new Error("Sandbox redirects to http://localhost:7780; stop");
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      !/\/catalog\/product\/(save|validate|massDelete)(?:\/|$)/.test(url.pathname)
    )
      return route.abort();
    return route.fallback();
  });
  await page.goto(`${origin}/admin/catalog/product/`);
  await page.waitForLoadState("networkidle");
}
export async function deleteOwnProduct(
  page: Page,
  origin: string,
  item: ProductFixture,
  editUrl?: string,
  mustExist = false,
) {
  await productGrid(page, origin);
  const search = page.locator("input#fulltext:visible").first();
  await search.fill(item.sku);
  const [response] = await Promise.all([
    page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        url.searchParams.get("namespace") === "product_listing" &&
        url.searchParams.get("search") === item.sku &&
        r.status() === 200
      );
    }),
    search.press("Enter"),
  ]);
  const data = (await response.json()) as {
    items: Array<{ entity_id: string; name: string; sku: string }>;
    totalRecords: number;
  };
  const record = data.items.find((row) => row.name === item.name && row.sku === item.sku);
  if (!record) {
    if (mustExist) throw new Error("Created product missing from grid");
    return;
  }
  if (data.items.length !== 1 || data.totalRecords !== 1)
    throw new Error("Cleanup refused: the SKU search must match exactly this test product");
  if (!/^\d+$/.test(record.entity_id)) throw new Error("Cleanup refused: invalid product ID");
  if (editUrl && /\/id\/(\d+)/.exec(editUrl)?.[1] !== record.entity_id)
    throw new Error("Cleanup refused: row ID does not match the created product");
  // A saved grid view may hide name/SKU columns. Select the row by its verified checkbox ID.
  const checkbox = page.locator(`tr.data-row input[type="checkbox"][value="${record.entity_id}"]`);
  await checkbox.waitFor({ state: "visible" });
  await checkbox.check();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByText("Delete", { exact: true }).filter({ visible: true }).first().click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.getByRole("button", { name: "OK", exact: true }).click(),
  ]);
}
export function productDemonstration(origin: string, item = productFixture()): Demonstration {
  return {
    name: "create-update-delete-product",
    description: "Create a disposable simple product, change its price, then delete it.",
    async run(page) {
      let editUrl: string | undefined;
      let deleted = false;
      try {
        await productGrid(page, origin);
        await page.locator("#add_new_product-button").click();
        await page.waitForLoadState("networkidle");
        await page.locator('input[name="product[name]"]').fill(item.name);
        await page.locator('input[name="product[name]"]').press("Tab");
        await page.waitForTimeout(500);
        await page.locator('input[name="product[sku]"]').fill(item.sku);
        await page.locator('input[name="product[sku]"]').press("Tab");
        await page.locator('input[name="product[price]"]').fill(item.price);
        await page
          .locator('input[name="product[quantity_and_stock_status][qty]"]')
          .fill(item.quantity);
        await page.locator('input[name="product[weight]"]').fill("1");
        await page.locator("#save-button").click();
        await page
          .waitForURL(/\/catalog\/product\/edit\/id\/\d+/, { timeout: 30000 })
          .catch(async () => {
            throw new Error(
              `Create failed: ${await page.locator(".admin__field-error,.message-error").allTextContents()}`,
            );
          });
        editUrl = page.url();
        await page.locator('input[name="product[price]"]').fill("23.45");
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle" }),
          page.locator("#save-button").click(),
        ]);
        await deleteOwnProduct(page, origin, item, editUrl, true);
        deleted = true;
      } finally {
        if (!deleted) await deleteOwnProduct(page, origin, item, editUrl).catch(() => undefined);
      }
    },
  };
}
