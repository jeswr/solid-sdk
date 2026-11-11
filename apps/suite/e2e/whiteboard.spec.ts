// AUTHORED-BY Codex (GPT-6.1 Sol)

import AxeBuilder from "@axe-core/playwright";
import { DEFAULT_STYLE, emptyScene, rectangle, text } from "@jeswr/excalidraw-scene";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
});
test("demo boards, drawing, undo, exports and persistence are accessible", async ({ page }) => {
  await page.goto("/whiteboard");
  await expect(page.getByRole("article", { name: "Autumn workshop", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByLabel("Board name", { exact: true }).fill("Fictional launch plan");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  // Creation opens the local canvas immediately while the pod write settles.
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "Rectangle (R)", exact: true }).click();
  const b = await canvas.boundingBox();
  if (!b) throw new Error("Missing canvas");
  await page.mouse.move(b.x + 70, b.y + 60);
  await page.mouse.down();
  await page.mouse.move(b.x + 220, b.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /1\. rectangle at/ })).toHaveCount(1);
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /1\. rectangle at/ })).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("button", { name: /1\. rectangle at/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Text (T)", exact: true }).click();
  await canvas.click({ position: { x: 100, y: 200 } });
  await page.getByLabel("Text", { exact: true }).fill("A bright idea");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expect(page.locator(".wb-save")).toHaveText("Saved");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const svg = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG", exact: true }).click();
  expect((await svg).suggestedFilename()).toBe("Fictional launch plan.svg");
  await page.reload();
  await page.getByRole("button", { name: "Open Fictional launch plan", exact: true }).click();
  await expect(page.getByRole("button", { name: /A bright idea at/ })).toHaveCount(1);
});
test("board duplicate, rename, delete with undo and mobile canvas", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/whiteboard");
  await page.getByRole("button", { name: "Duplicate Community garden", exact: true }).click();
  await page.getByRole("button", { name: "Rename Community garden — copy", exact: true }).click();
  await page.getByLabel("Board name", { exact: true }).fill("Garden copy");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("button", { name: "Delete Garden copy", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("article", { name: "Garden copy", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [375, 768, 1280]) {
  test(`keyboard canvas and dark theme at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/whiteboard");
    await page.getByRole("button", { name: "Open Autumn workshop", exact: true }).click();
    const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
    await canvas.focus();
    await page.keyboard.press("r");
    await page.keyboard.press("Enter");
    await page.getByLabel("Shape width", { exact: true }).fill("180");
    await expect(page.getByLabel("Shape width", { exact: true })).toHaveValue("180");
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("paste at the scene limit shows a notice and keeps the editor usable", async ({ page }) => {
  await page.goto("/whiteboard");
  await expect(page.getByRole("button", { name: "Import .excalidraw", exact: true })).toBeEnabled();
  const scene = {
    ...emptyScene(),
    elements: [
      rectangle(0, 0, 100, 100),
      ...Array.from({ length: 4999 }, (_, i) => ({ id: `opaque-${i}`, type: "future" })),
    ],
  };
  await page.getByLabel("Import Excalidraw file").setInputFiles({
    name: "Full board.excalidraw",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  await page.getByRole("button", { name: "Open Full board", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.getByText("Too many elements (maximum 5,000)", { exact: true })).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset zoom, 100%", exact: true })).toHaveText(
    "100%",
  );
});

test("editing imported large text preserves its font size and drawing in dark mode stores Ink", async ({
  page,
}) => {
  await page.goto("/whiteboard");
  await expect(page.getByRole("button", { name: "Import .excalidraw", exact: true })).toBeEnabled();
  const scene = { ...emptyScene(), elements: [text(0, 0, "Before", { fontSize: 48 })] };
  await page.getByLabel("Import Excalidraw file").setInputFiles({
    name: "Large text.excalidraw",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  await page.getByRole("button", { name: "Open Large text", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Whiteboard canvas" });
  await canvas.dblclick({ position: { x: 100, y: 100 } });
  await page.getByLabel("Text", { exact: true }).fill("After\nSecond line");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expect(page.getByLabel("Shape height", { exact: true })).toHaveValue("120");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await canvas.focus();
  await page.keyboard.press("r");
  await page.keyboard.press("Enter");
  await expect(page.locator(".wb-svg rect[stroke]").first()).toHaveAttribute(
    "stroke",
    DEFAULT_STYLE.strokeColor,
  );
});
