// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";

const DRIVE = "https://alice.demo.pod/drive/";
const rootNames = ["Archive", "Photos", "Work", "data.ttl", "notes.md"];

test.use({ locale: "en" });

// Reset on a same-origin page without application scripts. Await deletion before
// Drive can open IndexedDB; subsequent navigations keep this test's mutations.
test.beforeEach(async ({ page }) => {
  await page.route("**/__drive-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__drive-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod database deletion blocked"));
    });
  });
  await page.unroute("**/__drive-test-reset");
});

function row(page: Page, name: string) {
  return page.locator("tr[data-url]").filter({ has: page.getByText(name, { exact: true }) });
}

async function root(page: Page) {
  await page.goto("/drive");
  await expect(
    page.getByRole("heading", { level: 1, name: "My Drive", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody .drv-name")).toHaveText(rootNames);
}

async function openFolder(page: Page, name: string) {
  await row(page, name).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading", exact: true })).toBeHidden();
}

async function navigate(page: Page, name: string) {
  // The sidebar is a drawer at both 375 and 768px.
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeHidden();
  } else {
    await page
      .getByRole("navigation", { name: "Drive", exact: true })
      .getByRole("link", { name, exact: true })
      .click();
  }
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

async function accessible(page: Page) {
  // Next streams route metadata, so the <title> can land just after the content.
  await expect(page).toHaveTitle(/\S/);
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const directory = fileURLToPath(
    new URL("../../../../artifacts/playwright/drive/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${info.project.name}-${name}.png`, fullPage: true });
}

async function descending(page: Page, key: "Name" | "Size") {
  await page.getByRole("button", { name: /^Sort by / }).click();
  await page.getByRole("menuitemradio", { name: key, exact: true }).click();
  await page.getByRole("button", { name: `Sort by ${key}`, exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Descending", exact: true }).click();
}

test("My Drive lists folders first, opens Work by keyboard, sorts and switches to grid", async ({
  page,
}, info) => {
  await root(page);
  await expect(page.locator("html")).toHaveClass(
    info.project.use.colorScheme === "dark" ? /dark/ : /light/,
  );
  await accessible(page);
  await capture(page, info, "root");
  await openFolder(page, "Work");
  await expect(page).toHaveURL(`/drive/f/${encodeRef(`${DRIVE}Work/`)}`);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await expect(
      crumbs.getByRole("link", { name: "My Drive", exact: true }).filter({ visible: true }),
    ).toBeVisible();
  } else {
    await expect(crumbs.locator("ol")).toHaveText("My Drive›Work");
  }
  await expect(page.locator("tbody .drv-name")).toHaveText(["Budget 2026.csv", "Report.pdf"]);
  await accessible(page);
  await capture(page, info, "work");
  await descending(page, "Size");
  await expect(page.locator("tbody .drv-name")).toHaveText(["Report.pdf", "Budget 2026.csv"]);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Work", exact: true }).locator(".drv-card-name"),
  ).toHaveText(["Report.pdf", "Budget 2026.csv"]);
  await capture(page, info, "grid");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await row(page, "Report.pdf").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(
    page.getByRole("heading", { level: 1, name: "My Drive", exact: true }),
  ).toBeVisible();
  await expect(row(page, "notes.md")).toBeVisible();
});

test("uploads two files with live rows, completion dock and Keep both conflict resolution", async ({
  page,
}) => {
  await root(page);
  await page.getByTestId("drive-upload-input").setInputFiles([
    { name: "meeting.txt", mimeType: "text/plain", buffer: Buffer.from("Meeting notes") },
    { name: "totals.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Total\nWork,42\n") },
  ]);
  const dock = page.getByRole("region", { name: "Uploads", exact: true });
  await expect(dock).toBeVisible();
  await expect(
    dock.getByRole("heading", { name: "2 uploads complete", exact: true }),
  ).toBeVisible();
  await expect(dock.locator('li[data-status="done"]')).toHaveCount(2);
  await expect(row(page, "meeting.txt")).toBeVisible();
  await expect(row(page, "totals.csv")).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Uploaded 2 files" }),
  ).toBeVisible();
  await page.getByTestId("drive-upload-input").setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Additional notes"),
  });
  const conflict = page.getByRole("dialog", { name: "Upload options", exact: true });
  await expect(conflict).toContainText('A file named "notes.md" already exists');
  await conflict.getByRole("button", { name: "Keep both", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expect(row(page, "notes (1).md")).toBeVisible();
  await expect(row(page, "notes.md")).toBeVisible();
  await expect(
    dock.getByRole("heading", { name: "3 uploads complete", exact: true }),
  ).toBeVisible();
});

test("creates Reports 2026 and F2 rename confirms a changed extension", async ({ page }) => {
  await root(page);
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "New", exact: true }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: /^New folder/ }).click();
  } else {
    await page.getByRole("button", { name: "New folder", exact: true }).click();
  }
  const folderDialog = page.getByRole("dialog", { name: "New folder", exact: true });
  await folderDialog
    .getByRole("textbox", { name: "Folder name", exact: true })
    .fill("Reports 2026");
  await folderDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(folderDialog).toBeHidden();
  await expect(row(page, "Reports 2026")).toHaveAttribute("data-url", `${DRIVE}Reports%202026/`);
  await row(page, "notes.md").focus();
  await page.keyboard.press("F2");
  const rename = page.getByRole("dialog", { name: "Rename", exact: true });
  await rename.getByRole("textbox", { name: "Name", exact: true }).fill("notes.txt");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  const extension = page.getByRole("alertdialog", {
    name: "Change the file type to .txt?",
    exact: true,
  });
  await expect(extension.getByRole("button", { name: "Keep .md", exact: true })).toBeVisible();
  await expect(row(page, "notes.md")).toBeVisible();
  await extension.getByRole("button", { name: "Change", exact: true }).click();
  await expect(extension).toBeHidden();
  await expect(row(page, "notes.txt")).toBeVisible();
  await expect(row(page, "notes.md")).toHaveCount(0);
});

