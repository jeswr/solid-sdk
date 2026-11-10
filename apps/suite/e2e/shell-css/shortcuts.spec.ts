// AUTHORED-BY Codex GPT-6.1-Sol
import { accessible, expect, tabTo, test } from "./fixtures";

test("scenario 12: /, ?, [ and g d work in the authenticated shell", async ({ page }) => {
  await page.goto("/home");
  await page.keyboard.press("/");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await expect(search).toBeFocused();
  await accessible(page);
  await page.keyboard.press("Escape");

  const sidebar = page.getByRole("button", { name: "Toggle sidebar", exact: true });
  await tabTo(page, sidebar);
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(help).toBeVisible();
  await expect(help.getByText("Go to Drive", { exact: true })).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  if (await help.isVisible()) await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(sidebar).toBeFocused();

  const expanded = await sidebar.getAttribute("aria-expanded");
  await page.keyboard.press("[");
  await expect(sidebar).toHaveAttribute("aria-expanded", expanded === "true" ? "false" : "true");
  await accessible(page);
  await page.keyboard.press("[");
  await expect(sidebar).toHaveAttribute("aria-expanded", expanded ?? "false");
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/drive(?:\/my)?\/?$/);
  await accessible(page);
});
