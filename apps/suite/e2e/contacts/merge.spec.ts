// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const row = (page: Page, name: string) => page.getByRole("row", { name, exact: true });
const group = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
async function accessible(page: Page) {
  await expect(page).toHaveTitle("Contacts · Solid Suite");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}
async function openDuplicates(page: Page) {
  await page.goto("/contacts");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("40 contacts");
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const host = narrow
    ? page.getByRole("dialog", { name: "Navigation", exact: true })
    : page.getByRole("complementary", { name: "Contacts navigation", exact: true });
  await host.getByRole("link", { name: "Merge duplicates 3", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Merge duplicates", exact: true })).toBeVisible();
  await expect(page.locator(".con-dup-count")).toHaveText("3 groups");
}

test("merges two contacts with chosen fields, unioning labels and emails, and survives reload", async ({
  page,
}) => {
  await openDuplicates(page);
  await expect(page.locator(".con-dup-group h2")).toHaveText([
    "Lena Frost and L. Frost",
    "Omar Pine and Omar Pine",
    "Theodore Sage and Theo Sage",
  ]);
  const sage = group(page, "Theodore Sage and Theo Sage");
  await expect(sage.getByText("Same email theo.sage@example.org", { exact: true })).toBeVisible();
  await expect(group(page, "Lena Frost and L. Frost")).toContainText("Same phone +1 202 555 0117");
  await accessible(page);

  await sage.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(sage.getByRole("heading", { name: "Choose what to keep" })).toBeFocused();
  const keep = sage.getByRole("radiogroup", { name: "Keep contact", exact: true });
  await expect(keep.getByRole("radio", { name: /^Theodore Sage/ })).toBeChecked();
  await keep.getByRole("radio", { name: /^Theo Sage/ }).click();
  const name = sage.getByRole("radiogroup", { name: "Name", exact: true });
  await expect(name.getByRole("radio", { name: "Theo Sage", exact: true })).toBeChecked();
  await name.getByRole("radio", { name: "Theodore Sage", exact: true }).click();
  await expect(name.getByRole("radio", { name: "Theodore Sage", exact: true })).toBeChecked();
  const summary = sage.locator(".con-dup-summary");
  await expect(summary).toContainText("Fictional Observatory");
  await expect(summary.getByRole("listitem")).toHaveText([
    "theo.sage@example.org",
    "theodore.sage@example.org",
    "+1 202 555 0132",
    "+1 202 555 0127",
  ]);
  await expect(summary).toContainText(/Labels(Book club, Family|Family, Book club)/);
  await accessible(page);

  await sage.getByRole("button", { name: "Merge contacts", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Merge 2 contacts into Theodore Sage?" });
  await expect(dialog).toContainText(
    "Keeps Theo Sage (renamed to Theodore Sage) and deletes Theodore Sage, after adding",
  );
  await accessible(page);
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();

  await expect(sage).toBeHidden();
  await expect(page.getByRole("heading", { name: "Omar Pine and Omar Pine" })).toBeFocused();
  await expect(page.locator(".con-duplicates [role='status']")).toHaveText(
    "Merged 2 contacts into Theodore Sage.",
  );
  await expect(page.locator(".con-dup-count")).toHaveText("2 groups");
  await expect(page.locator(".con-save")).toHaveText("");

  await page.reload();
  await expect(page.locator(".con-dup-count")).toHaveText("2 groups");
  await expect(page.locator(".con-dup-group h2")).toHaveText([
    "Lena Frost and L. Frost",
    "Omar Pine and Omar Pine",
  ]);
  await page.goto("/contacts");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("39 contacts");
  const search = page.getByRole("searchbox", { name: "Search Contacts", exact: true });
  await search.fill("Sage");
  await search.press("Enter");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText(
    "1 contacts matching “Sage”",
  );
  await row(page, "Theodore Sage").press("Enter");
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(detail.getByRole("heading", { name: "Theodore Sage", exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: /^Email Theodore Sage/ })).toHaveText([
    "theo.sage@example.org",
    "theodore.sage@example.org",
  ]);
  await expect(detail.getByRole("link", { name: /^Call Theodore Sage/ })).toHaveCount(2);
  await expect(detail.getByText("Fictional Observatory", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Remove Book club", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Remove Family", exact: true })).toBeVisible();
  await accessible(page);
});

test("Not duplicates is remembered after reload and the last group leaves an empty state", async ({
  page,
}) => {
  await openDuplicates(page);
  const lena = group(page, "Lena Frost and L. Frost");
  await lena.getByRole("button", { name: "Not duplicates", exact: true }).click();
  await expect(lena).toBeHidden();
  await expect(page.getByRole("heading", { name: "Omar Pine and Omar Pine" })).toBeFocused();
  await expect(page.locator(".con-duplicates [role='status']")).toHaveText(
    "Lena Frost and L. Frost are kept as separate contacts.",
  );
  await page.reload();
  await expect(page.locator(".con-dup-count")).toHaveText("2 groups");
  await expect(lena).toBeHidden();

  for (const name of ["Omar Pine and Omar Pine", "Theodore Sage and Theo Sage"]) {
    await group(page, name).getByRole("button", { name: "Not duplicates", exact: true }).click();
  }
  const empty = page.getByRole("heading", { name: "No duplicates", exact: true });
  await expect(empty).toBeFocused();
  await expect(page.locator(".con-dup-count")).toHaveText("0 groups");
  await accessible(page);
  await page.reload();
  await expect(empty).toBeVisible();
  // Both copies remain contacts; only the suggestion is dismissed.
  await page.goto("/contacts");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("40 contacts");
});
