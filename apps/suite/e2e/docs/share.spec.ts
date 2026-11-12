// AUTHORED-BY Codex GPT-6.1
// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

const BOB = "https://bob.example.org/profile#me";

test.beforeEach(async ({ page }) => {
  // App routes sit behind the shell session guard; start signed in to the demo account.
  await seedDemoSession(page);
  await page.route("**/__docs-share-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__docs-share-reset");
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
  await page.unroute("**/__docs-share-reset");
});

test("shares a saved document from its header and File menu, persisting main-resource access", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/new");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeDisabled();
  await share.locator("..").focus();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Save this document to your pod before sharing.",
  );
  await page.getByRole("textbox", { name: "Document title", exact: true }).fill("Shared plan");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Our shared plan");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(share).toBeEnabled();
  const documentUrl = page.url();
  await share.click();
  let dialog = page.getByRole("dialog", { name: "Share “Shared plan”" });
  await expect(dialog.getByRole("note")).toContainText(
    "update log, assets and comments keep their existing permissions",
  );
  await expect(dialog.getByRole("note")).toContainText(
    "Collaborators may not be able to open the document",
  );
  await expect(dialog.getByRole("note")).toContainText("edits may not save");
  await expect(dialog.getByRole("note")).toContainText('"Anyone with the link"');
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1280);
  await dialog.getByRole("combobox", { name: "Add people" }).fill(BOB);
  await dialog.getByRole("button", { name: "Add person" }).click();
  await dialog.getByLabel("Role for added people").selectOption("editor");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveValue("editor");
  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByText("Link copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(documentUrl);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(share).toBeFocused();
  await page.reload();
  await expect(body).toContainText("Our shared plan");
  await expect(share).toBeEnabled();
  const file = page.getByRole("menuitem", { name: "File", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  const menuShare = page.getByRole("menuitem", { name: "Share…", exact: true });
  await menuShare.focus();
  await menuShare.press("Enter");
  dialog = page.getByRole("dialog", { name: "Share “Shared plan”" });
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveValue("editor");
  await dialog.getByLabel("Who can access").selectOption("anyone");
  await expect(dialog.getByLabel("Link role")).toHaveValue("viewer");
  await dialog.getByRole("button", { name: `Remove access for ${BOB}` }).click();
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(file).toBeFocused();
});

test("disables header and menu sharing offline and restores them on reconnect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("docs-share-offline") !== "1",
    });
  });
  await page.goto("/docs/new");
  await page.getByRole("textbox", { name: "Document body", exact: true }).fill("A saved document");
  await expect(page).toHaveURL(/\/docs\/d\//);
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeEnabled();
  await share.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Who can access")).toBeEnabled();
  await page.evaluate(() => {
    sessionStorage.setItem("docs-share-offline", "1");
    dispatchEvent(new Event("offline"));
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Who can access")).toBeDisabled();
  await expect(dialog.getByText("Reconnect to manage sharing.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(share).toBeDisabled();
  await expect(share).toBeFocused();
  await expect(share).toHaveAccessibleDescription("Reconnect to manage sharing.");
  await share.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Reconnect to manage sharing.");
  const file = page.getByRole("menuitem", { name: "File", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  const menuShare = page.getByRole("menuitem", { name: "Share…", exact: true });
  await expect(menuShare).toBeDisabled();
  await expect(menuShare).toHaveAccessibleDescription("Reconnect to manage sharing.");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    sessionStorage.removeItem("docs-share-offline");
    dispatchEvent(new Event("online"));
  });
  await expect(share).toBeEnabled();
});
