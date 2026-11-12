// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

// Each test gets Playwright's fresh browser storage and a remembered demo account.
export const test = base.extend({
  page: async ({ page }, use) => {
    await seedDemoSession(page);
    await use(page);
  },
});

export const contactRow = (page: Page, name: string) =>
  page.getByRole("row", { name, exact: true });
export const contactCount = (page: Page) => page.locator(".con-list-heading").getByRole("status");

export async function openContacts(page: Page, seed?: "contacts-empty" | "contacts-no-book") {
  await page.goto(`/contacts${seed ? `?seed=${seed}` : ""}`);
  await expect(page.getByRole("heading", { name: "All contacts", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading contacts" })).toBeHidden();
  await expect(contactCount(page)).toHaveText(`${seed ? 0 : 40} contacts`);
}

export async function navigateContacts(page: Page, name: RegExp) {
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const navigation = narrow
    ? page.getByRole("dialog", { name: "Navigation", exact: true })
    : page.getByRole("complementary", { name: "Contacts navigation", exact: true });
  await navigation.getByRole("link", { name }).click();
  if (narrow) await expect(navigation).toBeHidden();
}

export async function searchContacts(page: Page, query: string) {
  const input = page.getByRole("searchbox", { name: "Search Contacts", exact: true });
  await input.fill(query);
  await input.press("Enter");
}

// Match Money's WCAG checks, including contrast, without rule exclusions.
// playwright.config.ts runs every spec at 375/768/1280 in light and dark.
export async function accessible(page: Page) {
  await expect(page).toHaveTitle("Contacts · Solid Suite");
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
