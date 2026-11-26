// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { expect, type Page } from "@playwright/test";
import { accessible, test } from "./helpers";

async function newContact(page: Page) {
  await page.goto("/contacts");
  await expect(page.locator(".con-list-heading").getByRole("status")).toHaveText("40 contacts");
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const host = narrow
    ? page.getByRole("dialog", { name: "Navigation", exact: true })
    : page.getByRole("complementary", { name: "Contacts navigation", exact: true });
  const link = host.getByRole("link", { name: "New contact", exact: true });
  if (await link.count()) await link.click();
  else await host.getByRole("button", { name: "New contact", exact: true }).click();
}
const box = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

test("adds, edits and removes postal addresses, shown formatted on the card", async ({ page }) => {
  await newContact(page);
  await box(page, "Full name").fill("Postal Person");
  await page.getByRole("button", { name: "Add address", exact: true }).click();
  const kind = page.getByRole("combobox", { name: "Address 1 type", exact: true });
  await expect(kind).toBeFocused();
  await kind.selectOption("home");
  await box(page, "Street").fill("12 Example Lane\nFlat 3");
  await box(page, "City").fill("Springfield");
  await box(page, "State or region").fill("IL");
  await box(page, "Postal code").fill("62701");
  await box(page, "Country").fill("US");
  await accessible(page);
  await page.getByRole("button", { name: "Save contact", exact: true }).click();

  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  const home = detail.getByRole("link", {
    name: "Map home address for Postal Person: 12 Example Lane, Flat 3, Springfield, IL 62701 (opens in a new tab)",
    exact: true,
  });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("target", "_blank");
  await expect(home.locator(".con-address-text")).toHaveText(
    "12 Example Lane\nFlat 3\nSpringfield, IL 62701",
  );
  await expect(page.locator(".con-save")).toHaveText("");
  await accessible(page);

  // Edit: add a work address, then remove the first; focus moves to the survivor.
  await detail.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(box(page, "Street")).toHaveValue("12 Example Lane\nFlat 3");
  await page.getByRole("button", { name: "Add address", exact: true }).click();
  await page.getByRole("combobox", { name: "Address 2 type", exact: true }).selectOption("work");
  await page.getByRole("textbox", { name: "City", exact: true }).nth(1).fill("Paris");
  await page.getByRole("textbox", { name: "Country", exact: true }).nth(1).fill("France");
  await page.getByRole("button", { name: "Remove address 1", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Address 1 type", exact: true })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Address 1 type", exact: true })).toHaveValue(
    "work",
  );
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  const work = detail.getByRole("link", {
    name: /^Map work address for Postal Person: Paris, France/,
  });
  await expect(work).toBeVisible();
  await expect(detail.getByRole("link", { name: /^Map home address/ })).toHaveCount(0);
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await expect(work).toBeVisible();

  // Removing the last address clears it from the pod.
  await detail.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Remove address 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add address", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Postal Person", exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: /^Map / })).toHaveCount(0);
  await expect(page.locator(".con-save")).toHaveText("");
  await page.reload();
  await expect(detail.getByRole("heading", { name: "Postal Person", exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: /^Map / })).toHaveCount(0);
});

test("a seventeenth address is refused with a focused, announced error", async ({ page }) => {
  await newContact(page);
  await box(page, "Full name").fill("Crowded Person");
  const add = page.getByRole("button", { name: "Add address", exact: true });
  for (let i = 0; i < 17; i++) await add.click();
  for (let i = 0; i < 17; i++)
    await page.getByRole("textbox", { name: "City", exact: true }).nth(i).fill(`Town ${i}`);
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at most 16" })).toHaveText(
    "A contact can have at most 16 addresses.",
  );
  await expect(add).toBeFocused();
  await page.getByRole("button", { name: "Remove address 17", exact: true }).click();
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  const detail = page.getByRole("region", { name: "Contact details", exact: true });
  await expect(detail.getByRole("link", { name: /^Map address for Crowded Person/ })).toHaveCount(
    16,
  );
});
