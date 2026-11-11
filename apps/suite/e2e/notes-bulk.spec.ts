// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function audit(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
async function navigate(page: Page, label: string) {
  const link = page
    .getByRole("navigation", { name: "Notes folders", exact: true })
    .getByRole("link", { name: label, exact: true })
    .filter({ visible: true });
  if (!(await link.count()))
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await link.click();
}
function card(page: Page, title: string) {
  return page.getByRole("article", { name: title, exact: true });
}
async function capture(page: Page, title: string, body: string) {
  await page.getByRole("textbox", { name: "Take a note", exact: true }).focus();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Note text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card(page, title)).toHaveAttribute("aria-busy", "false");
}

test("bulk selection archives and restores notes and the keyboard help pauses shortcuts", async ({
  page,
}) => {
  await page.goto("/notes");
  await capture(page, "Bulk first", "First note");
  await capture(page, "Bulk second", "Second note");
  await card(page, "Bulk first").hover();
  await page.getByRole("checkbox", { name: "Select Bulk first", exact: true }).check();
  await card(page, "Bulk second").hover();
  await page.getByRole("checkbox", { name: "Select Bulk second", exact: true }).check();
  await expect(page.getByRole("heading", { name: "2 selected", exact: true })).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Selected notes", exact: true });
  await toolbar.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(card(page, "Bulk first")).toHaveCount(0);
  await expect(card(page, "Bulk second")).toHaveCount(0);
  await navigate(page, "Archive");
  await card(page, "Bulk first").hover();
  await page.getByRole("checkbox", { name: "Select Bulk first", exact: true }).check();
  await card(page, "Bulk second").hover();
  await page.getByRole("checkbox", { name: "Select Bulk second", exact: true }).check();
  await toolbar.getByRole("button", { name: "Unarchive", exact: true }).click();
  await navigate(page, "Notes");
  await expect(card(page, "Bulk first")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("j");
  await expect(page.locator(".notes-card-body:focus")).toHaveCount(1);
  await page.keyboard.press("x");
  await expect(page.getByRole("heading", { name: "1 selected", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(help.getByRole("rowheader", { name: "Next note", exact: true })).toBeVisible();
  await page.keyboard.press("e");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "1 selected", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  await audit(page);
  await page.reload();
  await expect(card(page, "Bulk first")).toBeVisible();
  await expect(card(page, "Bulk second")).toBeVisible();
});
