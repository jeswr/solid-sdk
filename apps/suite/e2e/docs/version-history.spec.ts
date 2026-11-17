// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

test.beforeEach(async ({ page }) => {
  // App routes sit behind the shell session guard; start signed in to the demo account.
  await seedDemoSession(page);
  await page.route("**/__docs-history-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__docs-history-reset");
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
  await page.unroute("**/__docs-history-reset");
});
async function historyMenu(page: import("@playwright/test").Page) {
  const file = page.getByRole("menuitem", { name: "File", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  const history = page.getByRole("menuitem", { name: "Version history", exact: true });
  await history.focus();
  await history.press("ArrowRight");
}
test("names, previews, restores and persists a version while retaining Before restore", async ({
  page,
}) => {
  await page.goto("/docs/new");
  await page.getByRole("textbox", { name: "Document title", exact: true }).fill("History plan");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Original text for the plan");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await historyMenu(page);
  await page.getByRole("menuitem", { name: "Name current version…", exact: true }).click();
  const naming = page.getByRole("dialog", { name: "Name current version" });
  await naming.getByLabel("Version name").fill("First draft");
  await naming.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(naming).toBeHidden();
  await body.fill("Changed text for the plan");
  await historyMenu(page);
  await page.getByRole("menuitem", { name: /See version history/ }).click();
  const panel = page.getByRole("complementary", { name: "Version history" });
  await panel.getByRole("button", { name: /First draft/ }).click();
  const preview = page.getByRole("textbox", { name: "Version preview", exact: true });
  await expect(preview).toContainText("Original text for the plan");
  await expect(preview).toHaveAttribute("contenteditable", "false");
  await expect(preview).toHaveAttribute("aria-readonly", "true");
  await panel.getByRole("button", { name: "Restore this version", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Restore this version?" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(panel).toBeHidden();
  await expect(body).toContainText("Original text for the plan");
  await expect(body).not.toContainText("Changed text for the plan");
  await expect(body).toHaveAttribute("contenteditable", "true");
  await page.reload();
  await expect(body).toContainText("Original text for the plan");
  await body.focus();
  await page.keyboard.press("Control+Alt+Shift+H");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /Before restore/ })).toBeVisible();
  await panel.getByRole("button", { name: /Before restore/ }).click();
  await expect(preview).toContainText("Changed text for the plan");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(body).toContainText("Original text for the plan");
});
