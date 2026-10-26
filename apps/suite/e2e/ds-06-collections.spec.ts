// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((entry) => entry.impact === "serious" || entry.impact === "critical"),
  ).toEqual([]);
}
async function screenshot(page: Page, name: string, info: TestInfo) {
  await accessible(page);
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-06/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function tabToItem(page: Page) {
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press("Tab");
    if (await page.locator("[data-collection-item]:focus").count()) return;
  }
  throw new Error("No collection item was reachable by Tab");
}

for (const component of ["data-table", "file-grid"]) {
  test(`${component}: keyboard-only selects three and opens one`, async ({ page }, info) => {
    await page.goto(`/dev/components/${component}`);
    await page.evaluate(() => document.fonts.ready);
    await tabToItem(page);
    await expect(page.locator("[data-collection-item]:focus")).toHaveAttribute(
      "aria-label",
      "Projects",
    );
    await page.keyboard.press("Space");
    // j/k follow linear reading order at every responsive card column count.
    await page.keyboard.press("Shift+J");
    await page.keyboard.press("Shift+J");
    await expect(page.getByTestId("selected-keys")).toHaveText(
      "Projects, Holiday photos, Q3 budget.xlsx",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("open-result")).toHaveText("Opened Q3 budget.xlsx");
    await page.keyboard.press("Alt+Enter");
    await expect(page.getByTestId("open-result")).toHaveText("Details for Q3 budget.xlsx");
    await screenshot(page, `${component}-selected`, info);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("selected-keys")).toHaveText("None");
    await page.keyboard.press("End");
    await expect(page.locator("[data-collection-item]:focus")).toHaveAttribute(
      "aria-label",
      "Document 10000",
    );
    await page.keyboard.press("Home");
    await expect(page.locator("[data-collection-item]:focus")).toHaveAttribute(
      "aria-label",
      "Projects",
    );
    await expect(page.locator('[data-collection-item][tabindex="0"]')).toHaveCount(1);
    await accessible(page);
  });

  test(`${component}: all states, both densities and 320px reflow`, async ({ page }, info) => {
    await page.goto(`/dev/components/${component}`);
    await page.evaluate(() => document.fonts.ready);
    await screenshot(page, `${component}-comfortable`, info);
    await page.getByLabel("Density", { exact: true }).selectOption("compact");
    const item = page
      .getByTestId("interactive-collection")
      .locator("[data-collection-item]")
      .first();
    await expect
      .poll(async () => Math.round((await item.boundingBox())?.height ?? 0))
      .toBe(component === "data-table" ? 32 : 160);
    await screenshot(page, `${component}-compact`, info);
    await page.getByLabel("Density", { exact: true }).selectOption("comfortable");
    await page.getByLabel("Content state", { exact: true }).selectOption("refreshing");
    await expect(page.getByRole("grid", { name: "Files", exact: true })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await screenshot(page, `${component}-refreshing`, info);
    await page.getByLabel("Content state", { exact: true }).selectOption("offline");
    await screenshot(page, `${component}-cached-offline`, info);
    await page.getByLabel("Content state", { exact: true }).selectOption("ready");
    await page.getByRole("button", { name: "Show all state fixtures" }).click();
    await expect(page.locator("[data-fixture-state]")).toHaveCount(14);
    await screenshot(page, `${component}-all-states`, info);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await screenshot(page, `${component}-320-all-states`, info);
  });

  test(`${component}: filtered select-all preserves hidden selection`, async ({ page }, info) => {
    await page.goto(`/dev/components/${component}`);
    await tabToItem(page);
    await page.keyboard.press("Space");
    await page.getByLabel("Filter files").fill("budget");
    await tabToItem(page);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByTestId("selected-keys")).toHaveText("Projects, Q3 budget.xlsx");
    await screenshot(page, `${component}-filtered-selected`, info);
    await page.getByLabel("Filter files").fill("missing file");
    await expect(
      page.getByRole("heading", { name: "No results for 'missing file'" }),
    ).toBeVisible();
    await screenshot(page, `${component}-filtered-empty`, info);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("selected-keys")).toHaveText("Projects, Q3 budget.xlsx");
  });

  test(`${component}: 10k virtualisation uses under 16ms of work per scroll frame`, async ({
    page,
  }, info) => {
    await page.goto(`/dev/components/${component}`);
    await expect(page.getByRole("grid", { name: "Files", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const viewport = page
      .locator(component === "data-table" ? ".suite-table-viewport" : ".suite-grid-viewport")
      .first();
    // CDP TaskDuration measures main-thread work, excluding the idle wait for vsync.
    // Wall-clock rAF gaps on a 60Hz display are inherently 16.67ms and are not a work budget.
    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const duration = async () => {
      const result = await session.send("Performance.getMetrics");
      return result.metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
    };
    const initialLast = await page
      .locator("[data-collection-item]")
      .last()
      .getAttribute("aria-label");
    const samples: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      const before = await duration();
      await viewport.evaluate(async (element, frame) => {
        element.scrollTop = (frame + 1) * 320;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, frame);
      const work = ((await duration()) - before) * 1000;
      if (frame >= 5) samples.push(work); // warm up browser/JIT and initial virtual measurements
    }
    expect(await page.locator("[data-collection-item]").count()).toBeLessThan(100);
    expect(await page.locator("[data-collection-item]").last().getAttribute("aria-label")).not.toBe(
      initialLast,
    );
    await info.attach(`${component}-frame-work-ms`, {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
    expect(Math.max(...samples)).toBeLessThan(16);
    await session.detach();
    await accessible(page);
  });
}

test("DataTable: sort, hide and resize with keyboard alternatives", async ({ page }, info) => {
  await page.goto("/dev/components/data-table");
  const collection = page.getByTestId("interactive-collection");
  await collection.getByRole("button", { name: "Name", exact: true }).click();
  await expect(collection.getByRole("columnheader").nth(1)).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  const resize = collection.getByRole("button", { name: "Resize Name column" });
  const before = await collection
    .locator("[data-collection-item]")
    .first()
    .evaluate((row) => getComputedStyle(row).gridTemplateColumns);
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  expect(
    await collection
      .locator("[data-collection-item]")
      .first()
      .evaluate((row) => getComputedStyle(row).gridTemplateColumns),
  ).not.toBe(before);
  await collection.locator("summary").click();
  await collection.getByRole("checkbox", { name: "Owner", exact: true }).uncheck();
  await expect(collection.getByRole("grid")).toHaveAttribute("aria-colcount", "4");
  await screenshot(page, "data-table-column-options", info);
});
