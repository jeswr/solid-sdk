// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test("walkthrough ticks survive reload and Go starts the demo with a collapsible guide", async ({
  page,
}) => {
  await page.goto("/welcome/walkthrough");
  const home = page.getByRole("checkbox", { name: "I have tried Home", exact: true });
  await home.check();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("suite.walkthrough.v1") ?? "null")),
    )
    .toEqual({ done: ["home"] });
  await page.reload();
  await expect(home).toBeChecked();
  await page.locator("#step-drive").getByRole("link", { name: "Go", exact: true }).click();
  await expect(page).toHaveURL(/\/drive\/my$/);
  const guide = page.getByRole("complementary", { name: "Walkthrough guide" });
  await expect(guide.getByRole("heading")).toHaveText("Try now: Drive");
  await expect(guide).toContainText("Next: Docs");
  await guide.getByRole("button", { name: "Collapse guide" }).click();
  await expect(guide.getByRole("heading")).toBeHidden();
  await guide.getByRole("button", { name: "Open guide" }).click();
  // Completing the current step immediately replaces it with the next unticked step.
  await guide.getByRole("checkbox", { name: "I have tried Drive", exact: true }).click();
  await expect(guide.getByRole("heading")).toHaveText("Try now: Docs");
  await page.reload();
  await expect(guide.getByRole("heading")).toHaveText("Try now: Docs");
  await guide.getByRole("button", { name: "Dismiss guide" }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(guide).toHaveCount(0);
  await page.goto("/welcome/walkthrough");
  await expect(
    page.getByRole("checkbox", { name: "I have tried Drive", exact: true }),
  ).toBeChecked();
  await page.locator("#step-docs").getByRole("link", { name: "Go", exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("link", { name: "Give feedback", exact: true })).toBeInViewport();
  await expect(guide.getByRole("heading")).toHaveText("Try now: Docs");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("walkthrough remains usable when progress storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("suite.walkthrough.")) throw new Error("Storage blocked");
      return setItem.call(this, key, value);
    };
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("suite.walkthrough.")) throw new Error("Storage blocked");
      return getItem.call(this, key);
    };
  });
  await page.goto("/welcome/walkthrough");
  await expect(
    page.getByRole("heading", { name: "Guided walkthrough", exact: true }),
  ).toBeVisible();
  const drive = page.getByRole("checkbox", { name: "I have tried Drive", exact: true });
  await drive.check();
  await expect(drive).toBeChecked();
  await drive.uncheck();
  await expect(drive).not.toBeChecked();
});
