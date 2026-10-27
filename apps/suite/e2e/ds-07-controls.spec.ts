// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
/** The field's alert, not Next's always-present route announcer (also role="alert"). */
function fieldError(page: Page) {
  return page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));
}
async function capture(page: Page, info: TestInfo, state: string) {
  await accessible(page);
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-07/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${state}-${info.project.name}.png`, fullPage: true });
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await accessible(page);
}
async function visit(page: Page, info: TestInfo, component: string) {
  await page.goto(`/dev/components/${component}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("html")).toHaveClass(
    info.project.use.colorScheme === "dark" ? /dark/ : /light/,
  );
  await capture(page, info, `${component}-default`);
}

test("toolbar: responsive overflow, keyboard More and disabled actions", async ({ page }, info) => {
  await visit(page, info, "toolbar");
  const toolbar = page.getByRole("toolbar", { name: "File actions", exact: true });
  if (info.project.use.viewport?.width === 375) {
    await expect(toolbar.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Move to…" })).toHaveCount(0);
  }
  // The constrained fixture exercises an open overflow state in every project.
  const narrow = page.getByRole("toolbar", { name: "Narrow file actions", exact: true });
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Enter"); // main
  await page.keyboard.press("Tab"); // all fixtures link
  await page.keyboard.press("Tab"); // first toolbar, one tab stop
  await expect(toolbar.getByRole("button", { name: "Upload files" })).toBeFocused();
  await page.keyboard.press("Tab"); // narrow toolbar
  await expect(narrow.getByRole("button", { name: "Upload files" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(narrow.getByRole("button", { name: "More", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Narrow file actions — More" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  await capture(page, info, "toolbar-more-open");
  await page.keyboard.press("End"); // skips disabled Delete, lands on Move
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Move to… selected");
  await expect(narrow.getByRole("button", { name: "More", exact: true })).toBeFocused();
  await capture(page, info, "toolbar-action-selected");
  await reflow(page);
  await narrow.getByRole("button", { name: "More", exact: true }).press("ArrowDown");
  await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("breadcrumbs: keyboard collapsed menu, native links and per-crumb drops", async ({
  page,
}, info) => {
  await visit(page, info, "breadcrumbs");
  if (info.project.use.viewport?.width === 375) {
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb", exact: true })
        .getByRole("button", { name: "Show parent folders" }),
    ).toBeVisible();
  }
  const narrow = page.getByRole("navigation", { name: "Narrow folder path", exact: true });
  // Tab to the constrained breadcrumb trigger using only keyboard navigation.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  for (let count = 0; count < 20; count += 1) {
    await page.keyboard.press("Tab");
    if (
      await narrow
        .getByRole("button", { name: "Show parent folders" })
        .evaluate((element) => element === document.activeElement)
    )
      break;
  }
  await expect(narrow.getByRole("button", { name: "Show parent folders" })).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Parent folders" });
  await expect(menu.getByRole("menuitem", { name: "Work", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Projects", exact: true })).toBeFocused();
  await capture(page, info, "breadcrumbs-parents-open");
  await page.keyboard.press("Escape");
  await expect(narrow.getByRole("button", { name: "Show parent folders" })).toBeFocused();
  // ArrowDown opens the menu; the next key must wait until it has focused its first item.
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Work", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Projects", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/folder=projects/);
  const current = page
    .getByRole("navigation", { name: "Breadcrumb", exact: true })
    .getByRole("link", { name: "Campaigns", exact: true });
  await current.dispatchEvent("dragover");
  await current.dispatchEvent("drop");
  await expect(page.getByRole("status")).toHaveText("Moved sample to Campaigns");
  await page.getByRole("button", { name: "Move sample to Campaigns" }).press("Enter");
  await capture(page, info, "breadcrumbs-drop-and-keyboard-alternative");
  await reflow(page);
  await narrow.getByRole("button", { name: "Show parent folders" }).press("ArrowDown");
  await accessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("filters: toggles, live count, Clear and empty states", async ({ page }, info) => {
  await visit(page, info, "filter-chips");
  const filters = page.getByRole("region", { name: "Interactive filters" });
  await filters.getByRole("button", { name: "Documents", exact: true }).press("Space");
  await expect(filters.getByRole("status")).toHaveText("8 results");
  await expect(filters.getByRole("button", { name: "Documents", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await capture(page, info, "filter-chips-selected");
  await filters.getByRole("button", { name: "Clear", exact: true }).press("Enter");
  await expect(filters.getByRole("status")).toHaveText("24 results");
  await expect(filters.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
  await page
    .getByRole("region", { name: "Filtered empty" })
    .getByRole("button", { name: "Clear", exact: true })
    .press("Enter");
  await capture(page, info, "filter-chips-cleared");
  await reflow(page);
});

test("editable text: F2, validation, Enter, Escape and IME", async ({ page }, info) => {
  await visit(page, info, "editable-text");
  const name = page.getByRole("button", { name: "Document name: Q4 launch plan", exact: true });
  await name.press("F2");
  const input = page.getByRole("textbox", { name: "Document name", exact: true });
  await expect(input).toBeFocused();
  await capture(page, info, "editable-text-editing");
  await input.fill("");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(fieldError(page)).toHaveText("Enter a name");
  await capture(page, info, "editable-text-required-error");
  await input.fill("Taken");
  await input.press("Enter");
  await expect(fieldError(page)).toHaveText("A file with this name already exists");
  await capture(page, info, "editable-text-name-taken");
  await input.fill("Campaign plan");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(input).toBeVisible();
  await input.press("Enter");
  const renamed = page.getByRole("button", { name: "Document name: Campaign plan", exact: true });
  await expect(renamed).toBeFocused();
  await renamed.press("F2");
  await input.fill("Unsaved change");
  await input.press("Escape");
  await expect(renamed).toBeFocused();
  await capture(page, info, "editable-text-committed-and-cancelled");
  await reflow(page);
});

test("tag input: autocomplete, no results, chip removal and empty options", async ({
  page,
}, info) => {
  await visit(page, info, "tag-input");
  const input = page.getByRole("combobox", { name: "Labels", exact: true });
  await input.focus();
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Personal", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await capture(page, info, "tag-input-suggestions");
  await input.fill("fin");
  await input.press("ArrowDown");
  await capture(page, info, "tag-input-filtered-suggestions");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove Finance", exact: true }).first(),
  ).toBeVisible();
  await capture(page, info, "tag-input-selected");
  await input.press("Backspace");
  await page.getByRole("button", { name: "Remove Work", exact: true }).press("Enter");
  await expect(input).toBeFocused();
  await capture(page, info, "tag-input-removed");
  await input.fill("missing");
  await expect(page.getByText("No results for 'missing'", { exact: true })).toBeVisible();
  await capture(page, info, "tag-input-no-results");
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.fill("");
  for (const label of ["Work", "Personal", "Finance", "Research"]) {
    await input.click();
    await input.press("ArrowDown");
    await expect(page.getByRole("option", { name: label, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await input.press("Enter");
  }
  await input.click();
  await expect(page.getByText("All labels selected", { exact: true })).toBeVisible();
  await capture(page, info, "tag-input-all-selected");
  await page.getByRole("combobox", { name: "New collection labels", exact: true }).focus();
  await expect(page.getByText("No labels yet", { exact: true })).toBeVisible();
  await capture(page, info, "tag-input-first-use-open");
  await reflow(page);
});
