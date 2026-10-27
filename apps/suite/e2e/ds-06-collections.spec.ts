// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  // A card's visible label is its file name, which is its accessible name (WCAG 2.5.3);
  // its metadata is exposed through aria-describedby. axe's label-in-name heuristic
  // treats every descendant text node as the label, so it cannot judge composite cells.
  const results = await new AxeBuilder({ page })
    .disableRules(["label-content-name-mismatch"])
    .analyze();
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
    await page.getByRole("combobox", { name: "Density" }).selectOption("compact");
    const item = page
      .getByTestId("interactive-collection")
      .locator("[data-collection-item]")
      .first();
    await expect
      .poll(async () => Math.round((await item.boundingBox())?.height ?? 0))
      .toBe(component === "data-table" ? 32 : 160);
    await screenshot(page, `${component}-compact`, info);
    await page.getByRole("combobox", { name: "Density" }).selectOption("comfortable");
    await page.getByRole("combobox", { name: "Content state" }).selectOption("refreshing");
    await expect(page.getByRole("grid", { name: "Files", exact: true })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await screenshot(page, `${component}-refreshing`, info);
    await page.getByRole("combobox", { name: "Content state" }).selectOption("offline");
    await screenshot(page, `${component}-cached-offline`, info);
    await page.getByRole("combobox", { name: "Content state" }).selectOption("ready");
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
    const metered = async (target: typeof page) => {
      const session = await target.context().newCDPSession(target);
      await session.send("Performance.enable");
      return async () => {
        const result = await session.send("Performance.getMetrics");
        return result.metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
      };
    };
    // Each sample also pays for the CDP evaluate round trip and an idle frame. A blank page
    // sampled immediately before each scroll pays that harness cost under the same load but
    // runs none of the component's work, so the paired difference is the component's frame work.
    const blank = await page.context().newPage();
    const blankDuration = await metered(blank);
    const duration = await metered(page);
    const twoFrames = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const harness = async () => {
      const before = await blankDuration();
      await blank.evaluate(twoFrames);
      return ((await blankDuration()) - before) * 1000;
    };
    const initialLast = await page
      .locator("[data-collection-item]")
      .last()
      .getAttribute("aria-label");
    const samples: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      const overhead = await harness();
      const before = await duration();
      await viewport.evaluate(async (element, frame) => {
        element.scrollTop = (frame + 1) * 320;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, frame);
      const work = ((await duration()) - before) * 1000 - overhead;
      if (frame >= 5) samples.push(work); // warm up browser/JIT and initial virtual measurements
    }
    await blank.close();
    expect(await page.locator("[data-collection-item]").count()).toBeLessThan(100);
    expect(await page.locator("[data-collection-item]").last().getAttribute("aria-label")).not.toBe(
      initialLast,
    );
    await info.attach(`${component}-frame-work-ms`, {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
    // On a shared runner a busy neighbour inflates individual samples, so the typical (median)
    // scroll frame must fit one 60Hz frame and the 90th percentile at most two (one dropped
    // frame). Rendering all 10k rows costs hundreds of ms per frame and fails both.
    const sorted = [...samples].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(16);
    expect(sorted[Math.floor(sorted.length * 0.9)]).toBeLessThan(33);
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
  // Shrink: at wide viewports the first column already fills to its maximum width.
  await page.keyboard.press("ArrowLeft");
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
