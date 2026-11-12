// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Notes filters compose with text, include archives and survive reload and history", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const label = "Search & plans";
  await page.goto("/notes");
  await page.getByRole("button", { name: "New list", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Filtered errands");
  await page.getByRole("textbox", { name: "List item 1", exact: true }).fill("Milk");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const card = page.getByRole("article", { name: "Filtered errands", exact: true });
  await expect(card).toHaveAttribute("aria-busy", "false");
  await card.hover();
  await card.getByRole("button", { name: "Note colour", exact: true }).click();
  await page.getByRole("radio", { name: "Blue", exact: true }).check();
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "Open Filtered errands", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit note", exact: true });
  await dialog.getByRole("button", { name: "Edit note labels", exact: true }).click();
  await page.getByRole("textbox", { name: "New label", exact: true }).fill(label);
  await page.getByRole("button", { name: "Add label", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Note title", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Saved");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await card.hover();
  await card.getByRole("button", { name: "Archive note", exact: true }).click();
  await expect(card).toHaveCount(0);

  await page.goto("/notes/search");
  await page
    .getByRole("region", { name: "Types", exact: true })
    .getByRole("link", { name: "Lists", exact: true })
    .press("Enter");
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Add filters", exact: true }).click();
  await page
    .getByRole("region", { name: "Colours", exact: true })
    .getByRole("link", { name: "Blue", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Labels", exact: true })
    .getByRole("link", { name: label, exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "Search notes", exact: true });
  await search.fill("milk");
  await search.press("Enter");
  await expect(page.getByText("1 note found", { exact: true })).toHaveAttribute(
    "aria-live",
    "polite",
  );
  const query = new URL(page.url()).searchParams;
  expect(Object.fromEntries(query)).toEqual({ q: "milk", type: "lists", colour: "blue", label });
  await page.reload();
  await expect(card).toBeVisible();
  await expect(search).toHaveValue("milk");
  await page.getByRole("link", { name: "Remove Colour: Blue", exact: true }).press("Enter");
  await expect(page.getByRole("link", { name: "Remove Colour: Blue", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("link", { name: "Remove Colour: Blue", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Clear all", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/notes\/search$/);
  await expect(page.getByRole("region", { name: "Types", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
