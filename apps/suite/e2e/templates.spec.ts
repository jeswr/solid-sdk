// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo Docs creates Meeting notes, saves a pod template and reuses it", async ({ page }) => {
  await page.goto("/welcome?next=%2Fdocs");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await page.getByRole("button", { name: "From template…", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "New from template" });
  await expect(
    gallery.getByRole("button", { name: "Use Team standup", exact: true }),
  ).toBeVisible();
  const audit = await new AxeBuilder({ page }).analyze();
  expect(
    audit.violations.filter((value) => ["serious", "critical"].includes(value.impact ?? "")),
  ).toEqual([]);
  await gallery.getByRole("button", { name: "Use Meeting notes", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/d\//);
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await expect(body).toContainText("Attendees");
  await expect(body).toContainText("Action items");
  const menus = page.getByRole("menubar", { name: "Document menus" });
  await menus.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save as template", exact: true }).click();
  const save = page.getByRole("dialog", { name: "Save as template" });
  await save.getByLabel("Template name", { exact: true }).fill("My meeting starter");
  await save.getByRole("button", { name: "Save template", exact: true }).click();
  await expect(save).toBeHidden();
  await page.goto("/docs");
  await page.getByRole("button", { name: "From template…", exact: true }).click();
  await gallery.getByLabel("Template source", { exact: true }).selectOption("user");
  await expect(
    gallery.getByRole("button", { name: "Use My meeting starter", exact: true }),
  ).toBeVisible();
  await expect(
    gallery.getByRole("button", { name: "Use My meeting starter", exact: true }),
  ).toHaveAccessibleDescription(/Attendees/);
  await gallery.getByRole("button", { name: "Use My meeting starter", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(body).toContainText("Attendees");
  await page.reload();
  await expect(body).toContainText("Action items");
  await page.goto("/docs");
  await page.getByRole("button", { name: "From template…", exact: true }).click();
  await gallery.getByLabel("Template source", { exact: true }).selectOption("user");
  await gallery
    .getByRole("button", { name: "Delete template My meeting starter", exact: true })
    .click();
  await expect(gallery.getByRole("button", { name: "Cancel deletion", exact: true })).toBeFocused();
  await gallery.getByRole("button", { name: "Cancel deletion", exact: true }).click();
  await expect(
    gallery.getByRole("button", { name: "Delete template My meeting starter", exact: true }),
  ).toBeFocused();
  await gallery
    .getByRole("button", { name: "Delete template My meeting starter", exact: true })
    .click();
  await gallery.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(
    gallery.getByRole("button", { name: "Use My meeting starter", exact: true }),
  ).toBeHidden();
  await expect(
    gallery.getByRole("button", { name: "Use Team standup", exact: true }),
  ).toBeFocused();
});
