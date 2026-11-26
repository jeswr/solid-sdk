// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import {
  accessible,
  contactCount,
  contactRow,
  navigateContacts,
  openContacts,
  searchContacts,
  test,
} from "./helpers";

const vcardFixture = fileURLToPath(new URL("./fixtures/three.vcf", import.meta.url));

test("list, contact card and edit form pass axe and return keyboard focus", async ({ page }) => {
  await openContacts(page);
  await expect(contactRow(page, "Ada Fern")).toBeVisible();
  await accessible(page);
  await searchContacts(page, "Ada Fern");
  await expect(contactCount(page)).toHaveText("1 contacts matching “Ada Fern”");
  const row = contactRow(page, "Ada Fern");
  await row.press("Enter");
  const card = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(card.getByRole("heading", { name: "Ada Fern", exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: /^Email Ada Fern:/ })).toHaveAttribute(
    "href",
    "mailto:ada.fern@example.org",
  );
  await expect(card.getByRole("button", { name: "Back to contacts", exact: true })).toBeFocused();
  await accessible(page);
  await card.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue(
    "Ada Fern",
  );
  await accessible(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByRole("heading", { name: "Ada Fern", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Back to contacts", exact: true }).click();
  await expect(row).toBeFocused();
});

test("creates, searches, edits, trashes and restores a contact across reloads", async ({
  page,
}) => {
  await openContacts(page);
  await navigateContacts(page, /^New contact$/);
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Robin Example");
  await page.getByRole("textbox", { name: "Email 1", exact: true }).fill("robin@example.org");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  const card = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(card.getByRole("heading", { name: "Robin Example", exact: true })).toBeVisible();
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await expect(card.getByRole("heading", { name: "Robin Example", exact: true })).toBeVisible();
  await card.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Robin Example Edited");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(
    card.getByRole("heading", { name: "Robin Example Edited", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".con-save")).toHaveText("");
  await card.getByRole("button", { name: "Back to contacts", exact: true }).click();
  await searchContacts(page, "robin@example.org");
  await expect(contactCount(page)).toHaveText("1 contacts matching “robin@example.org”");
  await contactRow(page, "Robin Example Edited").press("Enter");
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete Robin Example Edited?" });
  await accessible(page);
  await confirmation.getByRole("button", { name: "Delete contact", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No matches", exact: true })).toBeVisible();
  await expect(page.locator(".con-save")).toHaveText("");
  await navigateContacts(page, /^Trash/);
  const trashed = page.getByRole("listitem", { name: "Robin Example Edited", exact: true });
  await expect(trashed).toBeVisible();
  await page.reload();
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: "Restore Robin Example Edited", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeFocused();
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await navigateContacts(page, /^All contacts/);
  await expect(contactCount(page)).toHaveText("41 contacts");
  await searchContacts(page, "robin@example.org");
  await expect(contactRow(page, "Robin Example Edited")).toBeVisible();
  await contactRow(page, "Robin Example Edited").press("Enter");
  await expect(card.getByRole("link", { name: /^Email Robin Example Edited:/ })).toHaveAttribute(
    "href",
    "mailto:robin@example.org",
  );
  await accessible(page);
});

test("three-contact vCard warns about a duplicate and an included copy can be merged", async ({
  page,
}) => {
  await openContacts(page);
  await navigateContacts(page, /^Import$/);
  await expect(page.getByRole("heading", { name: "Choose a source", exact: true })).toBeVisible();
  await accessible(page);
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(vcardFixture);
  await expect(page.getByRole("heading", { name: "Preview contacts", exact: true })).toBeFocused();
  const preview = page.getByRole("table", { name: "Contacts to import", exact: true });
  await expect(preview.getByRole("checkbox")).toHaveCount(3);
  const duplicate = preview.getByRole("checkbox", { name: "Include Mira Quill copy", exact: true });
  await expect(duplicate).not.toBeChecked();
  await expect(duplicate).toHaveAccessibleDescription(/Possible duplicate: Mira Quill/);
  await expect(
    preview.getByRole("checkbox", { name: "Include Import Cedar", exact: true }),
  ).toBeChecked();
  await expect(
    preview.getByRole("checkbox", { name: "Include Import Willow", exact: true }),
  ).toBeChecked();
  await accessible(page);
  await duplicate.check();
  await page.getByRole("button", { name: "Import 3 contacts", exact: true }).click();
  await expect(page.getByText("3 contacts imported. 0 failed.", { exact: true })).toBeVisible();
  await accessible(page);
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expect(contactCount(page)).toHaveText("3 contacts");
  for (const name of ["Mira Quill copy", "Import Cedar", "Import Willow"])
    await expect(contactRow(page, name)).toBeVisible();
  // Reload on the unfiltered list: reloading a queried URL hits the Next route-cache bug tracked separately.
  await navigateContacts(page, /^All contacts/);
  await expect(contactCount(page)).toHaveText("43 contacts");
  await page.reload();
  await expect(contactCount(page)).toHaveText("43 contacts");
  await navigateContacts(page, /^Merge duplicates/);
  const group = page.locator(".con-dup-group").filter({ hasText: "Mira Quill copy" });
  await group.getByRole("button", { name: "Merge", exact: true }).click();
  // Choose the existing contact explicitly, independent of the group's order.
  await group
    .getByRole("radiogroup", { name: "Keep contact", exact: true })
    .getByRole("radio", { name: /^Mira Quill(?! copy)/ })
    .click();
  await group
    .getByRole("radiogroup", { name: "Name", exact: true })
    .getByRole("radio", { name: "Mira Quill", exact: true })
    .click();
  await accessible(page);
  await group.getByRole("button", { name: "Merge contacts", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Merge 2 contacts into Mira Quill?", exact: true })
    .getByRole("button", { name: "Merge", exact: true })
    .click();
  await expect(group).toBeHidden();
  await expect(page.locator(".con-save")).toHaveText("");
  await navigateContacts(page, /^All contacts/);
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(contactCount(page)).toHaveText("42 contacts");
  await searchContacts(page, "mira.quill@example.org");
  await expect(contactCount(page)).toHaveText("1 contacts matching “mira.quill@example.org”");
  await page.reload();
  await expect(contactRow(page, "Mira Quill")).toBeVisible();
  await expect(contactRow(page, "Mira Quill copy")).toHaveCount(0);
  await accessible(page);
});
