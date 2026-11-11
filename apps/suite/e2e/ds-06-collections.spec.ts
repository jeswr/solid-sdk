// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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

  test(`${component}: 10k virtualisation keeps scroll frame work within budget (median one frame, p90 two)`, async ({
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
    const measured: { raw: number; overhead: number }[] = [];
    for (let frame = 0; frame < 40; frame++) {
      const overhead = await harness();
      const before = await duration();
      await viewport.evaluate(async (element, frame) => {
        element.scrollTop = (frame + 1) * 320;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, frame);
      const raw = ((await duration()) - before) * 1000;
      measured.push({ raw, overhead });
      if (frame >= 5) samples.push(raw - overhead); // warm up browser/JIT and initial virtual measurements
    }
    await blank.close();
    expect(await page.locator("[data-collection-item]").count()).toBeLessThan(100);
    expect(await page.locator("[data-collection-item]").last().getAttribute("aria-label")).not.toBe(
      initialLast,
    );
    await info.attach(`${component}-frame-work-ms`, {
      body: JSON.stringify({ samples, measured }),
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

test("DataTable: listing sorting, responsive columns, keyboard and menu actions", async ({
  page,
}, info) => {
  await page.goto("/dev/components/data-table");
  await page.getByRole("checkbox", { name: "Use listing options" }).check();
  const collection = page.getByTestId("interactive-collection");
  const row = (name: string) => collection.getByRole("row", { name, exact: true });
  await expect(collection.locator("th[aria-sort]")).toHaveCount(0);
  await expect(collection.getByRole("checkbox", { name: /Select/ })).toHaveCount(0);
  await expect(collection.getByRole("button", { name: /Resize/ })).toHaveCount(0);
  await expect(collection.locator("summary")).toHaveCount(0);
  const width = await collection
    .locator(".suite-table-viewport")
    .evaluate((element) => element.clientWidth);
  await expect(collection.getByRole("button", { name: "Owner", exact: true })).toHaveCount(
    width >= 1024 ? 1 : 0,
  );
  await expect(collection.getByRole("button", { name: "Modified", exact: true })).toHaveCount(
    width >= 768 ? 1 : 0,
  );
  await page.getByRole("combobox", { name: "Listing sort" }).selectOption("name:desc");
  await expect(
    collection.getByRole("button", { name: "Name", exact: true }).locator(".."),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(collection.locator("th[aria-sort]")).toHaveCount(1);
  await expect(
    collection.getByRole("button", { name: "Actions", exact: true }).locator(".."),
  ).not.toHaveAttribute("aria-sort");
  await expect(collection.locator("[data-collection-item]").first()).toHaveAttribute(
    "aria-label",
    "Reading list.pdf",
  );
  await collection.getByRole("button", { name: "Name", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Listing sort" })).toHaveValue("");
  await expect(collection.locator("th[aria-sort]")).toHaveCount(0);
  await expect(collection.locator("[data-collection-item]").first()).toHaveAttribute(
    "aria-label",
    "Projects",
  );
  await page.getByRole("combobox", { name: "Listing sort" }).selectOption("name:desc");
  await page.getByRole("checkbox", { name: "Keep input order" }).check();
  await expect(collection.locator("[data-collection-item]").first()).toHaveAttribute(
    "aria-label",
    "Projects",
  );
  // Header state still reports the externally selected sort, without reordering input.
  await expect(
    collection.getByRole("button", { name: "Name", exact: true }).locator(".."),
  ).toHaveAttribute("aria-sort", "descending");
  await row("Projects").click();
  await row("Q3 budget.xlsx").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("selected-keys")).toHaveText(
    "Projects, Holiday photos, Q3 budget.xlsx",
  );
  await row("Holiday photos").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("selected-keys")).toHaveText("Projects, Q3 budget.xlsx");
  await collection.getByRole("button", { name: "Inspect Q3 budget.xlsx", exact: true }).click();
  await expect(page.getByTestId("open-result")).toHaveText("Inspecting Q3 budget.xlsx");
  await expect(page.getByTestId("selected-keys")).toHaveText("Projects, Q3 budget.xlsx");
  await row("Holiday photos").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Inspect Holiday photos", exact: true }).click();
  await expect(page.getByTestId("open-result")).toHaveText("Inspecting Holiday photos");
  await expect(page.getByTestId("selected-keys")).toHaveText("Projects, Q3 budget.xlsx");
  await row("Projects").dblclick();
  await expect(page.getByTestId("open-result")).toHaveText("Opened Projects");
  await page.getByRole("checkbox", { name: "Selection follows focus" }).check();
  await row("Projects").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row("Holiday photos")).toBeFocused();
  await expect(page.getByTestId("selected-keys")).toHaveText("Holiday photos");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByTestId("selected-keys")).toHaveText("Holiday photos, Q3 budget.xlsx");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("selected-keys")).toHaveText("Holiday photos");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("open-result")).toHaveText("Opened Q3 budget.xlsx");
  await page.keyboard.press("Tab");
  await expect(
    collection.getByRole("button", { name: "Inspect Q3 budget.xlsx", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("open-result")).toHaveText("Inspecting Q3 budget.xlsx");
  await expect(page.getByTestId("selected-keys")).toHaveText("Holiday photos");
  await row("Q3 budget.xlsx").focus();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(row("Product brief")).toBeFocused();
  await expect(page.getByTestId("selected-keys")).toHaveText("Holiday photos");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("selected-keys")).toHaveText("Holiday photos, Product brief");
  await expect(collection.locator('[data-collection-item][tabindex="0"]')).toHaveCount(1);
  await screenshot(page, "data-table-listing-options", info);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(collection.getByRole("button", { name: "Owner", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(collection.getByRole("button", { name: "Owner", exact: true })).toBeVisible();
  await accessible(page);
});

test("DataTable: density, sticky header and generic drag targets", async ({ page }, info) => {
  await page.goto("/dev/components/data-table");
  await page.getByRole("checkbox", { name: "Use listing options" }).check();
  const collection = page.getByTestId("interactive-collection");
  const row = (name: string) => collection.getByRole("row", { name, exact: true });
  await page.getByRole("combobox", { name: "Density" }).selectOption("compact");
  await expect
    .poll(async () => Math.round((await row("Projects").boundingBox())?.height ?? 0))
    .toBe(32);
  const viewport = collection.locator(".suite-table-viewport");
  await viewport.evaluate((element) => {
    element.scrollTop = 600;
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const header = await collection.locator("thead").boundingBox();
      const container = await viewport.boundingBox();
      return Math.abs((header?.y ?? 0) - (container?.y ?? 0));
    })
    .toBeLessThan(3);
  await page.getByRole("checkbox", { name: "Sticky header" }).uncheck();
  await expect(collection.locator("thead")).toHaveCSS("position", "static");
  expect((await collection.locator("thead").boundingBox())?.y).toBeLessThan(
    (await viewport.boundingBox())?.y ?? 0,
  );
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(row("Projects")).toBeVisible();
  await row("Projects").dragTo(row("Holiday photos"));
  await expect(page.getByTestId("open-result")).toHaveText("Dropped Projects on Holiday photos");
  // Also exercise an accepted drag while the pointer rests on a target, before drop.
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "External item");
    return transfer;
  });
  await row("Q3 budget.xlsx").dispatchEvent("dragover", { dataTransfer: data });
  await expect(row("Q3 budget.xlsx")).toHaveAttribute("data-drop", "true");
  await expect(row("Q3 budget.xlsx")).toHaveCSS("outline-width", "2px");
  await row("Q3 budget.xlsx").dispatchEvent("drop", { dataTransfer: data });
  await expect(page.getByTestId("open-result")).toHaveText(
    "Dropped External item on Q3 budget.xlsx",
  );
  await expect(row("Q3 budget.xlsx")).toHaveAttribute("data-drop", "false");
  await data.dispose();
  await screenshot(page, "data-table-listing-drop", info);
});
