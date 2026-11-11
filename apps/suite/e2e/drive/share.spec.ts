// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));

const BOB = "https://bob.example.org/profile#me";

async function resetDemo(page: Page) {
  await page.route("**/__share-test-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__share-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo database deletion blocked"));
    });
  });
  await page.unroute("**/__share-test-reset");
}

test("shares a file as Editor, persists across reload, enables link access and removes the person", async ({
  page,
}) => {
  await resetDemo(page);
  await page.goto("/drive");
  const row = page
    .locator("tr[data-url]")
    .filter({ has: page.getByText("notes.md", { exact: true }) });
  // On phones a row click opens the preview; Space selects at every viewport.
  await row.focus();
  await row.press("Space");
  await page
    .getByRole("toolbar", { name: "Selection actions" })
    .getByRole("button", { name: "Share", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Share “notes.md”" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1280);
  await dialog.getByRole("combobox", { name: "Add people" }).fill(BOB);
  await dialog.getByRole("button", { name: "Add person" }).click();
  await dialog.getByLabel("Role for added people").selectOption("editor");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveValue("editor");
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await row.focus();
  await row.press("Space");
  await page
    .getByRole("toolbar", { name: "Selection actions" })
    .getByRole("button", { name: "Share", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Share “notes.md”" });
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveValue("editor");
  await dialog.getByLabel("Who can access").selectOption("anyone");
  await expect(dialog.getByLabel("Link role")).toHaveValue("viewer");
  await dialog.getByRole("button", { name: `Remove access for ${BOB}` }).click();
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
});

test("shows folder sharing as read-only with every edit control disabled", async ({ page }) => {
  await resetDemo(page);
  await page.goto("/drive");
  const row = page.locator("tr[data-url]").filter({ has: page.getByText("Work", { exact: true }) });
  await row.focus();
  await row.press("Space");
  await page
    .getByRole("toolbar", { name: "Selection actions" })
    .getByRole("button", { name: "Share", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Share “Work”" });
  await expect(
    dialog.getByRole("status").filter({ hasText: "Folder sharing is read-only for now" }),
  ).toContainText("To change access to a file, share that file.");
  await expect(dialog.getByRole("region", { name: "People with access" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Role for added people")).toBeDisabled();
  await expect(dialog.getByLabel("Who can access")).toBeDisabled();
  for (const select of await dialog.getByLabel(/^Role for https:/).all())
    await expect(select).toBeDisabled();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
});

test("removes access copied from the folder's default once the file has its own sharing", async ({
  page,
}) => {
  const Seeded = "https://bob.demo.pod/profile/card#me";
  const Carol = "https://carol.example.org/profile#me";
  await resetDemo(page);
  await page.goto("/drive");
  const work = page
    .locator("tr[data-url]")
    .filter({ has: page.getByText("Work", { exact: true }) });
  await work.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Work", exact: true })).toBeVisible();
  const row = page
    .locator("tr[data-url]")
    .filter({ has: page.getByText("Report.pdf", { exact: true }) });
  const open = async () => {
    await row.focus();
    await row.press("Space");
    await page
      .getByRole("toolbar", { name: "Selection actions" })
      .getByRole("button", { name: "Share", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Share “Report.pdf”" });
  };
  let dialog = await open();
  // Work/'s default gives the seeded Bob Read; it is inherited until the file is first shared.
  await expect(dialog.getByRole("button", { name: `Remove access for ${Seeded}` })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Add people" }).fill(Carol);
  await dialog.getByRole("button", { name: "Add person" }).click();
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByLabel(`Role for ${Carol}`)).toHaveValue("viewer");
  // The first share copied Bob's access into the file's own ACL, so it is now removable.
  await dialog.getByRole("button", { name: `Remove access for ${Seeded}` }).click();
  await expect(dialog.getByLabel(`Role for ${Seeded}`)).toHaveCount(0);
  await expect(dialog.getByText("Sharing saved")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.reload();
  dialog = await open();
  await expect(dialog.getByLabel(`Role for ${Carol}`)).toHaveValue("viewer");
  await expect(dialog.getByLabel(`Role for ${Seeded}`)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
});
