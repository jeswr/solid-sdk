// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

const fixture = fileURLToPath(new URL("./fixtures/statement.csv", import.meta.url));
test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__drive-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__drive-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod database deletion blocked"));
    });
  });
  await page.unroute("**/__drive-test-reset");
});
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).filter({ visible: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function shot(page: Page, info: TestInfo, name: string) {
  await expect(page).toHaveTitle(/Money/);
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  const directory = fileURLToPath(new URL("../../../../artifacts/screens/money/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${info.project.name}-${name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
async function addAccount(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "Add account", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Account name", { exact: true }).fill(name);
  await dialog.getByLabel("Opening balance", { exact: true }).fill("500");
  await dialog.getByLabel("Opening date", { exact: true }).fill("2026-08-31");
  await dialog.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(dialog).toBeHidden();
}
test("import, inline and bulk categorisation, overview, category moves and paired transfers", async ({
  page,
}, info) => {
  await page.goto("/money");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "Current account", exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await shot(page, info, "overview");
  const before = await page.locator(".mon-worth h2").innerText();
  await page.getByRole("main").getByRole("link", { name: "Import statement", exact: true }).click();
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await addAccount(page, "Statement account");
  await page.getByLabel("Statement file", { exact: true }).setInputFiles(fixture);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Map columns", exact: true })).toBeVisible();
  await choose(page, "Description / payee column", "Merchant");
  await choose(page, "Amount column", "Signed amount");
  await choose(page, "Date column", "Posted");
  await shot(page, info, "import-mapping");
  await page.getByRole("button", { name: "Preview transactions", exact: true }).click();
  await expect(
    page.getByText("100 of 100 transactions selected · 0 possible duplicates", { exact: true }),
  ).toBeVisible();
  await shot(page, info, "import-preview");
  await page.getByRole("button", { name: "Import 100 transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Statement imported", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "100 transactions added" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View ledger", exact: true }).click();
  await page.getByRole("button", { name: "Last 90 days", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "100 results" })).toBeVisible();
  if (info.project.name.startsWith("375")) {
    await expect(page.locator(".mon-ledger-card")).toHaveCount(100);
    await expect(page.locator(".mon-desktop")).toBeHidden();
  }
  for (const name of ["Merchant 100", "Merchant 099", "Merchant 098"]) {
    await choose(page, `Category for ${name}`, "Groceries");
    await expect(
      page
        .getByRole("combobox", { name: `Category for ${name}`, exact: true })
        .filter({ visible: true }),
    ).toContainText("Groceries");
  }
  // Select by keyboard on the desktop grid and by the labelled card checkbox on phones.
  for (const name of ["Merchant 100", "Merchant 099", "Merchant 098"]) {
    await page
      .getByRole("checkbox", { name: `Select ${name}`, exact: true })
      .filter({ visible: true })
      .check();
  }
  await expect(page.getByRole("toolbar", { name: "Selection actions", exact: true })).toContainText(
    "3 selected",
  );
  await choose(page, "Categorise selected as", "Fun");
  await expect(
    page
      .getByRole("combobox", { name: "Category for Merchant 100", exact: true })
      .filter({ visible: true }),
  ).toContainText("Fun");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await shot(page, info, "ledger");
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await choose(page, "To account", "Savings");
  const transfer = page.getByRole("dialog", { name: "Transfer", exact: true });
  await transfer.getByLabel("Amount (GBP)", { exact: true }).fill("25");
  await transfer.getByRole("button", { name: "Create transfer", exact: true }).click();
  await expect(transfer).toBeHidden();
  await expect(
    page.getByText("Paired transfer", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.goto("/money");
  await expect(page.locator(".mon-worth h2")).not.toHaveText(before);
  await expect(
    page
      .getByRole("link", { name: "Statement account", exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Savings", exact: true }).first().click();
  await expect(
    page.getByText("Paired transfer", { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await page.goto("/money/categories");
  await expect(
    page.getByRole("heading", { level: 1, name: "Categories", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  const category = page.getByRole("dialog", { name: "Add category", exact: true });
  await category.getByLabel("Category name", { exact: true }).fill("Travel");
  await category.getByRole("button", { name: "Create category", exact: true }).click();
  await expect(category).toBeHidden();
  await page.getByRole("button", { name: "Move Travel", exact: true }).click();
  await choose(page, "Parent category", "Fun");
  await page.getByRole("button", { name: "Move category", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const fun = page.getByRole("treeitem", { name: /^Fun,/ });
  await expect(fun.getByRole("treeitem", { name: /^Travel,/ })).toBeVisible();
  await fun.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: /^Travel,/ })).toBeFocused();
  await shot(page, info, "categories");
});
test("transaction entry, searching, validation and refusing a transfer leg", async ({ page }) => {
  await page.goto("/money");
  await page.getByRole("main").getByRole("link", { name: "Current account", exact: true }).click();
  await page.getByRole("button", { name: "Add transaction", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction", exact: true });
  await dialog.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a payee");
  await dialog.getByLabel("Payee / description", { exact: true }).fill("Keyboard coffee");
  await dialog.getByLabel("Amount (GBP)", { exact: true }).fill("4.50");
  await dialog.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(dialog).toBeHidden();
  const search = page.getByRole("searchbox", { name: "Search in Money", exact: true });
  await search.fill("Keyboard coffee");
  await search.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keyboard coffee");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Keyboard coffee", exact: true }),
  ).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Keyboard coffee", exact: true }).click();
  await page.getByRole("button", { name: "Last 90 days", exact: true }).click();
  await page
    .locator(".mon-row-open")
    .filter({ hasText: "Transfer" })
    .filter({ visible: true })
    .first()
    .click();
  const pair = page.getByRole("dialog", { name: "Edit transaction", exact: true });
  await expect(pair).toContainText("Transfer legs must be changed together");
  await pair.getByRole("button", { name: "Done", exact: true }).click();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});
