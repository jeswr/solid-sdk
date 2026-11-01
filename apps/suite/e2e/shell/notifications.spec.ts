// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, name: string, project: string) {
  await accessible(page);
  const directory = "../../artifacts/playwright/shell";
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/notifications-${name}-${project}.png`,
    fullPage: true,
  });
}
async function demo(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/drive(?:\/my)?$/);
  await page.goto("/search");
}
async function open(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  const bell = page
    .getByRole(mobile ? "link" : "button", { name: "Notifications, 4 unread", exact: true })
    .filter({ visible: true });
  await expect(bell).toBeVisible();
  await expect(bell.getByRole("status", { name: "4 unread", exact: true })).toBeVisible();
  await bell.focus();
  await bell.press("Enter");
  if (mobile) await expect(page).toHaveURL(/\/notifications$/);
  else await expect(page.getByRole("dialog", { name: "Notifications", exact: true })).toBeVisible();
}

test("demo tray groups notifications, approves Editor, marks read and dismisses all", async ({
  page,
}, info) => {
  await demo(page);
  await open(page);
  await expect(page.getByRole("region", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Earlier", exact: true })).toBeVisible();
  await capture(page, "populated", info.project.name);
  const row = page.getByRole("listitem").filter({ hasText: "Rowan Vale requested access" });
  await row.getByRole("combobox", { name: "Role", exact: true }).click();
  await page.getByRole("option", { name: "Editor", exact: true }).click();
  await expect(row.getByText("Not available on this storage", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("Approved for Editor");
  await capture(page, "approved", info.project.name);
  await page.getByRole("button", { name: "Mark all read", exact: true }).click();
  const bell = page
    .getByRole((page.viewportSize()?.width ?? 1280) < 768 ? "link" : "button", {
      name: "Notifications, 0 unread",
      exact: true,
    })
    .filter({ visible: true });
  await expect(bell).toBeVisible();
  await expect(bell.getByRole("status")).toHaveCount(0);
  for (let i = 0; i < 6; i++)
    await page
      .getByRole("button", { name: /^Dismiss / })
      .first()
      .click();
  await expect(page.getByText("You're all caught up", { exact: true })).toBeVisible();
  await capture(page, "empty", info.project.name);
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    await page.keyboard.press("Escape");
    if (await page.getByRole("dialog", { name: "Notifications", exact: true }).count())
      await page.keyboard.press("Escape");
    await expect(bell).toBeFocused();
  }
});

test("fixture covers loading, errors, decision retry, durations and sync conflicts", async ({
  page,
}, info) => {
  await page.goto("/dev/components/notifications-tray");
  await page.getByRole("checkbox", { name: "Show list", exact: true }).check();
  await page.getByLabel("Fixture state", { exact: true }).selectOption("loading");
  await expect(
    page.getByRole("status", { name: "Loading notifications", exact: true }),
  ).toBeVisible();
  await capture(page, "loading", info.project.name);
  await page.getByLabel("Fixture state", { exact: true }).selectOption("error");
  await expect(page.getByRole("alert").filter({ hasText: /Couldn't load/ })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await capture(page, "error", info.project.name);
  await page.getByLabel("Fixture state", { exact: true }).selectOption("decision-error");
  const row = page.getByRole("listitem").filter({ hasText: "Rowan Vale requested access" });
  await row.getByRole("combobox", { name: "Role", exact: true }).click();
  await page.getByRole("option", { name: "Editor", exact: true }).click();
  await row.getByRole("radio", { name: "1 day", exact: true }).click();
  await expect(row.getByRole("radio", { name: "1 day", exact: true })).toBeChecked();
  await expect(row.getByRole("radio", { name: "Custom", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(row.getByRole("alert")).toContainText("Couldn't save this decision");
  await capture(page, "decision-error", info.project.name);
  await row.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("Approved for Editor");
  await page.getByRole("button", { name: "Open sync details", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Project plan");
  await capture(page, "sync", info.project.name);
});

test("keyboard denial, notification shortcut and 320px reflow", async ({ page }, info) => {
  await demo(page);
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/notifications$/);
  await page.setViewportSize({ width: 320, height: 900 });
  const row = page.getByRole("listitem").filter({ hasText: "Rowan Vale requested access" });
  const deny = row.getByRole("button", { name: "Deny", exact: true });
  await deny.focus();
  await deny.press("Enter");
  await expect(row.getByRole("status")).toHaveText("Denied");
  await capture(page, "320-denied", info.project.name);
});
