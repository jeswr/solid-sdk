// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}

test("single-key shortcuts can be turned off, and the switch stays reachable", async ({ page }) => {
  await page.goto("/signin?next=%2Fsearch");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByRole("heading", { level: 1 }).click();

  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const toggle = page.getByRole("checkbox", { name: /Use single-key shortcuts/ });
  const sidebar = page.getByRole("button", { name: "Toggle sidebar" });
  await expect(sidebar).toHaveAttribute("aria-keyshortcuts", "[");

  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  await toggle.uncheck();
  await accessible(page);
  await page.keyboard.press("Escape");
  if (await help.isVisible()) await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  // Off: no single key acts, including the frame's own [ and ] keys.
  await page.getByRole("heading", { level: 1 }).click();
  const expanded = await sidebar.getAttribute("aria-expanded");
  await page.keyboard.press("[");
  await page.keyboard.press("?");
  await expect(sidebar).toHaveAttribute("aria-expanded", expanded ?? "");
  await expect(sidebar).not.toHaveAttribute("aria-keyshortcuts", /./);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The palette (a modifier shortcut) still reaches the help sheet and its switch,
  // and closing help returns focus to where the person was before the palette.
  await sidebar.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByText("g d", { exact: true })).toHaveCount(0);
  await page.keyboard.type("Keyboard shortcuts");
  await page.keyboard.press("Enter");
  await expect(help).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.keyboard.press("Escape");
  if (await help.isVisible()) await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(sidebar).toBeFocused();
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
});
