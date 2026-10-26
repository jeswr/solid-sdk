// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-04/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await accessible(page);
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function ready(page: Page, route = "shell", state = "ready") {
  await page.goto(`/dev/components/${route}?state=${state}`);
  await expect(page).toHaveTitle("My Drive · Drive · Solid Suite");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator(".suite-shell")).toHaveAttribute("data-sidebar-open", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const dialog of await page.getByRole("dialog").all()) {
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await accessible(page);
}
const fixtures: Record<string, string[]> = {
  shell: ["ready"],
  "top-bar": ["ready", "refreshing", "offline"],
  "sidebar-nav": ["ready"],
  "details-pane": [
    "ready",
    "loading",
    "first-use",
    "filtered",
    "forbidden",
    "unreachable",
    "not-found",
    "refreshing",
    "offline",
  ],
};
for (const [route, states] of Object.entries(fixtures)) {
  for (const state of states) {
    test(`${route}: ${state} fixture`, async ({ page }, info) => {
      await ready(page, route, state);
      await expect(page.getByLabel("Fixture state")).toHaveValue(state);
      const dark = info.project.use.colorScheme === "dark";
      await expect(page.locator("html")).toHaveClass(dark ? /dark/ : /light/);
      await capture(page, info, `${route}-${state}`);
      if (route === "details-pane") {
        const toggle = page.getByRole("button", { name: "Toggle details pane" });
        if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
        await expect(page.getByRole("complementary")).toBeVisible();
        await capture(page, info, `details-pane-${state}-open`);
      }
      await reflow(page);
    });
  }
}

test("responsive regions, sidebar groups and drawers", async ({ page }, info) => {
  await ready(page);
  const width = page.viewportSize()?.width ?? 1280;
  await expect(page.getByRole("navigation", { name: "Apps", exact: true })).toBeVisible();
  if (width === 1280) {
    await expect(page.getByRole("navigation", { name: "Drive sections" })).toBeVisible();
    await expect(page.getByRole("complementary")).toBeVisible();
    expect(
      await page.locator(".suite-sidebar-slot").evaluate((el) => el.getBoundingClientRect().width),
    ).toBe(264);
    expect(
      await page.locator(".suite-details-slot").evaluate((el) => el.getBoundingClientRect().width),
    ).toBe(360);
  } else {
    await expect(page.getByRole("navigation", { name: "Drive sections" })).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    const drawer = page.getByRole("dialog", { name: "Drive sections" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("button", { name: "Close drive sections" })).toBeFocused();
    await capture(page, info, "shell-sidebar-drawer");
    // Radix must trap both directions of the keyboard path.
    const links = drawer.getByRole("link");
    await links.last().focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close drive sections" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(links.last()).toBeFocused();
  }
  const group = page.getByRole("button", { name: "Folders", exact: true });
  await group.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Work 12" })).toHaveCount(0);
  await capture(page, info, "sidebar-nav-collapsed-group");
  if (width < 1024) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Toggle sidebar" })).toBeFocused();
  }
  if (width === 375) {
    await expect(page.locator(".ds04-tabs")).toBeVisible();
    await expect(page.locator(".ds04-rail")).toBeHidden();
  } else await expect(page.locator(".ds04-rail")).toBeVisible();
  expect(await page.getByRole("banner").evaluate((el) => el.getBoundingClientRect().height)).toBe(
    width < 768 ? 48 : 56,
  );
  await reflow(page);
});

test("keyboard skip link, persistent preferences and editable shortcut guards", async ({
  page,
}, info) => {
  await ready(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const sidebar = page.getByRole("button", { name: "Toggle sidebar" });
  const details = page.getByRole("button", { name: "Toggle details pane" });
  const initial = await sidebar.getAttribute("aria-expanded");
  await page.keyboard.press("[");
  await expect(sidebar).toHaveAttribute("aria-expanded", initial === "true" ? "false" : "true");
  if (initial === "false") await page.keyboard.press("[");
  await page.reload();
  await expect(sidebar).toHaveAttribute("aria-expanded", "false");
  // Open details, persist across reload, then close via its own bracket shortcut.
  await details.focus();
  if ((await details.getAttribute("aria-expanded")) === "true") await page.keyboard.press("]");
  await page.keyboard.press("]");
  await page.reload();
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await expect(page.getByRole("dialog", { name: "Details" })).toBeVisible();
  else await expect(details).toHaveAttribute("aria-expanded", "true");
  await capture(page, info, "shell-persisted-details");
  await page.keyboard.press("]");
  await expect(details).toHaveAttribute("aria-expanded", "false");
  const input = page.getByRole("searchbox", { name: "Filter files" });
  await input.fill("[]");
  await input.press("[");
  await input.press("]");
  await expect(sidebar).toHaveAttribute("aria-expanded", "false");
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await capture(page, info, "shell-collapsed");
  await reflow(page);
});

test("main scrolls independently and focus stays clear of both bars", async ({ page }) => {
  await ready(page);
  const bar = await page.getByRole("banner").boundingBox();
  const row = page.locator("#file-23");
  await row.focus();
  await expect(row).toBeFocused();
  const position = await row.boundingBox();
  const tabs = await page.locator(".suite-tabbar-slot").boundingBox();
  expect(position?.y).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0));
  expect((position?.y ?? 0) + (position?.height ?? 0)).toBeLessThanOrEqual(tabs?.y ?? 900);
  expect(
    await row.evaluate((el) => parseFloat(getComputedStyle(el).scrollMarginTop)),
  ).toBeGreaterThanOrEqual(64);
  expect(await page.getByRole("main").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await accessible(page);
});
