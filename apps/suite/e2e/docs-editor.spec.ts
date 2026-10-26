// AUTHORED-BY Codex
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}
async function newDocument(page: Page, title: string) {
  await page.goto("/docs/new");
  const titleInput = page.getByRole("textbox", { name: "Document title", exact: true });
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await titleInput.press("Enter");
  return page.getByRole("textbox", { name: "Document body", exact: true });
}
async function format(page: Page, label: string) {
  const button = page
    .getByRole("toolbar", { name: "Formatting", exact: true })
    .getByRole("button", { name: label, exact: true });
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole("button", { name: "More formatting", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: false }).first().click();
  }
}

test("creates, saves, reloads and formats a document accessibly", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir("e2e/screenshots", { recursive: true });
  const suffix = testInfo.project.name;
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
  await audit(page);
  await page
    .getByRole("link", { name: "New document", exact: true })
    .filter({ visible: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/docs\/new$/);
  const title = page.getByRole("textbox", { name: "Document title", exact: true });
  await title.fill("Launch plan");
  await title.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.pressSequentially("A clear plan for the launch.");
  await body.press("Enter");
  await body.pressSequentially("Keep every word in your own pod.");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible();
  await page.reload();
  await expect(body).toContainText("A clear plan for the launch.");
  await expect(body).toContainText("Keep every word in your own pod.");
  await expect(title).toHaveValue("Launch plan");
  await body.click();
  await body.press("Control+Home");
  await page.getByRole("combobox", { name: "Block type", exact: true }).selectOption("h1");
  await expect(body.locator("h1")).toHaveText("A clear plan for the launch.");
  await body.press("Control+End");
  await body.press("Enter");
  await format(page, "Checklist");
  await body.pressSequentially("Prepare the release");
  await expect(
    body.getByRole("checkbox", { name: "Prepare the release", exact: true }),
  ).toBeVisible();
  await body.press("Enter");
  await body.press("Enter");
  await body.pressSequentially("/");
  await page.getByRole("combobox", { name: "Filter blocks" }).fill("tab");
  await page.getByRole("combobox", { name: "Filter blocks" }).press("Enter");
  await expect(body.locator("table")).toBeVisible();
  await expect(body.locator("table tr")).toHaveCount(3);
  await expect(body.locator("table th")).toHaveCount(3);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible();
  await body.press("Escape");
  await expect(title).toBeFocused();
  await title.press("Escape");
  await expect(page.getByRole("link", { name: "Back to documents" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await audit(page);
  await page.screenshot({ path: `e2e/screenshots/docs-editor-${suffix}.png`, fullPage: true });
  await page.getByRole("link", { name: "Back to documents" }).click();
  await expect(page.getByRole("link", { name: "Launch plan", exact: true })).toBeVisible();
  await audit(page);
  await page.screenshot({ path: `e2e/screenshots/docs-list-${suffix}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("find replaces atomically and syncs offline edits before reload", async ({
  page,
  context,
}) => {
  const body = await newDocument(page, "Offline notes");
  await body.pressSequentially("cat cat cat");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible();
  await body.press("Control+f");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("cat");
  await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Replace", exact: true }).fill("dog");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(body).toContainText("dog dog dog");
  await page.getByRole("textbox", { name: "Find", exact: true }).press("Escape");
  await expect(body).toBeFocused();
  await context.setOffline(true);
  await body.press("Control+End");
  await body.pressSequentially(" safely offline");
  await expect(
    page.getByRole("status").filter({ hasText: "Offline — saved on this device" }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible();
  await page.reload();
  await expect(body).toContainText("dog dog dog safely offline");
});
