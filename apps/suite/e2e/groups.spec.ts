// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));
test("creates a group, shares a Drive file, and shows its members in Permissions", async ({
  page,
}) => {
  await page.goto("/settings/account");
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  const navigation = page
    .getByRole("navigation", { name: "Settings sections" })
    .filter({ visible: true });
  await navigation.getByRole("link", { name: "Groups & family", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Groups & family", level: 1 })).toBeVisible();
  await expect(page.getByText("Family · Family group", { exact: true })).toBeVisible();
  await expect(page.getByText("Garden team", { exact: true })).toBeVisible();
  const create = page.getByRole("region", { name: "Create group", exact: true });
  await create.getByLabel("Group name", { exact: true }).fill("Book club");
  await create
    .getByRole("combobox", { name: "Add people" })
    .fill("https://bob.example.org/profile#me");
  await create.getByRole("button", { name: "Add person", exact: true }).click();
  await create.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("region", { name: "Book club", exact: true })).toBeVisible();
  await page.goto("/drive");
  const row = page
    .locator("tr[data-url]")
    .filter({ has: page.getByText("notes.md", { exact: true }) });
  await row.focus();
  await row.press("Space");
  await page
    .getByRole("toolbar", { name: "Selection actions" })
    .getByRole("button", { name: "Share", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share “notes.md”" });
  const groupSharing = dialog.getByRole("region", { name: "Group sharing", exact: true });
  await groupSharing.getByRole("combobox", { name: "Add groups" }).fill("Book club");
  await groupSharing.getByRole("option", { name: /Book club/ }).click();
  await groupSharing.getByRole("button", { name: "Share with group", exact: true }).click();
  await expect(groupSharing.getByText("Book club · viewer", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto("/permissions");
  await expect(page.getByRole("link", { name: "Book club", exact: true })).toBeVisible();
  const group = page
    .locator("[data-agent]")
    .filter({ has: page.getByRole("link", { name: "Book club", exact: true }) });
  await group.getByText("Group · 1 members", { exact: true }).click();
  await expect(
    group.getByText("https://bob.example.org/profile#me", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
