// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/search");
  await page.getByRole("heading", { level: 1, name: "Search", exact: true }).click();
}
async function tray(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) {
    await page
      .getByRole("link", { name: /^Notifications, / })
      .filter({ visible: true })
      .click();
    return page.locator("main");
  }
  const dialog = page.getByRole("dialog", { name: "Notifications", exact: true });
  if (!(await dialog.isVisible()))
    await page
      .getByRole("button", { name: /^Notifications, / })
      .filter({ visible: true })
      .click();
  return dialog;
}
async function pageBody(page: Page) {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
}

test("notification undo works from toast and page keyboard while search keeps native text undo", async ({
  page,
}) => {
  await signIn(page);
  let panel = await tray(page);
  const first = "Avery Moss shared a folder with you";
  await panel.getByRole("button", { name: `Dismiss ${first}`, exact: true }).click();
  await expect(panel.getByRole("button", { name: `Dismiss ${first}`, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).last().click();
  panel = await tray(page);
  await expect(panel.getByRole("button", { name: `Dismiss ${first}`, exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Undone$/ })
      .last(),
  ).toBeVisible();

  const second = "Avery Moss mentioned you in a comment";
  await panel.getByRole("button", { name: `Dismiss ${second}`, exact: true }).click();
  await pageBody(page);
  await page.keyboard.press("Control+z");
  panel = await tray(page);
  await expect(panel.getByRole("button", { name: `Dismiss ${second}`, exact: true })).toBeVisible();
  await pageBody(page);
  await page.keyboard.press("Control+Shift+z");
  panel = await tray(page);
  await expect(panel.getByRole("button", { name: `Dismiss ${second}`, exact: true })).toHaveCount(
    0,
  );

  await page.keyboard.press("Escape");
  const search = page.locator("input[data-global-search]").filter({ visible: true });
  if (!(await search.count()))
    await page
      .getByRole("button", { name: "Search", exact: true })
      .filter({ visible: true })
      .click();
  const input = page.locator("input[data-global-search]").filter({ visible: true });
  await input.fill("completion");
  await input.press("Control+z");
  // Dismiss any search dialog/suggestions before reopening the same route's notification tray.
  await input.press("Escape");
  await page.keyboard.press("Escape");
  panel = await tray(page);
  await expect(panel.getByRole("button", { name: `Dismiss ${second}`, exact: true })).toHaveCount(
    0,
  );
});
