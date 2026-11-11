// AUTHORED-BY Codex GPT-6.1-Sol
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

test("first-run empty state offers New contact and Import and passes axe", async ({ page }) => {
  await openContacts(page, "contacts-empty");
  const list = page.getByRole("region", { name: "All contacts", exact: true });
  await expect(list.getByRole("heading", { name: "No contacts yet", exact: true })).toBeVisible();
  await expect(list).toContainText("Add a contact or import a vCard file.");
  await expect(list.getByRole("link", { name: "Import", exact: true })).toBeVisible();
  await accessible(page);
  await list.getByRole("link", { name: "New contact", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(list.getByRole("heading", { name: "No contacts yet", exact: true })).toBeVisible();
  await list.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a source", exact: true })).toBeFocused();
  await accessible(page);
});

test("empty search can be cleared without losing the selected label", async ({ page }) => {
  await openContacts(page);
  await navigateContacts(page, /^Family/);
  await expect(contactCount(page)).toHaveText("14 contacts");
  const labelPath = new URL(page.url()).pathname;
  await searchContacts(page, "no-such-contact-987");
  await expect(page.getByRole("heading", { name: "No matches", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No contacts yet", exact: true })).toBeHidden();
  await accessible(page);
  const clear = page.getByRole("link", { name: "Clear search", exact: true });
  await clear.focus();
  await clear.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${labelPath}$`));
  await expect(contactCount(page)).toHaveText("14 contacts");
  await expect(contactRow(page, "Ada Fern")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search Contacts", exact: true })).toHaveValue(
    "",
  );
  await accessible(page);
});

test("unreachable pod shows an accessible error and Retry recovers the list", async ({ page }) => {
  await openContacts(page);
  // The demo fetch checks navigator.onLine. Keep the app server reachable while
  // making its pod transport fail on a fresh load, without a production test hook.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  await page.reload();
  const list = page.getByRole("region", { name: "All contacts", exact: true });
  const error = list.getByRole("alert");
  await expect(error.getByRole("heading", { name: "Can't reach your storage" })).toBeVisible();
  await expect(error).toContainText(
    "We couldn't load your contacts. Check your connection and try again.",
  );
  await expect(list.getByRole("heading", { name: "No contacts yet", exact: true })).toBeHidden();
  await expect(list.getByRole("button", { name: "Create address book", exact: true })).toBeHidden();
  await accessible(page);
  const retry = error.getByRole("button", { name: "Retry", exact: true });
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  await expect(error).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
  await retry.press("Enter");
  await expect(contactCount(page)).toHaveText("40 contacts");
  await expect(error).toBeHidden();
  await expect(contactRow(page, "Ada Fern")).toBeVisible();
  await accessible(page);
});