test("keyboard Move to dialog moves notes into Archive and toast Undo returns it", async ({
  page,
}) => {
  await root(page);
  await row(page, "notes.md").focus();
  await page.keyboard.press("m");
  const move = page.getByRole("dialog", { name: 'Move "notes.md"', exact: true });
  await expect(move).toBeVisible();
  const tree = move.getByRole("tree", { name: "Folders", exact: true });
  await expect(tree.locator(`[data-node="${DRIVE}Archive/"]`)).toBeVisible();
  await expect(move.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
  await tree.locator('[aria-level="1"]').focus();
  await page.keyboard.press("Home");
  await expect(tree.locator('[aria-level="1"]')).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  const archive = tree.locator(`[data-node="${DRIVE}Archive/"]`);
  await expect(archive).toBeFocused();
  await expect(archive).toHaveAttribute("aria-selected", "true");
  await expect(move.getByRole("button", { name: "Move", exact: true })).toBeEnabled();
  await accessible(page);
  await page.keyboard.press("Enter");
  await expect(move).toBeHidden();
  await expect(row(page, "notes.md")).toHaveCount(0);
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Moved notes.md to Archive" });
  await expect(toast).toBeVisible();
  await openFolder(page, "Archive");
  await expect(row(page, "notes.md")).toHaveAttribute("data-url", `${DRIVE}Archive/notes.md`);
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row(page, "notes.md")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "This folder is empty", exact: true }),
  ).toBeVisible();
  await navigate(page, "My Drive");
  await expect(row(page, "notes.md")).toHaveAttribute("data-url", `${DRIVE}notes.md`);
});

test("stars sunset through the row menu on mobile and finds it in Starred", async ({ page }) => {
  await root(page);
  await openFolder(page, "Photos");
  const sunset = row(page, "sunset.png");
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await sunset.getByRole("button", { name: "More actions for sunset.png", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Star\b/ }).click();
  } else {
    await sunset.focus();
    await sunset.getByRole("button", { name: "Star sunset.png", exact: true }).click();
  }
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Starred sunset.png" }),
  ).toBeVisible();
  await navigate(page, "Starred");
  await expect(page).toHaveURL("/drive/starred");
  await expect(page.locator("tbody .drv-name")).toHaveText(["sunset.png"]);
});

