// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-14/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await accessible(page);
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS("outline-width", "2px");
}

async function tooltip(page: Page, info: TestInfo, target: Locator, label: string, name: string) {
  await tabTo(page, target);
  await expect(target).toHaveAccessibleName(label);
  await expect(page.getByRole("tooltip")).toHaveText(label);
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
  await capture(page, info, `${name}-focus`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(target).toBeFocused();
  await page.keyboard.press("Tab");
  await target.hover();
  await expect(page.getByRole("tooltip")).toHaveText(label);
  await capture(page, info, `${name}-hover`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
}

async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const dialog of await page.getByRole("dialog").all())
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  await accessible(page);
}

test("launcher trigger, close, drag and boundary move tooltips", async ({ page }, info) => {
  await page.goto("/dev/components/app-launcher");
  const trigger = page.getByRole("button", { name: "Apps", exact: true });
  await tooltip(page, info, trigger, "Apps", "launcher-trigger");
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("searchbox", { name: "Filter apps" })).toBeFocused();
  const close = page.getByRole("button", { name: "Close apps" });
  await tooltip(page, info, close, "Close apps", "launcher-close");
  await expect(close).toHaveAttribute("data-slot", "navigation-icon-button");
  const customise = page.getByRole("button", { name: "Customise rail", exact: true });
  await tabTo(page, customise);
  await page.keyboard.press("Enter");
  for (const [label, name] of [
    ["Drag Home to pin or reorder", "drag"],
    ["Move Home up", "move-up-disabled"],
    ["Move Home down", "move-down"],
    ["Move Drive up", "move-up"],
    ["Move Permissions down", "move-down-disabled"],
  ] as const) {
    const control = page.getByRole("button", { name: label, exact: true });
    await tooltip(page, info, control, label, name);
    if (name?.endsWith("disabled")) {
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await tabTo(page, control);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await expect(page.locator(".suite-customise li label").first()).toHaveText("Home");
    }
  }
  await reflow(page);
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("rail brand, pinned current link and More keep their navigation semantics", async ({
  page,
}, info) => {
  await page.goto("/dev/components/app-rail");
  if ((info.project.use.viewport?.width ?? 1280) >= 768) {
    const brand = page.getByRole("button", { name: "Apps", exact: true });
    await tooltip(page, info, brand, "Apps", "rail-brand");
    const drive = page.locator(".suite-rail").getByRole("link", { name: "Drive", exact: true });
    await tooltip(page, info, drive, "Drive", "rail-pinned-current");
    await expect(drive).toHaveAttribute("href", "/drive");
    await expect(drive).toHaveAttribute("aria-current", "page");
  }
  const more = page.getByRole("button", { name: "More apps", exact: true });
  await tooltip(page, info, more, "More apps", "rail-more");
  await tabTo(page, more);
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await reflow(page);
});

test("Back, shell toggles, pane close and sheet close tooltips", async ({ page }, info) => {
  await page.goto("/dev/components/top-bar");
  await expect(page).toHaveTitle("My Drive · Drive · Solid Suite");
  const narrow = (info.project.use.viewport?.width ?? 1280) < 1024;
  if ((info.project.use.viewport?.width ?? 1280) < 768) {
    const back = page.getByRole("link", { name: "Back to fixtures" });
    await tooltip(page, info, back, "Back to fixtures", "back");
    await expect(back).toHaveAttribute("href", "/dev/components");
  }
  for (const [label, name] of [
    ["Toggle sidebar", "sidebar-toggle"],
    ["Toggle details pane", "details-toggle"],
  ] as const) {
    const toggle = page.getByRole("button", { name: label, exact: true });
    const expanded = await toggle.getAttribute("aria-expanded");
    const controls = await toggle.getAttribute("aria-controls");
    await tooltip(page, info, toggle, label, name);
    await expect(toggle).toHaveAttribute("aria-expanded", expanded ?? "false");
    await expect(toggle).toHaveAttribute("aria-controls", controls ?? "");
    if (narrow) {
      await tabTo(page, toggle);
      await page.keyboard.press("Enter");
      const closeLabel = name === "sidebar-toggle" ? "Close drive sections" : "Close details";
      const close = page.getByRole("button", { name: closeLabel, exact: true });
      await expect(close).toBeFocused();
      await tooltip(page, info, close, closeLabel, `${name}-sheet-close`);
      await expect(close).toHaveAttribute("data-slot", "shell-sheet-close");
      await tabTo(page, close);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(toggle).toBeFocused();
    }
  }
  if (!narrow) {
    const close = page.getByRole("button", { name: "Close details", exact: true });
    await tooltip(page, info, close, "Close details", "details-pane-close");
    await expect(close).toHaveAttribute("data-slot", "details-pane-close");
    await tabTo(page, close);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Toggle details pane" })).toBeFocused();
  }
  await reflow(page);
  const toggle = page.getByRole("button", { name: "Toggle sidebar" });
  await tabTo(page, toggle);
  await page.keyboard.press("Enter");
  await reflow(page);
  await capture(page, info, "sheet-320");
});

test("navigation and shell controls retain 44px coarse-pointer targets", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: info.project.use.viewport ?? { width: 375, height: 900 },
    colorScheme: info.project.use.colorScheme ?? "light",
    reducedMotion: "reduce",
    baseURL: info.project.use.baseURL ?? "http://127.0.0.1:3210",
  });
  const page = await context.newPage();
  async function targets(selector: string) {
    const controls = page.locator(selector);
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
  try {
    await page.goto("/dev/components/app-rail");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await targets(".suite-rail-button, .suite-tab");
    await page.goto("/dev/components/app-launcher");
    await page.getByRole("button", { name: "Apps", exact: true }).click();
    await page.getByRole("button", { name: "Customise rail", exact: true }).click();
    await targets(".suite-icon-button, .suite-drag");
    await capture(page, info, "navigation-coarse");
    await reflow(page);
    await page.goto("/dev/components/top-bar");
    await targets(".suite-shell-icon-button");
    const toggle = page.getByRole("button", { name: "Toggle sidebar" });
    await toggle.click();
    await targets(".suite-shell-icon-button");
    await capture(page, info, "shell-coarse");
    await reflow(page);
  } finally {
    await context.close();
  }
});
