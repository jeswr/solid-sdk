// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const row = (page: Page, name: string) => page.getByRole("row", { name, exact: true });
const count = (page: Page) => page.locator(".con-list-heading").getByRole("status");
const trashItem = (page: Page, name: string) =>
  page.getByRole("list", { name: "Trash", exact: true }).getByRole("listitem", { name });
async function accessible(page: Page) {
  await expect(page).toHaveTitle("Contacts · Solid Suite");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}
async function navigation(page: Page, name: RegExp) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name })
      .click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeHidden();
  } else
    await page
      .getByRole("complementary", { name: "Contacts navigation", exact: true })
      .getByRole("link", { name })
      .click();
}
async function open(page: Page) {
  await page.goto("/contacts");
  await expect(count(page)).toHaveText("40 contacts");
}
async function deleteContact(page: Page, name: string, remaining: number) {
  await row(page, name).press("Enter");
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(detail.getByRole("heading", { name })).toBeVisible();
  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("It moves to Trash, where you can restore it for 30 days.");
  await dialog.getByRole("button", { name: "Delete contact", exact: true }).click();
  await expect(count(page)).toHaveText(`${remaining} contacts`);
  await expect(page.locator(".con-save")).toHaveText("");
}
async function openTrash(page: Page) {
  await navigation(page, /^Trash/);
  await expect(page).toHaveURL(/\/contacts\/trash$/);
  await expect(page.getByRole("heading", { level: 1, name: "Trash", exact: true })).toBeVisible();
}

test("a deleted contact moves to Trash and is restored with its labels", async ({ page }) => {
  await open(page);
  await deleteContact(page, "Ada Fern", 39);
  await expect(page.getByText("Contact moved to Trash", { exact: true })).toBeVisible();
  await openTrash(page);
  const item = trashItem(page, "Ada Fern");
  await expect(item).toContainText(/Deleted \w{3} \d{1,2}, \d{4} · Family/);
  await expect(page.locator(".con-trash-count")).toHaveText("1 contact");
  await accessible(page);

  // It survives a reload and stays out of the list, search and its label.
  await page.reload();
  await expect(trashItem(page, "Ada Fern")).toBeVisible();
  await navigation(page, /^All contacts/);
  await expect(count(page)).toHaveText("39 contacts");
  const search = page.getByRole("searchbox", { name: "Search Contacts", exact: true });
  await search.fill("Ada Fern");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No matches", exact: true })).toBeVisible();
  await navigation(page, /^Family/);
  await expect(row(page, "Ada Fern")).toHaveCount(0);

  await openTrash(page);
  await trashItem(page, "Ada Fern").getByRole("button", { name: "Restore Ada Fern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ada Fern restored" })).toHaveText(
    "Ada Fern restored to your contacts.",
  );
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeFocused();
  await expect(page.locator(".con-save")).toHaveText("");
  await accessible(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeVisible();
  await navigation(page, /^Family/);
  await expect(row(page, "Ada Fern")).toBeVisible();
});

test("delete for ever and Empty trash ask first and persist across reload", async ({ page }) => {
  await open(page);
  await deleteContact(page, "Ada Fern", 39);
  await deleteContact(page, "Amir Vale", 38);
  await deleteContact(page, "Bea Linden", 37);
  await openTrash(page);
  const list = page.getByRole("list", { name: "Trash", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("heading", { level: 2 })).toHaveText([
    "Bea Linden",
    "Amir Vale",
    "Ada Fern",
  ]);
  await expect(trashItem(page, "Amir Vale")).toContainText("Work");

  // Cancelling keeps the item and returns focus to its button.
  const forever = trashItem(page, "Amir Vale").getByRole("button", {
    name: "Delete for ever Amir Vale",
  });
  await forever.click();
  const dialog = page.getByRole("alertdialog", { name: "Delete Amir Vale for ever?" });
  await expect(dialog).toContainText("This can't be undone.");
  await accessible(page);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(forever).toBeFocused();

  await forever.click();
  await dialog.getByRole("button", { name: "Delete for ever", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Restore Ada Fern" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "deleted for ever" })).toHaveText(
    "Amir Vale deleted for ever.",
  );
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Bea Linden", "Ada Fern"]);

  await page.getByRole("button", { name: "Empty trash", exact: true }).click();
  const empty = page.getByRole("alertdialog", { name: "Empty trash?" });
  await expect(empty).toContainText("All 2 contacts are deleted permanently.");
  await empty.getByRole("button", { name: "Empty trash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Trash emptied." })).toBeVisible();
  await expect(page.locator(".con-save")).toHaveText("");
  await accessible(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeVisible();
  await navigation(page, /^All contacts/);
  await expect(count(page)).toHaveText("37 contacts");
});

test("Undo after delete restores from Trash", async ({ page }) => {
  await open(page);
  await deleteContact(page, "Bea Linden", 39);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row(page, "Bea Linden")).toBeVisible();
  await expect(row(page, "Bea Linden")).toContainText("Book club");
  await expect(page.locator(".con-save")).toHaveText("");
  await openTrash(page);
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeVisible();
});
