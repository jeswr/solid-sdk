// AUTHORED-BY Codex
import { expect, test } from "@playwright/test";

const BOB = "https://bob.example.org/profile#me";

test("shares a file as Editor, persists across reload, enables link access and removes the person", async ({
  page,
}) => {
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
