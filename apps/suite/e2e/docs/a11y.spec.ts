// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
  // Reset before application scripts can open the demo pod's IndexedDB database.
  await page.route("**/__docs-a11y-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__docs-a11y-reset");
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
  await page.unroute("**/__docs-a11y-reset");
});

async function accessible(page: Page) {
  // Drive uses axe's defaults: no tags, disabled rules or excluded elements.
  // Require zero violations here, including the lower impacts Drive filters out.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
  ).toEqual([]);
}

async function openDocument(page: Page) {
  await page.goto("/docs/new");
  await page.getByRole("textbox", { name: "Document title", exact: true }).fill("Accessible plan");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("A clear plan for everyone.");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
  return body;
}

/** Reach controls through the actual tab order, including responsive layouts. */
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let tabs = 0; tabs < 100; tabs++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, "Control must be reachable using Tab").toBeFocused();
}

test("document list has no axe violations", async ({ page }, info) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "All documents", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(
    info.project.use.colorScheme === "dark" ? /dark/ : /light/,
  );
  await accessible(page);
  await openDocument(page);
  await page.getByRole("link", { name: "Back to documents", exact: true }).click();
  await expect(page.getByRole("link", { name: "Accessible plan", exact: true })).toBeVisible();
  await accessible(page);
});

test("editing a document has no axe violations", async ({ page }) => {
  const body = await openDocument(page);
  await expect(body).toHaveAttribute("contenteditable", "true");
  await expect(page.getByRole("combobox", { name: "Editing mode", exact: true })).toHaveValue(
    "editing",
  );
  await accessible(page);
});

test("comments sidebar and composer have no axe violations", async ({ page }) => {
  const body = await openDocument(page);
  await body.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Shift+End");
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await page.keyboard.press("Control+Alt+m");
  const panel = page.getByRole("complementary", { name: "Comments", exact: true });
  const composer = panel.getByRole("textbox", { name: "Add comment", exact: true });
  await expect(composer).toBeFocused();
  await accessible(page);
  await composer.fill("Everyone can review this plan.");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel.getByRole("article")).toContainText("Everyone can review this plan.");
  await accessible(page);
});

test("suggesting mode with a suggestion has no axe violations", async ({ page }) => {
  const body = await openDocument(page);
  await page
    .getByRole("combobox", { name: "Editing mode", exact: true })
    .selectOption("suggesting");
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Suggested addition.");
  const suggestion = body.locator("ins[data-suggestion-id]");
  await expect(suggestion).toHaveText(" Suggested addition.");
  await accessible(page);
  // The caret is still inside the suggestion; open its review by keyboard.
  await page.keyboard.press("ControlOrMeta+Alt+Shift+A");
  await expect(page.getByRole("dialog", { name: "Review suggestion", exact: true })).toBeVisible();
  await accessible(page);
});

test("version history panel and preview have no axe violations", async ({ page }) => {
  const body = await openDocument(page);
  const file = page.getByRole("menuitem", { name: "File", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  const history = page.getByRole("menuitem", { name: "Version history", exact: true });
  await history.focus();
  await history.press("ArrowRight");
  await page.getByRole("menuitem", { name: "Name current version…", exact: true }).click();
  const naming = page.getByRole("dialog", { name: "Name current version", exact: true });
  await naming.getByLabel("Version name", { exact: true }).fill("First draft");
  await naming.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(naming).toBeHidden();
  await body.focus();
  await page.keyboard.press("Control+Alt+Shift+H");
  const panel = page.getByRole("complementary", { name: "Version history", exact: true });
  const version = panel.getByRole("button", { name: /First draft/ });
  await expect(version).toBeVisible();
  await accessible(page);
  await version.click();
  await expect(page.getByRole("textbox", { name: "Version preview", exact: true })).toContainText(
    "A clear plan for everyone.",
  );
  await accessible(page);
});

test("Share dialog has no axe violations", async ({ page }) => {
  await openDocument(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share “Accessible plan”", exact: true });
  // Audit the loaded sharing controls, after the permission lookup finishes.
  await expect(dialog.getByRole("combobox", { name: "Add people", exact: true })).toBeEnabled();
  await accessible(page);
});

test("import dialog has no axe violations", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "All documents", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Import document", exact: true })).toBeVisible();
  await accessible(page);
});

test("keyboard-only: create, write a heading and paragraph, comment and open Share", async ({
  page,
}) => {
  // Tabbing through every control one key at a time is slow on narrow layouts.
  test.slow();
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "All documents", exact: true })).toBeVisible();
  await tabTo(
    page,
    page.getByRole("link", { name: "New document", exact: true }).filter({ visible: true }).first(),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/new/);
  const title = page.getByRole("textbox", { name: "Document title", exact: true });
  await tabTo(page, title);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Keyboard plan");
  await page.keyboard.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await expect(body).toBeFocused();
  await page.keyboard.type("# Keyboard heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A paragraph written without a mouse.");
  await expect(
    body.getByRole("heading", { level: 1, name: "Keyboard heading", exact: true }),
  ).toBeVisible();
  await expect(
    body.locator("p").filter({ hasText: "A paragraph written without a mouse." }),
  ).toHaveText("A paragraph written without a mouse.");
  await expect(page).toHaveURL(/\/docs\/d\//);
  // Select the written content across visual line wraps on narrow screens.
  await page.keyboard.press("Control+Shift+Home");
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await page.keyboard.press("Control+Alt+m");
  const panel = page.getByRole("complementary", { name: "Comments", exact: true });
  await expect(panel.getByRole("textbox", { name: "Add comment", exact: true })).toBeFocused();
  await page.keyboard.type("Review this paragraph.");
  await tabTo(page, panel.getByRole("button", { name: "Comment", exact: true }));
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("article")).toContainText("Review this paragraph.");
  await expect(
    panel.getByRole("button", { name: /Keyboard heading.*A paragraph written without a mouse\./ }),
  ).toBeVisible();
  await tabTo(page, panel.getByRole("button", { name: "Close comments", exact: true }));
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeEnabled();
  await tabTo(page, share);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Share “Keyboard plan”", exact: true });
  await expect(dialog).toBeVisible();
  const people = dialog.getByRole("combobox", { name: "Add people", exact: true });
  await expect(people).toBeEnabled();
  await tabTo(page, people);
  await tabTo(page, dialog.getByRole("button", { name: "Done", exact: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(share).toBeFocused();
});
