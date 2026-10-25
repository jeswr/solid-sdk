// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}

for (const route of ["components", "components/tokens"]) {
  test(`${route}: accessible fixture and full-page screenshot`, async ({ page }, testInfo) => {
    await page.goto(`/dev/${route}`);
    const theme = testInfo.project.use.colorScheme;
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /light/);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectAccessible(page);
    const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-01/", import.meta.url));
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/${route.replaceAll("/", "-")}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(page);
  });
}
test("keyboard navigation, real density heights and reduced motion", async ({ page }) => {
  await page.goto("/dev/components");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Tokens, typography and density" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Tokens", exact: true })).toBeVisible();
  expect(
    await page
      .locator('[data-density="compact"] .density-rows li')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(32);
  expect(
    await page
      .locator('[data-density="comfortable"] .density-rows li')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(44);
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--duration-base").trim()),
  ).toMatch(/^0m?s$/); // minified builds emit 0s
  await expectAccessible(page);
});

test("touch pointers force comfortable density and 44px controls", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: testInfo.project.use.viewport ?? { width: 375, height: 900 },
    colorScheme: testInfo.project.use.colorScheme ?? "light",
    reducedMotion: "reduce",
    ...(testInfo.project.use.baseURL !== undefined
      ? { baseURL: testInfo.project.use.baseURL }
      : {}),
  });
  const page = await context.newPage();
  await page.goto("/dev/components/tokens");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  const compact = page.locator('[data-density="compact"]');
  expect(
    await compact
      .locator(".density-rows li")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(44);
  expect(
    await compact.locator("input").evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await compact.locator("button").evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await expectAccessible(page);
  await context.close();
});
