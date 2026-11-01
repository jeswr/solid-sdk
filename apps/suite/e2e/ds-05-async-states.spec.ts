// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
async function screenshot(page: Page, name: string, info: TestInfo) {
  await accessible(page);
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-05/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 32; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("The action was not reachable by keyboard");
}

for (const [component, count] of [
  ["empty-state", 5],
  ["error-state", 13],
  ["loading-skeleton", 10],
  ["render-async", 1],
] as const) {
  test(`${component}: all states, axe, full page and 320px reflow`, async ({ page }, info) => {
    await page.goto(`/dev/components/${component}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(component);
    await expect(page.locator("[data-fixture-state]")).toHaveCount(count);
    await screenshot(page, `${component}-all-states`, info);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await screenshot(page, `${component}-320`, info);
  });
}
test("skeleton presets reserve the final row and card heights at both densities", async ({
  page,
}) => {
  await page.goto("/dev/components/loading-skeleton");
  for (const [density, rowHeight, cardHeight, headerHeight] of [
    ["comfortable", 44, 200, 36],
    ["compact", 32, 160, 32],
  ] as const) {
    for (const preset of ["list", "document", "detail", "table"]) {
      const row = page
        .locator(`[data-fixture-state="${density}-${preset}"] .suite-loading-row`)
        .first();
      expect((await row.boundingBox())?.height).toBe(rowHeight);
    }
    expect(
      (
        await page
          .locator(`[data-fixture-state="${density}-grid"] .suite-loading-row`)
          .first()
          .boundingBox()
      )?.height,
    ).toBe(cardHeight);
    expect(
      (
        await page
          .locator(`[data-fixture-state="${density}-table"] .suite-loading-header`)
          .boundingBox()
      )?.height,
    ).toBe(headerHeight);
  }
  expect(
    await page
      .locator('[data-slot="skeleton"]')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await accessible(page);
});
test("empty and typed error recovery work with the keyboard and visible focus", async ({
  page,
}, info) => {
  await page.goto("/dev/components/empty-state");
  const upload = page.getByRole("button", { name: "Upload a file", exact: true });
  await tabTo(page, upload);
  expect(await upload.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("async-result")).toHaveText("Upload requested");
  const clear = page
    .locator('[data-fixture-state="filtered-empty"]')
    .getByRole("button", { name: "Clear filters" });
  await tabTo(page, clear);
  await page.keyboard.press("Space");
  await expect(page.getByTestId("async-result")).toHaveText("Filters cleared");
  await screenshot(page, "empty-keyboard", info);
  await page.goto("/dev/components/error-state");
  const request = page
    .locator('[data-fixture-state="forbidden"]')
    .getByRole("button", { name: "Request access" });
  await tabTo(page, request);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("async-result")).toHaveText("Access requested");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Switch account" }).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("async-result")).toHaveText("Account switch requested");
  await expect(
    page
      .locator('[data-fixture-state="forbidden-without-access-requests"]')
      .getByRole("button", { name: "Request access" }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-fixture-state="retry-after"]').getByRole("button", { name: "Retry" }),
  ).toBeDisabled();
  await screenshot(page, "error-keyboard", info);
});
test("renderAsync covers loading, empty, filtered, offline, error and retained refresh content", async ({
  page,
}, info) => {
  await page.goto("/dev/components/render-async");
  const state = page.getByRole("combobox", { name: "Content state" });
  for (const name of [
    "ready",
    "loading",
    "empty",
    "filtered-empty",
    "error",
    "offline-uncached",
    "offline-cached",
    "refreshing",
  ]) {
    await state.selectOption(name);
    if (name === "refreshing" || name === "offline-cached")
      await expect(page.getByRole("list", { name: "Files" })).toBeVisible();
    if (name === "error")
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "Can't reach your storage",
      );
    await screenshot(page, `async-${name}`, info);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await accessible(page);
    await page.setViewportSize(info.project.use.viewport ?? { width: 375, height: 900 });
  }
});
test("toasts: every state, keyboard Undo/dismiss, persistence and 320px reflow", async ({
  page,
}, info) => {
  await page.goto("/dev/components/toasts");
  await page.evaluate(() => document.fonts.ready);
  await tabTo(page, page.getByRole("button", { name: "Show success" }));
  await page.keyboard.press("Enter");
  await expect(
    page.locator("[data-sonner-toast]").getByRole("status").filter({ hasText: "Link copied" }),
  ).toBeVisible();
  await screenshot(page, "toast-success", info);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await screenshot(page, "toast-undo", info);
  await page.keyboard.press("Alt+t");
  await tabTo(page, page.getByRole("button", { name: "Undo", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("async-result")).toHaveText("File restored");
  await tabTo(page, page.getByRole("button", { name: "Show error", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Can't reach your storage");
  await screenshot(page, "toast-error", info);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await screenshot(page, "toast-error-320", info);
  await page.keyboard.press("Alt+t");
  await tabTo(
    page,
    page
      .locator('[data-sonner-toast][data-type="error"]')
      .getByRole("button", { name: "Close toast" }),
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
