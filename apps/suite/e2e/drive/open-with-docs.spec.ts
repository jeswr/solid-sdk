// AUTHORED-BY Codex GPT-6.1
import { expect, type Page, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";
import { seedDemoSession } from "../demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));

const POD = "https://alice.demo.pod/";

test.use({ locale: "en" });

// Reset the demo pod on a same-origin page without application scripts.
test.beforeEach(async ({ page }) => {
  await page.route("**/__open-with-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__open-with-reset");
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
  await page.unroute("**/__open-with-reset");
});

function row(page: Page, name: string) {
  return page.locator("tr[data-url]").filter({ has: page.getByText(name, { exact: true }) });
}

async function myDrive(page: Page) {
  await page.goto("/drive");
  await expect(row(page, "notes.md")).toBeVisible();
}

async function openWithMenu(page: Page, name: string) {
  await row(page, name).click({ button: "right" });
  const trigger = page.getByRole("menuitem", { name: "Open with", exact: true });
  // Keyboard opens the submenu reliably at every project size.
  await trigger.focus();
  await trigger.press("ArrowRight");
  return page.getByRole("menuitem", { name: /^Docs/ });
}

async function expectConvertedNotes(page: Page) {
  await expect(page).toHaveURL(/\/docs\/d\/[A-Za-z0-9_-]+$/);
  const ref = new URL(page.url()).pathname.slice("/docs/d/".length);
  const created = Buffer.from(ref, "base64url").toString();
  expect(created.startsWith(`${POD}docs/`)).toBe(true);
  expect(created.endsWith(".ttl")).toBe(true);
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await expect(body.locator("h1")).toHaveText("Notes");
  await expect(body.locator("ul")).toContainText("Book train to Ghent");
  return created;
}

test("Open with › Docs converts notes.md into a new document and keeps the original", async ({
  page,
}) => {
  await myDrive(page);
  await (await openWithMenu(page, "notes.md")).click();
  await expectConvertedNotes(page);
  // The source file is untouched: it is still listed and still previews as Markdown.
  await myDrive(page);
  await row(page, "notes.md").focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: "notes.md", exact: true });
  await expect(preview.locator(".drv-preview-text")).toContainText("# Notes");
});

test("the preview's Open with Docs button converts the previewed file", async ({ page }) => {
  await myDrive(page);
  await row(page, "notes.md").focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: "notes.md", exact: true });
  await preview.getByRole("button", { name: "Open with Docs", exact: true }).click();
  await expectConvertedNotes(page);
});

for (const extension of ["html", "htm", "txt", "docx"]) {
  test(`converts an uploaded ${extension} file and reopens the saved document`, async ({
    page,
  }) => {
    await myDrive(page);
    const name = `converted.${extension}`;
    if (extension === "docx")
      await page.getByTestId("drive-upload-input").setInputFiles("e2e/fixtures/docs-import.docx");
    else
      await page.getByTestId("drive-upload-input").setInputFiles({
        name,
        mimeType: extension === "txt" ? "text/plain" : "text/html",
        buffer: Buffer.from(
          extension === "txt" ? "# Literal text\n<Ready>" : "<h1>Imported page</h1><p>Ready</p>",
        ),
      });
    const sourceName = extension === "docx" ? "docs-import.docx" : name;
    await expect(row(page, sourceName)).toBeVisible();
    await (await openWithMenu(page, sourceName)).click();
    await expect(page).toHaveURL(/\/docs\/d\/[A-Za-z0-9_-]+$/);
    const editor = page.getByRole("textbox", { name: "Document body", exact: true });
    if (extension === "txt") {
      await expect(editor).toContainText("# Literal text");
      await expect(editor).toContainText("<Ready>");
      await expect(editor.locator("h1")).toHaveCount(0);
    } else
      await expect(editor.locator("h1")).toContainText(
        extension === "docx" ? "Plan" : "Imported page",
      );
    await page.reload();
    await expect(editor).toContainText(
      extension === "txt" ? "# Literal text" : extension === "docx" ? "Plan" : "Imported page",
    );
  });
}

test("a Docs document opens in the Docs editor instead of the preview", async ({ page }) => {
  const launch = `${POD}docs/launch.ttl`;
  await page.goto(`/drive/f/${encodeRef(`${POD}docs/`)}`);
  await expect(row(page, "launch.ttl")).toBeVisible();
  // Open with › Docs opens it too, without making a copy.
  await (await openWithMenu(page, "launch.ttl")).click();
  await expect(page).toHaveURL(`/docs/d/${encodeRef(launch)}`);
  await page.goBack();
  await expect(row(page, "launch.ttl")).toBeVisible();
  await row(page, "launch.ttl").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/docs/d/${encodeRef(launch)}`);
  await expect(page.getByRole("dialog", { name: "launch.ttl", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(row(page, "launch.ttl")).toBeVisible();
  await row(page, "launch.ttl").dblclick();
  await expect(page).toHaveURL(`/docs/d/${encodeRef(launch)}`);
});

test("Open with Docs is unavailable offline and explains why", async ({ page, context }) => {
  await myDrive(page);
  await context.setOffline(true);
  const docs = await openWithMenu(page, "notes.md");
  await expect(docs).toBeDisabled();
  await expect(docs).toContainText("You're offline. This needs a connection.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await row(page, "notes.md").focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: "notes.md", exact: true });
  await expect(preview.getByRole("button", { name: "Open with Docs", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(preview.getByRole("button", { name: "Open with Docs", exact: true })).toBeEnabled();
});
