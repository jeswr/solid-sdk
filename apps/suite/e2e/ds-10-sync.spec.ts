// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

const directory = fileURLToPath(new URL("../../../artifacts/playwright/DS-10/", import.meta.url));
async function accessible(page: Page, selector?: string) {
  const builder = new AxeBuilder({ page });
  const results = await (selector ? builder.include(selector) : builder).analyze();
  expect(
    results.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
}
async function capture(page: Page, state: string, project: string) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${state}-${project}.png`, fullPage: true });
}
async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 60; index++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard path did not reach its target");
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

const scenarios = [
  "Hidden",
  "Offline",
  "Reconnecting",
  "1 waiting",
  "3 waiting",
  "Conflict",
  "3 conflicts",
  "Offline with changes",
  "Failed",
  "Failed without detail",
  "Not synced yet",
  "Mixed",
];

test("pill: every state, icon names, tooltips, axe and reflow", async ({ page }, info) => {
  await page.goto("/dev/components/offline-pill");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const scenario of scenarios) {
    const region = page.locator(`[data-fixture="${scenario}"]`);
    if (["Hidden", "Not synced yet"].includes(scenario))
      await expect(region.getByRole("button")).toHaveCount(0);
    else {
      const icon = region.locator('[data-sync-variant="icon"]');
      const pill = region.locator('[data-sync-variant="pill"]');
      await expect(icon).toHaveAttribute(
        "aria-label",
        (await pill.getAttribute("aria-label")) ?? "",
      );
      // Radix opens tooltips on hover or keyboard focus (not programmatic focus).
      await icon.hover();
      await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
    }
    await accessible(page, `[data-fixture="${scenario}"]`);
    await capture(page, `pill-${scenario.replaceAll(" ", "-")}`, info.project.name);
    await page.keyboard.press("Escape");
  }
  await accessible(page);
  await reflow(page);
});

test("sheet: every state, retries, conflict actions, axe and screenshots", async ({
  page,
}, info) => {
  await page.goto("/dev/components/sync-sheet");
  for (const scenario of scenarios) {
    const trigger = page.getByRole("button", { name: `Open ${scenario}`, exact: true });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Sync status" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    if (!box) throw new Error("Missing sheet geometry");
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Missing viewport");
    if (viewport.width < 768) expect(box.y + box.height).toBeCloseTo(viewport.height, 0);
    else {
      expect(box.x + box.width).toBeCloseTo(viewport.width, 0);
      expect(box.y).toBe(0);
    }
    if (["Hidden", "Offline", "Reconnecting", "Not synced yet"].includes(scenario))
      await expect(sheet.getByText("Everything is saved")).toBeVisible();
    if (scenario === "Not synced yet")
      await expect(sheet.getByText("Not synced yet")).toBeVisible();
    else await expect(sheet.getByText(/Last synced/)).toBeVisible();
    if (scenario === "Offline with changes") {
      await expect(sheet.getByRole("button", { name: "Retry all" })).toBeDisabled();
      await sheet.getByRole("group", { name: "Reconnect to retry" }).focus();
      await expect(page.getByRole("tooltip")).toHaveText("Reconnect to retry");
      await sheet.getByRole("heading", { name: "Sync status", exact: true }).focus();
    }
    if (scenario === "Failed") {
      await sheet.getByRole("button", { name: "Retry Rename project brief" }).click();
      await expect(page.getByText("Retrying failed-change", { exact: true })).toBeAttached();
      await sheet.getByRole("button", { name: "Retry all" }).click();
    }
    await accessible(page);
    await capture(page, `sheet-${scenario.replaceAll(" ", "-")}`, info.project.name);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await page.getByRole("button", { name: "Open Mixed", exact: true }).click();
  await reflow(page);
});

test("sheet: a long queue scrolls inside the sheet to its last action", async ({ page }) => {
  await page.goto("/dev/components/sync-sheet");
  await page.getByRole("button", { name: "Open Long queue", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  await expect(sheet).toBeVisible();
  const last = sheet.getByRole("button", { name: "Resolve Last conflict" });
  await last.scrollIntoViewIfNeeded();
  const box = await last.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("Missing geometry");
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // The scroll happened inside the sheet; the locked page did not move.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await last.click();
  const decision = page.getByRole("dialog", { name: "This item changed somewhere else" });
  await expect(decision).toBeVisible();
  await expect(decision.getByRole("button", { name: "Keep both" })).toBeFocused();
});

test("sheet: a long queue with no buttons scrolls from the keyboard", async ({ page }) => {
  await page.goto("/dev/components/sync-sheet");
  await page.getByRole("button", { name: "Open Long pending queue", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  await expect(sheet).toBeVisible();
  const region = sheet.getByRole("region", { name: "Sync items" });
  const scrollTop = () => region.evaluate((node) => node.scrollTop);
  expect(await scrollTop()).toBe(0);
  // Tab reaches the scroll region; the arrow and End keys then scroll it.
  for (let i = 0; i < 5 && !(await region.evaluate((n) => n === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(region).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(scrollTop).toBeGreaterThan(0);
  await expect(sheet.getByText("Waiting change 24")).toBeInViewport();
});

test("keyboard: pill opens sheet, Escape restores pill; conflict returns to Resolve", async ({
  page,
}) => {
  await page.goto("/dev/components/offline-pill");
  const pill = page.locator('[data-fixture="Conflict"] [data-sync-variant="pill"]');
  await tabTo(page, pill);
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  await expect(sheet).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(pill).toBeFocused();
  await page.keyboard.press("Enter");
  const resolve = sheet.getByRole("button", { name: "Resolve Project brief" });
  await tabTo(page, resolve);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Keep both" })).toBeFocused();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(resolve).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pill).toBeFocused();
});

test("conflict: equal choices, initial focus, focus order, copy explanation and axe", async ({
  page,
}, info) => {
  await page.goto("/dev/components/conflict-dialog");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await accessible(page);
  for (const [choice, strategy] of [
    ["Keep mine", "mine"],
    ["Keep theirs", "theirs"],
    ["Keep both", "both"],
  ] as const) {
    const trigger = page.getByRole("button", { name: "Open conflict", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const both = dialog.getByRole("button", { name: "Keep both" });
    await expect(both).toBeFocused();
    await expect(both).toHaveAccessibleDescription("Keep both saves your version as a copy.");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Keep theirs" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Keep mine" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    const styles = await dialog.locator(".suite-conflict-actions > button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return [
          style.backgroundColor,
          style.color,
          style.borderColor,
          style.fontWeight,
          button.getBoundingClientRect().width,
        ];
      }),
    );
    expect(styles[0]?.slice(0, 4)).toEqual(styles[1]?.slice(0, 4));
    expect(styles[1]?.slice(0, 4)).toEqual(styles[2]?.slice(0, 4));
    expect(Number(styles[0]?.[4])).toBeCloseTo(Number(styles[1]?.[4]), 0);
    expect(Number(styles[1]?.[4])).toBeCloseTo(Number(styles[2]?.[4]), 0);
    await accessible(page);
    await capture(page, `conflict-${strategy}`, info.project.name);
    await dialog.getByRole("button", { name: choice }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("status")).toHaveText(`Chose ${strategy}`);
  }
  await page.getByRole("button", { name: "Open long summary" }).click();
  await capture(page, "conflict-long-summary", info.project.name);
  await reflow(page);
});

test("capabilities: supported, hidden, disabled, note, missing, custom reason and axe", async ({
  page,
}, info) => {
  await page.goto("/dev/components/capability-gate");
  for (const scenario of [
    "Supported",
    "Disabled",
    "Hidden",
    "Note",
    "Custom reason",
    "Missing capability",
    "Online requirements",
  ]) {
    const region = page.locator(`[data-fixture="${scenario}"]`);
    if (scenario === "Hidden") await expect(region.getByRole("button")).toHaveCount(0);
    else if (scenario === "Supported") {
      await region.getByRole("button").click();
      await expect(page.getByRole("status")).toHaveText("Moved to trash");
    } else if (scenario !== "Online requirements") {
      await expect(region.getByRole("button")).toBeDisabled();
      await region.getByRole("group").hover();
      await expect(page.getByRole("tooltip")).toHaveText(
        scenario === "Custom reason"
          ? "Your storage does not offer trash."
          : "Not available on this storage",
      );
    }
    if (scenario === "Note")
      await expect(
        region.getByRole("link", { name: "Learn what your storage supports" }),
      ).toHaveAttribute("href", "/settings/storage");
    await accessible(page, `[data-fixture="${scenario}"]`);
    await capture(page, `gate-${scenario.replaceAll(" ", "-")}`, info.project.name);
    await page.keyboard.press("Escape");
  }
  await reflow(page);
});

test("browser offline transition shows the pill and reconnecting hides it", async ({
  page,
  context,
}, info) => {
  await page.goto("/dev/components/offline-pill");
  const region = page.locator('[data-fixture="Browser connection"]');
  await expect(region.getByRole("status")).toHaveText("Browser is online");
  await expect(region.getByRole("button")).toHaveCount(0);
  await context.setOffline(true);
  await expect(
    region.getByRole("button", { name: "Offline — showing saved copies" }),
  ).toBeVisible();
  await accessible(page);
  await capture(page, "browser-offline", info.project.name);
  await context.setOffline(false);
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(region.getByRole("status")).toHaveText("Browser is online");
  await accessible(page);
});
