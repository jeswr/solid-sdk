// AUTHORED-BY Codex GPT-6

import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { must } from "../../test/money/helpers";

const fixture = fileURLToPath(new URL("./fixtures/statement.csv", import.meta.url));
test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
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
async function dialogFits(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bounds = must(await dialog.boundingBox());
  const width = must(page.viewportSize()).width;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
  for (const control of await dialog.locator("input, button, [role=combobox]").all()) {
    if (!(await control.isVisible())) continue;
    const box = must(await control.boundingBox());
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
}
async function addAccount(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "Add account", exact: true });
  await expect(dialog).toBeVisible();
  await dialogFits(page);
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
  const beforeMinor = BigInt(before.replace(/[^0-9-]/g, ""));
  const fixtureMinor = (await readFile(fixture, "utf8"))
    .trim()
    .split("\n")
    .slice(1)
    .reduce((sum, line) => sum + BigInt(must(line.split(",")[2])) * BigInt(100), BigInt(0));
  const expectedWorth = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(beforeMinor + BigInt(50000) + fixtureMinor) / 100);
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
  const previewRegion = page.getByRole("region", {
    name: "Statement preview, scroll to review all columns and rows",
    exact: true,
  });
  await previewRegion.focus();
  await expect(previewRegion).toBeFocused();
  if (info.project.name.startsWith("375")) {
    const bounds = must(await previewRegion.boundingBox());
    expect(bounds.width).toBeLessThan(375);
    expect(bounds.height).toBeLessThanOrEqual(521);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(2200);
  }
  await shot(page, info, "import-preview");
  await page.getByRole("button", { name: "Import 100 transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Statement imported", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "100 transactions added" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View ledger", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Statement account", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".mon-subtitle .mon-amount")).toHaveText("-£3,000.00");
  await page.getByRole("button", { name: "Last 90 days", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "100 results" })).toBeVisible();
  if (info.project.name.startsWith("375")) {
    await expect(page.locator(".mon-ledger-card")).toHaveCount(100);
    await expect(page.locator(".mon-desktop")).toBeHidden();
    const dimensions = await page.evaluate(() => {
      const main = document.getElementById("main-content");
      if (!main) throw new Error("Expected the ledger's scroll container");
      const viewport = main.getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll(".mon-ledger-card"));
      const last = cards
        .filter((card) => {
          const bounds = card.getBoundingClientRect();
          return bounds.top < viewport.bottom && bounds.bottom > viewport.top;
        })
        .at(-1);
      if (!last) throw new Error("Expected a visible transaction card");
      return {
        height: document.documentElement.scrollHeight,
        lastBottom: last.getBoundingClientRect().bottom + window.scrollY,
      };
    });
    expect(dimensions.height, JSON.stringify(dimensions)).toBeLessThan(dimensions.lastBottom * 1.3);
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
  await dialogFits(page);
  await transfer.getByLabel("Amount (GBP)", { exact: true }).fill("25");
  await transfer.getByRole("button", { name: "Create transfer", exact: true }).click();
  await expect(transfer).toBeHidden();
  await expect(
    page.getByText("Paired transfer", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.goto("/money");
  await page.reload();
  await expect(page.locator(".mon-worth h2")).toHaveText(expectedWorth);
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
  await dialogFits(page);
  await category.getByLabel("Category name", { exact: true }).fill("Travel");
  await category.getByRole("button", { name: "Create category", exact: true }).click();
  await expect(category).toBeHidden();
  await page.getByRole("button", { name: "Move Travel", exact: true }).click();
  await dialogFits(page);
  await choose(page, "Parent category", "Fun");
  await page.getByRole("button", { name: "Move category", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const fun = page.getByRole("treeitem", { name: /^Fun,/ });
  await expect(fun.getByRole("treeitem", { name: /^Travel,/ })).toBeVisible();
  await fun.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: /^Travel,/ })).toBeFocused();
  await page.keyboard.press("F2");
  const rename = page.getByRole("textbox", { name: "Rename Travel", exact: true });
  await expect(rename).toBeFocused();
  await rename.fill("Journeys");
  await rename.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Journeys,/ })).toBeVisible();
  const child = page.getByRole("treeitem", { name: /^Journeys,/ });
  expect(must(await child.locator(".mon-tree-row").boundingBox()).x).toBeGreaterThan(
    must(await fun.locator(":scope > .mon-tree-row").boundingBox()).x + 20,
  );
  await expect(child.locator(".suite-editable")).toHaveCSS("border-top-width", "0px");
  await expect(child.getByRole("button", { name: /^(Expand|Collapse)/ })).toHaveCount(0);
  await shot(page, info, "categories");
});
test("transaction entry, searching, validation and refusing a transfer leg", async ({ page }) => {
  await page.goto("/money");
  await page.getByRole("main").getByRole("link", { name: "Current account", exact: true }).click();
  await page.getByRole("button", { name: "Add transaction", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction", exact: true });
  await dialogFits(page);
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

// AUTHORED-BY Claude Opus 5.5
test("reports compare periods and break spending down by category and month", async ({
  page,
}, info) => {
  await page.goto("/money/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports", exact: true })).toBeVisible();
  const period = page.getByRole("group", { name: "Period", exact: true });
  await expect(period.getByRole("radio", { name: "This month", exact: true })).toBeChecked();
  await period.getByRole("radio", { name: "Last 90 days", exact: true }).check();
  await expect(period.getByRole("radio", { name: "Last 90 days", exact: true })).toBeChecked();
  await expect(page.getByText(/^4 Aug 2026 to 1 Nov 2026, compared with/)).toBeVisible();
  for (const name of ["Money in", "Spending", "Net"])
    await expect(
      page.getByRole("region", { name, exact: true }).getByText(/^Previous period:/),
    ).toBeVisible();
  const categories = page.getByRole("region", { name: "Spending by category", exact: true });
  await expect(categories.getByRole("listitem").first()).toBeVisible();
  await expect(categories.getByText("Food", { exact: true })).toBeVisible();
  await expect(categories.getByText("Groceries", { exact: true })).toHaveCount(0);
  const months = page.getByRole("region", { name: "Spending by month", exact: true });
  const bars = months
    .getByRole("list", { name: "Spending by month", exact: true })
    .getByRole("button");
  await expect(bars).toHaveCount(4);
  await bars.nth(1).focus();
  await expect(months.getByRole("tooltip")).toContainText("September 2026");
  await expect(months.getByRole("tooltip")).not.toContainText("days");
  await bars.last().focus();
  // The period ends on 1 November, so its bar covers a single day.
  await expect(months.getByRole("tooltip")).toContainText("November 2026 (1 day)");
  await page.keyboard.press("Escape");
  await expect(months.getByRole("tooltip")).toHaveCount(0);
  await bars.nth(1).focus();
  await shot(page, info, "reports");
  await categories.getByLabel("Include subcategories in their parent", { exact: true }).uncheck();
  await expect(categories.getByText("Groceries", { exact: true })).toBeVisible();
  await expect(categories.getByText("Food", { exact: true })).toHaveCount(0);
  await months.getByRole("button", { name: "Show as table", exact: true }).click();
  await expect(months.getByRole("row")).toHaveCount(5);
  await expect(months.getByRole("cell", { name: "September 2026", exact: true })).toBeVisible();
  await categories.getByRole("button", { name: "Show as table", exact: true }).click();
  await expect(categories.getByRole("columnheader", { name: "Share", exact: true })).toBeVisible();
  await shot(page, info, "reports-tables");
});

test("recurring lists repeating bills and income with their next dates", async ({ page }, info) => {
  await page.goto("/money");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  if (!info.project.name.startsWith("375"))
    await page
      .getByRole("navigation", { name: "Money", exact: true })
      .getByRole("link", { name: "Recurring", exact: true })
      .click();
  else await page.goto("/money/recurring");
  await expect(
    page.getByRole("heading", { level: 1, name: "Recurring", exact: true }),
  ).toBeVisible();
  const bills = page.getByRole("region", { name: "Bills", exact: true });
  const income = page.getByRole("region", { name: "Income", exact: true });
  await expect(bills.locator("li", { hasText: "Willow Court · Rent" })).toContainText(
    "Monthly on the 1st",
  );
  await expect(bills.locator("li", { hasText: "Bright Energy" })).toContainText(
    "Monthly on the 12th",
  );
  await expect(income.locator("li", { hasText: "Northbank Studio · Salary" })).toContainText(
    "Next 1 Dec 2026",
  );
  await shot(page, info, "recurring");
  await bills
    .locator("li", { hasText: "Willow Court · Rent" })
    .getByRole("link", { name: "Current account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Current account", exact: true }),
  ).toBeVisible();
});
