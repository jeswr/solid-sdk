// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the shell shows the offline pill and its sync sheet while offline", async ({
  page,
  context,
}) => {
  await page.goto("/signin?next=%2Fsearch");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/search$/);
  const pill = page.getByRole("button", { name: "Offline — showing saved copies" });
  await expect(pill).toHaveCount(0);
  await context.setOffline(true);
  await expect(pill).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  await pill.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Everything is saved");
  await page.keyboard.press("Escape");
  if (await sheet.isVisible()) await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(pill).toBeFocused();
  await context.setOffline(false);
  await expect(pill).toHaveCount(0);
});
