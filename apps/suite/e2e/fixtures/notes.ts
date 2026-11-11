// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

export { expect };
export const test = base.extend<{ demoSession: undefined }>({
  demoSession: [
    async ({ page }, use) => {
      await seedDemoSession(page);
      await use(undefined);
    },
    { auto: true },
  ],
});

export async function audit(page: Page, state: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const severe = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const width = page.viewportSize()?.width;
  await test.info().attach(`axe-${state}-${width}`, {
    body: JSON.stringify({ state, width, project: test.info().project.name, violations }, null, 2),
    contentType: "application/json",
  });
  expect(severe, `${state} at ${width}px`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function folders(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Notes folders", exact: true });
  if (!(await navigation.filter({ visible: true }).count()))
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  return navigation.filter({ visible: true });
}

export async function navigate(page: Page, label: string) {
  const link = (await folders(page)).getByRole("link", { name: label, exact: true });
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeHidden();
  // Cards can be visible in both folders; wait for the route itself before reloading.
  if (href) await expect(page).toHaveURL((url) => url.pathname === href);
}

export function card(page: Page, title: string) {
  return page.getByRole("article", { name: title, exact: true });
}

export async function capture(page: Page, title: string, body: string) {
  await page.getByRole("textbox", { name: "Take a note", exact: true }).focus();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Note text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page, title)).toHaveAttribute("aria-busy", "false");
}

export async function openNote(page: Page, title: string) {
  await card(page, title)
    .getByRole("button", { name: title })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit note", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Note body", exact: true })).toBeVisible();
  return dialog;
}

export async function trashNote(page: Page, title: string) {
  await card(page, title).hover();
  await card(page, title).getByRole("button", { name: "More note actions", exact: true }).click();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(card(page, title)).toHaveCount(0);
  await page.keyboard.press("Escape");
}
