// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, type Page, test } from "@playwright/test";
import { seedDigestNotifications } from "../../src/shell/notifications/demo-digest";
import { demoNotifications } from "../../src/shell/notifications/demo-source";

const demoItems = [...demoNotifications(), ...seedDigestNotifications(new Date())];
const demoUnread = demoItems.filter((item) => !item.read).length;

async function notifications(page: Page) {
  await page.goto("/notifications");
  await page.getByRole("heading", { level: 1, name: "Notifications", exact: true }).click();
  await expect(page.locator("li[data-unread]")).toHaveCount(demoItems.length);
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
  await expect(bell(page, demoUnread)).toBeVisible();
});

test("mark all read survives a full demo pod reload", async ({ page }) => {
  const markAll = page.getByRole("button", { name: "Mark all read", exact: true });
  await markAll.click();
  await expect(bell(page, 0)).toBeVisible();
  await page.reload();
  await expect(page.locator('li[data-unread="false"]')).toHaveCount(demoItems.length);
  await expect(page.locator('li[data-unread="true"]')).toHaveCount(0);
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
  await expect(page.locator('li[data-unread="true"]')).toHaveCount(demoUnread - 1);
  await expect(bell(page, demoUnread - 1)).toBeVisible();
});