test("trashes two items, confirms the count, restores one and deletes the other for ever", async ({
  page,
}, info) => {
  await root(page);
  // Keyboard selection works without invoking the single-tap preview on phones.
  await row(page, "data.ttl").focus();
  await page.keyboard.press("Space");
  await row(page, "notes.md").focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("toolbar", { name: "Selection actions", exact: true })).toContainText(
    "2 selected",
  );
  await page.keyboard.press("Delete");
  await expect(row(page, "data.ttl")).toHaveCount(0);
  await expect(row(page, "notes.md")).toHaveCount(0);
  // Wait for the index write, not just disappearance of the copied sources.
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Moved 2 items to trash" }),
  ).toBeVisible();
  await navigate(page, "Trash");
  const trash = page.getByRole("table", { name: "Trash", exact: true });
  await expect(trash.locator("tbody tr")).toHaveCount(2);
  await expect(trash.getByText("data.ttl", { exact: true })).toBeVisible();
  await expect(trash.getByText("notes.md", { exact: true })).toBeVisible();
  await expect(trash.locator("tbody .drv-col-location")).toHaveText(["My Drive", "My Drive"]);
  await expect(
    page.getByText("Items in the trash are deleted for ever after 30 days.", { exact: true }),
  ).toBeVisible();
  await accessible(page);
  await capture(page, info, "trash");
  await page.getByRole("button", { name: "Empty trash", exact: true }).click();
  const empty = page.getByRole("alertdialog", { name: "Empty trash?", exact: true });
  await expect(
    empty.getByText(/^2 items \([\d.,]+ \w+\) will be deleted for ever\.$/),
  ).toBeVisible();
  await empty.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Restore: notes.md", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Restored notes.md" }),
  ).toBeVisible();
  await expect(trash.locator("tbody .drv-name")).toHaveText(["data.ttl"]);
  await page.getByRole("button", { name: "Delete for ever: data.ttl", exact: true }).click();
  const deletion = page.getByRole("alertdialog", {
    name: "Delete data.ttl for ever?",
    exact: true,
  });
  await expect(deletion).toContainText("This can't be undone.");
  await deletion.getByRole("button", { name: "Delete for ever", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Empty trash", exact: true })).toBeDisabled();
  await navigate(page, "My Drive");
  await expect(row(page, "notes.md")).toBeVisible();
  await expect(row(page, "data.ttl")).toHaveCount(0);
});

test("preview arrows change images and Escape restores row focus", async ({ page }, info) => {
  await root(page);
  await openFolder(page, "Photos");
  await descending(page, "Name");
  await row(page, "sunset.png").focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: "sunset.png", exact: true });
  await expect(preview.getByRole("img", { name: "sunset.png", exact: true })).toBeVisible();
  await accessible(page);
  await capture(page, info, "preview");
  await page.keyboard.press("ArrowRight");
  await expect(
    page
      .getByRole("dialog", { name: "hills.png", exact: true })
      .getByRole("img", { name: "hills.png", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(preview.getByRole("img", { name: "sunset.png", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(row(page, "sunset.png")).toBeFocused();
});

test("direct preview URL renders a page and links back to its folder", async ({ page }) => {
  await page.goto(`/drive/p/${encodeRef(`${DRIVE}Photos/sunset.png`)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "sunset.png", exact: true }),
  ).toBeAttached();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "sunset.png", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to folder", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Photos", exact: true })).toBeVisible();
  await expect(row(page, "sunset.png")).toBeVisible();
});

test("data.ttl previews readable contact values without raw HTTP IRIs", async ({ page }) => {
  await root(page);
  await row(page, "data.ttl").focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("dialog", { name: "data.ttl", exact: true });
  await expect(preview.getByText("Bram Kerst", { exact: true })).toBeVisible();
  await expect(preview.getByText("bram@example.org", { exact: true })).toBeVisible();
  await expect(preview).not.toContainText(/http/i);
  await accessible(page);
});

test("Recent includes notes and the top search box finds Report.pdf", async ({ page }) => {
  await root(page);
  await navigate(page, "Recent");
  await expect(page).toHaveURL("/drive/recent");
  await expect(row(page, "notes.md")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search in Drive", exact: true });
  await search.fill("report");
  await search.press("Enter");
  await expect(page).toHaveURL("/drive/search?q=report");
  await expect(
    page.getByRole("heading", { level: 1, name: 'Results for "report"', exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody .drv-name")).toHaveText(["Report.pdf"]);
  await expect(row(page, "Report.pdf")).toHaveAttribute("data-url", `${DRIVE}Work/Report.pdf`);
});
