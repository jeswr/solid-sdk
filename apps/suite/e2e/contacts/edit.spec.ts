// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { parseVCards } from "../../src/apps/contacts/lib/vcard";
import { accessible, test } from "./helpers";

const fixture = fileURLToPath(new URL("./fixtures/three.vcf", import.meta.url));

async function open(page: Page) {
  await page.goto("/contacts");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("40 contacts");
}
async function sidebar(page: Page, name: string) {
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const host = narrow
    ? page.getByRole("dialog", { name: "Navigation", exact: true })
    : page.getByRole("complementary", { name: "Contacts navigation", exact: true });
  const link = host.getByRole("link", { name, exact: true });
  if (await link.count()) await link.click();
  else await host.getByRole("button", { name, exact: true }).click();
}

test("create two emails and a phone, edit, and export a parseable address book", async ({
  page,
}) => {
  await open(page);
  await sidebar(page, "New contact");
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Lane Contact");
  await page.getByRole("textbox", { name: "Email 1", exact: true }).fill("lane@example.org");
  await page.getByRole("button", { name: "Add email", exact: true }).click();
  await page.getByRole("textbox", { name: "Email 2", exact: true }).fill("lane.work@example.org");
  await page.getByRole("textbox", { name: "Phone 1", exact: true }).fill("+1 (202) 555-0193");
  await accessible(page);
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(detail.getByRole("heading", { name: "Lane Contact", exact: true })).toBeVisible();
  await expect(
    detail.getByRole("link", { name: "Email Lane Contact: lane.work@example.org", exact: true }),
  ).toHaveAttribute("href", "mailto:lane.work@example.org");
  await expect(detail.locator('a[href="tel:+12025550193"]')).toBeVisible();
  await expect(page.locator(".con-save")).toHaveText("");
  await detail.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Email 2", exact: true })).toHaveValue(
    "lane.work@example.org",
  );
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Lane Contact Edited");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(
    detail.getByRole("heading", { name: "Lane Contact Edited", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await expect(
    detail.getByRole("heading", { name: "Lane Contact Edited", exact: true }),
  ).toBeVisible();
  const singleDownload = page.waitForEvent("download");
  await detail.getByRole("button", { name: "Export (.vcf)", exact: true }).click();
  const singlePath = await (await singleDownload).path();
  expect(parseVCards(await readFile(singlePath as string, "utf8"))).toMatchObject([
    { fn: "Lane Contact Edited" },
  ]);
  await detail.getByRole("button", { name: "Back to contacts", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Contacts", exact: true });
  await search.fill("Lane Contact Edited");
  await search.press("Enter");
  await expect(page.getByRole("row", { name: "Lane Contact Edited", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await sidebar(page, "Export all (.vcf)");
  const path = await (await download).path();
  const cards = parseVCards(await readFile(path as string, "utf8"));
  expect(cards).toHaveLength(41);
  expect(cards.find((card) => card.fn === "Lane Contact Edited")?.emails).toHaveLength(2);
});

test("announces validation, focuses the first error, hints duplicates and confirms discard", async ({
  page,
}) => {
  await open(page);
  await sidebar(page, "New contact");
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Draft");
  await page.getByRole("textbox", { name: "Email 1", exact: true }).fill("broken");
  await page.getByRole("textbox", { name: "WebID", exact: true }).fill("http://example.org/id#me");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.locator(".con-form-summary")).toHaveText("2 fields need attention");
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a valid email address." }),
  ).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "absolute HTTPS WebID" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email 1", exact: true })).toBeFocused();
  await accessible(page);
  await page.getByRole("textbox", { name: "Email 1", exact: true }).fill("mira.quill@example.org");
  await expect(
    page.getByRole("link", { name: "Mira Quill already uses this email", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await accessible(page);
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue("Draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page).toHaveURL(/\/contacts$/);
});

test("imports only the two nonduplicate vCards with accessible source, preview and results", async ({
  page,
}) => {
  await open(page);
  await sidebar(page, "Import");
  await expect(page.getByRole("heading", { name: "Choose a source", exact: true })).toBeVisible();
  await accessible(page);
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(fixture);
  await expect(page.getByRole("heading", { name: "Preview contacts", exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Include Mira Quill copy", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByText("Possible duplicate: Mira Quill.", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Include Import Cedar", exact: true }),
  ).toBeChecked();
  await accessible(page);
  await page.getByRole("button", { name: "Import 2 contacts", exact: true }).click();
  await expect(page.getByText("2 contacts imported. 0 failed.", { exact: true })).toBeVisible();
  await accessible(page);
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Imported contacts", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Import Cedar", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Import Willow", exact: true })).toBeVisible();
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("2 contacts");
  await page.goto("/contacts");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("42 contacts");
});

test("CardDAV explains its offline requirement without disabling file import", async ({
  page,
  context,
}) => {
  await open(page);
  await sidebar(page, "Import");
  // Go offline only once the client navigation has loaded, or the route itself fails to load.
  await expect(page.getByRole("heading", { name: "Choose a source", exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "From a CardDAV server", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Reconnect to import from a CardDAV server.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload files", exact: true })).toBeEnabled();
  await accessible(page);
  await context.setOffline(false);
});

test("closing the only Starred contact after unstarring focuses the empty-state action", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("row", { name: "Ada Fern", exact: true })
    .getByRole("button", { name: "Star Ada Fern", exact: true })
    .click();
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const nav = narrow
    ? page.getByRole("dialog", { name: "Navigation", exact: true })
    : page.getByRole("complementary", { name: "Contacts navigation", exact: true });
  await nav.getByRole("link", { name: /^Starred/ }).click();
  await page.getByRole("row", { name: "Ada Fern", exact: true }).press("Enter");
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await detail.getByRole("button", { name: "Star Ada Fern", exact: true }).click();
  await detail.getByRole("button", { name: "Back to contacts", exact: true }).click();
  await expect(
    page.locator(".con-list").getByRole("link", { name: "New contact", exact: true }),
  ).toBeFocused();
});
