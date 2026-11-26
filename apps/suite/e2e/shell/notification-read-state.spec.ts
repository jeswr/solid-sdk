// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, type Page, test } from "@playwright/test";
import { seedDigestNotifications } from "../../src/shell/notifications/demo-digest";
import { demoNotifications } from "../../src/shell/notifications/demo-source";

const demoItems = [...demoNotifications(), ...seedDigestNotifications(new Date())];
const demoUnread = demoItems.filter((item) => !item.read).length;

// The demo pod's seeded legacy plan raises its own tray warning only while a warning window is
// open, which depends on the calendar date, so the fixed demo list is counted without it.
const rowsWith = (page: Page, state: string) =>
  page
    .locator(`li[data-unread${state}]`)
    .filter({ hasNotText: "Your legacy plan needs attention" });

// 1 while the seeded legacy warning is on the tray (it adds one unread to the bell), else 0.
let legacyUnread = 0;

async function notifications(page: Page) {
  await page.goto("/notifications");
  await page.getByRole("heading", { level: 1, name: "Notifications", exact: true }).click();
  await expect(rowsWith(page, "")).toHaveCount(demoItems.length);
  legacyUnread = await page
    .locator("li[data-unread]")
    .filter({ hasText: "Your legacy plan needs attention" })
    .count();
}

function bell(page: Page, unread: number) {
  return page
    .getByRole((page.viewportSize()?.width ?? 1280) < 768 ? "link" : "button", {
      name: `Notifications, ${unread} unread`,
      exact: true,
    })
    .filter({ visible: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/welcome");
  await page.getByRole("button", { name: "Try it with a demo pod", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await notifications(page);
  // Local events (the seeded legacy warning) are listed on the next load, not live: reload so the
  // tray holds its complete list before any count is taken.
  await page.reload();
  await notifications(page);
  await expect(bell(page, demoUnread + legacyUnread)).toBeVisible();
});

test("mark all read survives a full demo pod reload", async ({ page }) => {
  const markAll = page.getByRole("button", { name: "Mark all read", exact: true });
  await markAll.click();
  await expect(bell(page, 0)).toBeVisible();
  await page.reload();
  await expect(rowsWith(page, '="false"')).toHaveCount(demoItems.length);
  await expect(rowsWith(page, '="true"')).toHaveCount(0);
  await expect(markAll).toBeDisabled();
  await expect(bell(page, 0)).toBeVisible();
  await expect(bell(page, 0).getByRole("status")).toHaveCount(0);
});

test("opening one notification saves its read flag before leaving the page", async ({ page }) => {
  await page
    .getByRole("link", { name: "Open Avery Moss shared a folder with you", exact: true })
    .click();
  await expect(page).toHaveURL(/\/drive\/shared$/);
  await page.reload();
  await notifications(page);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Avery Moss shared a folder with you" }),
  ).toHaveAttribute("data-unread", "false");
  await expect(rowsWith(page, '="true"')).toHaveCount(demoUnread - 1);
  await expect(bell(page, demoUnread + legacyUnread - 1)).toBeVisible();
});
