// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await accessible(page);
  const directory = fileURLToPath(
    new URL("../../../../artifacts/playwright/shell/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function ready(page: Page, component = "global-search") {
  await page.goto(`/dev/components/${component}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}
async function signInDemo(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function searchInput(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768 && !(await page.getByRole("dialog").count()))
    await page.getByRole("button", { name: "Search", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search", exact: true });
  await input.focus();
  return input;
}
test.afterEach(async ({ page }) => {
  if (new URL(page.url()).pathname.startsWith("/dev/components/")) await accessible(page);
});

test("groups, caps and labels local results; keyboard opens a result", async ({ page }, info) => {
  await ready(page);
  const input = await searchInput(page);
  await page.getByRole("button", { name: "in Drive, remove scope" }).click();
  await input.fill("project");
  for (const name of ["Files", "Documents", "Tasks", "People", "Data"])
    await expect(page.getByRole("group", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Files", exact: true }).getByRole("option"),
  ).toHaveCount(5);
  await expect(page.getByText("Searching your saved copies", { exact: true })).toBeVisible();
  await expect(page.getByText("Your storage doesn't offer search", { exact: false })).toBeVisible();
  await capture(page, info, "search-grouped");
  await input.press("ArrowDown");
  const active = await input.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(page.getByText("Opened Project file 1.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
});

test("scope chip and primary-modifier shortcut work while typing", async ({ page }, info) => {
  await ready(page);
  const input = await searchInput(page);
  await input.fill("project");
  await expect(page.getByRole("group", { name: "Files", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Documents", exact: true })).toHaveCount(0);
  await input.press("Control+Shift+F");
  await expect(page.getByRole("button", { name: "Everywhere, search only in Drive" })).toHaveText(
    "Everywhere",
  );
  await expect(page.getByRole("group", { name: "Documents", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Everywhere, search only in Drive" }).click();
  await expect(page.getByRole("group", { name: "Documents", exact: true })).toHaveCount(0);
  await capture(page, info, "search-scoped");
});

test("recent searches and hint dismissal persist and can be cleared", async ({ page }, info) => {
  await ready(page);
  let input = await searchInput(page);
  await input.fill("project");
  await expect(page.getByText("Searching your saved copies", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss search hint" }).click();
  await input.press("Enter");
  await expect(page.getByText("All results for project in drive", { exact: true })).toBeVisible();
  await page.reload();
  input = await searchInput(page);
  await expect(
    page
      .getByRole("listbox", { name: "Recent searches" })
      .getByRole("option", { name: "project", exact: true }),
  ).toBeVisible();
  await capture(page, info, "search-recent");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("project");
  await expect(page.getByText("Searching your saved copies", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss search hint" })).toHaveCount(0);
  await input.fill("");
  await page.getByRole("button", { name: "Clear recent searches" }).click();
  expect(await page.evaluate(() => localStorage.getItem("suite.recentSearches.v1"))).toBeNull();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("loading, aborted stale searches, errors and empty states", async ({ page }, info) => {
  await ready(page);
  await page.getByLabel("Fixture state").selectOption("slow");
  let input = await searchInput(page);
  await input.fill("project");
  await expect(page.getByText("Searching…", { exact: true })).toBeVisible();
  await capture(page, info, "search-loading");
  await input.fill("unmatched");
  await expect(page.getByText("No results for “unmatched”", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /Project file/ })).toHaveCount(0);
  await input.press("Escape");
  await page.getByLabel("Fixture state").selectOption("error");
  input = await searchInput(page);
  await input.fill("project");
  await expect(
    page.getByText("Search couldn't finish. Try another search.", { exact: true }),
  ).toBeVisible();
  await capture(page, info, "search-error");
  await input.press("Escape");
  await page.getByLabel("Fixture state").selectOption("empty");
  input = await searchInput(page);
  await input.fill("nothing");
  await expect(page.getByText("No results for “nothing”", { exact: true })).toBeVisible();
  await capture(page, info, "search-empty");
});

test("search closes on Escape and reflows at 320px", async ({ page }, info) => {
  await ready(page);
  await page.setViewportSize({ width: 320, height: 900 });
  const input = await searchInput(page);
  await input.fill("project");
  await expect(page.getByRole("listbox")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await capture(page, info, "search-320");
  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
});

test("palette filters actions, creates, searches and restores focus", async ({ page }, info) => {
  await ready(page, "command-palette");
  const trigger = page.getByRole("button", { name: "Open command palette" });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Go to" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Create" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Recent" })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /^Calendar/ })).toBeVisible();
  await capture(page, info, "palette");
  const input = dialog.getByRole("combobox");
  await input.fill("New document");
  await input.press("Enter");
  await expect(page.getByText("Created a document", { exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await input.fill("a unique search");
  await expect(
    dialog.getByRole("option", { name: "No matching actions", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await accessible(page);
  await input.press("Enter");
  await expect(page.getByText("Palette search for a unique search", { exact: true })).toBeVisible();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("palette hides an explicit backlog app unless backlog is enabled", async ({ page }) => {
  await ready(page, "command-palette");
  const state = page.getByLabel("Fixture state");
  const trigger = page.getByRole("button", { name: "Open command palette" });
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await state.selectOption("backlog");
  await trigger.click();
  await expect(dialog.getByRole("option", { name: /^Calendar/ })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: /^Drive/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await state.selectOption("backlog-visible");
  await trigger.click();
  await expect(dialog.getByRole("option", { name: /^Calendar/ })).toBeVisible();
});

for (const [component, triggerName, dialogName] of [
  ["command-palette", "Open command palette", "Command palette"],
  ["shortcut-help", "Show keyboard shortcuts", "Keyboard shortcuts"],
] as const) {
  test(`${component} stays within the viewport when resized while open`, async ({ page }) => {
    await ready(page, component);
    await page.getByRole("button", { name: triggerName }).click();
    const dialog = page.getByRole("dialog", { name: dialogName });
    await expect(dialog).toBeVisible();
    for (const width of [320, 1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await expect
        .poll(() =>
          dialog.evaluate((el) => {
            const bounds = el.getBoundingClientRect();
            return (
              bounds.left >= 15.5 &&
              bounds.right <= window.innerWidth - 15.5 &&
              el.scrollWidth <= el.clientWidth
            );
          }),
        )
        .toBe(true);
      await accessible(page);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: triggerName })).toBeFocused();
  });
}

test("palette Enter navigates to Drive", async ({ page }) => {
  await signInDemo(page);
  await ready(page, "command-palette");
  await page.getByLabel("Typing area").focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox").fill("drive");
  await expect(dialog.getByRole("option", { name: /Drive/ })).toBeVisible();
  await accessible(page);
  await dialog.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(/\/drive(?:\/my)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Drive", exact: true })).toBeVisible();
});

test("help groups and filters shortcuts, lists frame keys and restores focus", async ({
  page,
}, info) => {
  await ready(page, "shortcut-help");
  const trigger = page.getByRole("button", { name: "Show keyboard shortcuts" });
  await trigger.focus();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Toggle sidebar", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Toggle details pane", { exact: true })).toBeVisible();
  await capture(page, info, "shortcut-help");
  await dialog.getByLabel("Find a shortcut").fill("Drive");
  await expect(dialog.getByText("Go to Drive", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Go to Home", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("x");
  await expect(page.getByRole("status").filter({ hasText: "Editor action" })).toHaveCount(1);
});

test("single keys stay in editable controls and g d navigates after blur", async ({ page }) => {
  await signInDemo(page);
  await ready(page);
  const input = page.getByLabel("Typing area");
  await input.fill("");
  await input.pressSequentially("gd/?D");
  await expect(input).toHaveValue("gd/?D");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Shortcuts disabled", { exact: true }).pressSequentially("gd?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await accessible(page);
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/drive(?:\/my)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Drive", exact: true })).toBeVisible();
});

test("slash focuses responsive search and Shift+D toggles theme", async ({ page }) => {
  await ready(page);
  const previous = await page.locator("html").getAttribute("class");
  await page.keyboard.press("Shift+D");
  await expect.poll(() => page.locator("html").getAttribute("class")).not.toBe(previous);
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Search", exact: true })).toBeFocused();
});

test("results body filters and error recovery", async ({ page }, info) => {
  await ready(page);
  await page.getByLabel("Fixture state").selectOption("results");
  await expect(page.getByText("12 results", { exact: true })).toBeVisible();
  await page.getByLabel("Type", { exact: true }).selectOption("document");
  await expect(page.getByText("1 results", { exact: true })).toBeVisible();
  await page.getByLabel("App", { exact: true }).selectOption("drive");
  await expect(page.getByText("No results for 'project'", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).first().click();
  await page.getByLabel("Owner", { exact: true }).selectOption("me");
  await expect(page.getByText("8 results", { exact: true })).toBeVisible();
  await capture(page, info, "search-results");
  await page.getByLabel("Fixture state").selectOption("results-error");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
});
