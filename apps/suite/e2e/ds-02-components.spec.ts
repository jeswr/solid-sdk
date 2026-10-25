// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { fixtureNames } from "../src/app/dev/components/fixture-names";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await accessible(page);
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-02/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await accessible(page);
}
// Individual routes plus the two complete catalogs include every default/disabled state,
// both densities, all 15 apps at 32/40/48, every file row, and the async reference strip.
for (const name of fixtureNames)
  test(`${name}: default states`, async ({ page }, info) => {
    await page.goto(`/dev/components/${name}`);
    await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(
      info.project.use.colorScheme === "dark" ? /dark/ : /light/,
    );
    await capture(page, info, `${name}-default`);
    await reflow(page);
  });

const overlayCases = [
  ["dialog", "Open dialog", "dialog"],
  ["sheet", "Open sheet", "dialog"],
  ["popover", "Open popover", "dialog"],
  ["dropdown-menu", "File actions", "menu"],
  ["select", "Role", "listbox"],
  ["alert-dialog", "Open confirmation", "alertdialog"],
] as const;
for (const density of ["comfortable", "compact"] as const) {
  for (const [name, label, role] of overlayCases)
    test(`${name}: ${density} keyboard open and close`, async ({ page }, info) => {
      await page.goto(`/dev/components/${name}`);
      const region = page.locator(`[data-density="${density}"]`);
      const trigger =
        name === "select"
          ? region.getByRole("combobox", { name: label, exact: true })
          : region.getByRole("button", { name: label, exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole(role)).toBeVisible();
      await capture(page, info, `${name}-${density}-open`);
      await reflow(page);
      await page.keyboard.press("Escape");
      await expect(page.getByRole(role)).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  test(`context-menu: ${density} keyboard and pointer paths`, async ({ page }, info) => {
    await page.goto("/dev/components/context-menu");
    const trigger = page.locator(`[data-density="${density}"]`).getByRole("button");
    await trigger.focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await capture(page, info, `context-menu-${density}-keyboard`);
    await page.keyboard.press("Escape");
    await trigger.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await capture(page, info, `context-menu-${density}-pointer`);
    await reflow(page);
  });
  for (const [name, triggerName, slot] of [
    ["tooltip", "Hover or focus for help", "tooltip-content"],
    ["hover-card", "About the suite icons", "hover-card-content"],
    ["icon-button", "Add item", "tooltip-content"],
  ] as const)
    test(`${name}: ${density} help`, async ({ page }, info) => {
      await page.goto(`/dev/components/${name}`);
      const region = page.locator(`[data-density="${density}"]`);
      const trigger =
        name === "hover-card"
          ? region.getByRole("link", { name: triggerName })
          : region.getByRole("button", { name: triggerName, exact: true });
      await trigger.hover();
      await expect(page.locator(`[data-slot="${slot}"]`)).toBeVisible();
      await capture(page, info, `${name}-${density}-hover`);
      if (name !== "hover-card") {
        await page.mouse.move(0, 0);
        await trigger.focus();
        await expect(page.getByRole("tooltip")).toBeVisible();
        await capture(page, info, `${name}-${density}-focus`);
      }
      await reflow(page);
    });
  test(`form: ${density} validation and saved states`, async ({ page }, info) => {
    await page.goto("/dev/components/form");
    const form = page.locator(`[data-density="${density}"] form`);
    await form.getByRole("button", { name: "Save title" }).click();
    await expect(form.getByRole("alert")).toHaveText("Enter a title");
    await capture(page, info, `form-${density}-error`);
    await form.getByRole("textbox", { name: "Document title" }).fill("Launch plan");
    await form.getByRole("button", { name: "Save title" }).click();
    await expect(form.getByRole("status")).toHaveText("Saved to your pod");
    await capture(page, info, `form-${density}-saved`);
    await reflow(page);
  });
}
for (const [label, suffix] of [
  ["Show success toast", "success"],
  ["Show undo toast", "undo"],
  ["Show error toast", "error"],
] as const)
  test(`toast: ${suffix}`, async ({ page }, info) => {
    await page.goto("/dev/components/toast");
    await page.locator('[data-density="comfortable"]').getByRole("button", { name: label }).click();
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();
    await capture(page, info, `toast-${suffix}`);
    await reflow(page);
  });
test("keyboard controls, selection states, density and focus geometry", async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto("/dev/components/tabs");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const compact = page.locator('[data-density="compact"]');
  await compact.getByRole("tab", { name: "Details" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(compact.getByRole("tab", { name: "Activity" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await capture(page, info, "tabs-keyboard-activity");
  await page.goto("/dev/components/checkbox");
  const checkbox = page
    .locator('[data-density="comfortable"]')
    .getByRole("checkbox", { name: "Select false", exact: true });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await capture(page, info, "checkbox-keyboard-checked");
  await page.goto("/dev/components/button");
  for (const density of ["comfortable", "compact"] as const) {
    const region = page.locator(`[data-density="${density}"]`);
    for (const name of ["default", "outline", "ghost", "destructive", "secondary", "link"]) {
      const button = region.getByRole("button", { name, exact: true });
      await button.hover();
      await capture(page, info, `button-${density}-${name}-hover`);
      await page.mouse.move(0, 0);
      await button.focus();
      const style = await button.evaluate((el) => ({
        width: getComputedStyle(el).outlineWidth,
        offset: getComputedStyle(el).outlineOffset,
        height: el.getBoundingClientRect().height,
      }));
      expect(style.width).toBe("2px");
      expect(style.offset).toBe("2px");
      expect(style.height).toBe(density === "compact" ? 32 : 36);
      await capture(page, info, `button-${density}-${name}-focus`);
    }
  }
});
for (const [name, trigger, text] of [
  ["collapsible", "Toggle details", "Last modified today."],
  ["accordion", "Can I work offline?", "You can open saved copies."],
] as const)
  test(`${name}: expanded state`, async ({ page }, info) => {
    await page.goto(`/dev/components/${name}`);
    const region = page.locator('[data-density="comfortable"]');
    await region.getByRole("button", { name: trigger }).focus();
    await page.keyboard.press("Enter");
    await expect(region.getByText(text, { exact: true })).toBeVisible();
    await capture(page, info, `${name}-expanded`);
    await reflow(page);
  });
test("command: keyboard search and filtered empty state", async ({ page }, info) => {
  await page.goto("/dev/components/command");
  const search = page.locator('[data-density="comfortable"]').getByRole("combobox");
  await search.focus();
  await search.fill("No matching action");
  await expect(page.getByText("No actions found.", { exact: true })).toBeVisible();
  await capture(page, info, "command-filtered-empty");
  await reflow(page);
});
for (const density of ["comfortable", "compact"] as const) {
  for (const [name, role, label] of [
    ["switch", "switch", "Enable notifications"],
    ["toggle", "button", "Bold"],
  ] as const)
    test(`${name}: ${density} keyboard toggled`, async ({ page }, info) => {
      await page.goto(`/dev/components/${name}`);
      const control = page
        .locator(`[data-density="${density}"]`)
        .getByRole(role, { name: label, exact: true });
      await control.focus();
      await page.keyboard.press("Space");
      await expect(control).toHaveAttribute(
        name === "switch" ? "aria-checked" : "aria-pressed",
        "true",
      );
      await capture(page, info, `${name}-${density}-on`);
      await reflow(page);
    });
  test(`radio-group: ${density} arrow selection`, async ({ page }, info) => {
    await page.goto("/dev/components/radio-group");
    const region = page.locator(`[data-density="${density}"]`);
    await region.getByRole("radio", { name: "Comfortable", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(region.getByRole("radio", { name: "Compact", exact: true })).toBeChecked();
    await capture(page, info, `radio-group-${density}-compact`);
    await reflow(page);
  });
  test(`toggle-group: ${density} arrow selection`, async ({ page }, info) => {
    await page.goto("/dev/components/toggle-group");
    const region = page.locator(`[data-density="${density}"]`);
    await region.getByRole("radio", { name: "List" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(region.getByRole("radio", { name: "Grid" })).toBeChecked();
    await capture(page, info, `toggle-group-${density}-grid`);
    await reflow(page);
  });
  test(`slider: ${density} keyboard adjustment`, async ({ page }, info) => {
    await page.goto("/dev/components/slider");
    const slider = page
      .locator(`[data-density="${density}"]`)
      .getByRole("slider", { name: "Volume", exact: true });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "41");
    await capture(page, info, `slider-${density}-adjusted`);
    await reflow(page);
  });
  test(`resizable: ${density} keyboard adjustment`, async ({ page }, info) => {
    await page.goto("/dev/components/resizable");
    const handle = page
      .locator(`[data-density="${density}"]`)
      .getByRole("separator", { name: "Resize file panes" });
    await handle.focus();
    const before = await handle.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect(handle).not.toHaveAttribute("aria-valuenow", before ?? "");
    await capture(page, info, `resizable-${density}-adjusted`);
    await reflow(page);
  });
  test(`calendar: ${density} keyboard day navigation`, async ({ page }, info) => {
    await page.goto("/dev/components/calendar");
    const selected = page.locator(`[data-density="${density}"] [data-selected-single="true"]`);
    await selected.focus();
    await page.keyboard.press("ArrowRight");
    await expect(selected).not.toBeFocused();
    await capture(page, info, `calendar-${density}-keyboard`);
    await reflow(page);
  });
  for (const [name, label] of [
    ["input", "File name"],
    ["textarea", "Description"],
  ] as const)
    test(`${name}: ${density} focus`, async ({ page }, info) => {
      await page.goto(`/dev/components/${name}`);
      await page
        .locator(`[data-density="${density}"]`)
        .getByRole("textbox", { name: label, exact: true })
        .focus();
      await capture(page, info, `${name}-${density}-focus`);
      await reflow(page);
    });
}
test("coarse pointers enforce comfortable controls and reduced motion", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL ?? "http://127.0.0.1:3210",
    viewport: { width: 375, height: 900 },
    hasTouch: true,
    reducedMotion: "reduce",
    colorScheme: info.project.use.colorScheme ?? "light",
  });
  const page = await context.newPage();
  await page.goto("/dev/components/button");
  const button = page
    .locator('[data-density="compact"]')
    .getByRole("button", { name: "default", exact: true });
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  expect(await button.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(
    44,
  );
  expect(await button.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  await capture(page, info, "button-coarse-pointer");
  await reflow(page);
  await context.close();
});
test("scroll-area: keyboard scrolling", async ({ page }, info) => {
  await page.goto("/dev/components/scroll-area");
  const viewport = page.locator('[data-density="comfortable"] [data-slot="scroll-area-viewport"]');
  await viewport.focus();
  await page.keyboard.press("End");
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await capture(page, info, "scroll-area-keyboard-scrolled");
  await reflow(page);
});
