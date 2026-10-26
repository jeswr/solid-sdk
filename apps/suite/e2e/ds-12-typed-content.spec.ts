// AUTHORED-BY Codex GPT-6.1-Sol
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
async function screenshot(page: Page, name: string, info: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  // All artwork is local; await decoding so screenshots include every media state.
  await page.locator("img").evaluateAll((images) =>
    Promise.all(
      images.map((element) => {
        const image = element as HTMLImageElement;
        image.loading = "eager";
        return image.decode();
      }),
    ),
  );
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-12/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await accessible(page);
}
for (const route of ["typed-view", "details-pane", "pod-meter"]) {
  test(`${route}: every ready/loading/empty/error state`, async ({ page }, info) => {
    await page.goto(`/dev/components/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('[data-fixture-state="Loading"]')).toBeVisible();
    await expect(page.locator('[data-fixture-state="First use"]')).toBeVisible();
    await expect(page.locator('[data-fixture-state="Filtered empty"]')).toBeVisible();
    await expect(page.locator("[data-fixture-state]")).toHaveCount(14);
    expect(await page.getByRole("main").innerText()).not.toContain("http");
    await accessible(page);
    await screenshot(page, route, info);
    await reflow(page);
  });
}
test("Advanced is required for raw data; every type stays readable and keyboard accessible", async ({
  page,
}, info) => {
  await page.goto("/dev/components/typed-view");
  await expect(page.locator("[data-fixture-type]")).toHaveCount(9);
  await expect(page.locator(".suite-raw-data")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const advanced = page.getByRole("checkbox", { name: "Show technical details" });
  await expect(advanced).toBeFocused();
  await page.keyboard.press("Space");
  await expect(advanced).toBeChecked();
  await page.keyboard.press("Tab");
  const firstSummary = page.locator(".suite-raw-data summary").first();
  await expect(firstSummary).toBeFocused();
  expect(await firstSummary.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
    "2px",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(".suite-raw-data").first()).toHaveAttribute("open", "");
  // Re-query each time: opening one shifts the positions of the closed ones.
  const closed = page.locator(".suite-raw-data:not([open]) summary");
  while ((await closed.count()) > 0) await closed.first().click();
  expect(await page.locator(".suite-raw-data pre").first().innerText()).toContain("http");
  expect(
    await page.getByRole("main").evaluate((main) => {
      const clone = main.cloneNode(true) as HTMLElement;
      for (const raw of clone.querySelectorAll(".suite-raw-data")) raw.remove();
      return clone.textContent;
    }),
  ).not.toContain("http");
  await accessible(page);
  await screenshot(page, "typed-view-advanced-expanded", info);
  await reflow(page);
  await advanced.uncheck();
  await expect(page.locator(".suite-raw-data")).toHaveCount(0);
});
test("details actions, empty filters and retry are keyboard paths", async ({ page }) => {
  await page.goto("/dev/components/details-pane");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Download" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Download selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Manage access" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Manage access selected", { exact: true })).toBeVisible();
  await page.goto("/dev/components/typed-view");
  const filtered = page.locator('[data-fixture-state="Filtered empty"]');
  await filtered.getByRole("button", { name: "Clear filters" }).focus();
  await page.keyboard.press("Enter");
  await expect(filtered.getByRole("heading", { name: "Mira Osei" })).toBeVisible();
  const error = page.locator('[data-fixture-state="Error · unreachable"]');
  await error.getByRole("button", { name: "Try again" }).focus();
  await page.keyboard.press("Enter");
  await expect(error.getByRole("alert")).toHaveCount(0);
  await accessible(page);
});
