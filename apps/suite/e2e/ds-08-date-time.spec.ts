// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await accessible(page);
  const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-08/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await accessible(page);
}
for (const route of ["date-time-field", "date-picker-popover", "recurrence-editor"]) {
  test(`${route}: all fixture states`, async ({ page }, info) => {
    await page.goto(`/dev/components/${route}`);
    await expect(page.locator("html")).toHaveClass(
      info.project.use.colorScheme === "dark" ? /dark/ : /light/,
    );
    await capture(page, info, `${route}-states`);
    await reflow(page);
  });
}
test("DateTimeField: keyboard interpretation, invalid input, locale and clear", async ({
  page,
}, info) => {
  await page.goto("/dev/components/date-time-field");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab"); // fixtures link
  await page.keyboard.press("Tab"); // locale
  await page.keyboard.press("Tab"); // due date
  const input = page.getByRole("textbox", { name: "Due date", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-width", "2px");
  await page.keyboard.type("tomorrow 5pm");
  await expect(input.locator("..").getByRole("status")).toContainText("27 October 2026");
  await capture(page, info, "date-time-field-typed");
  await input.press("ControlOrMeta+A");
  await page.keyboard.type("not a date");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await capture(page, info, "date-time-field-invalid");
  await input.press("ControlOrMeta+A");
  await page.keyboard.type("next mon");
  await expect(input.locator("..").getByRole("status")).toContainText("All day");
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(input.locator("..").getByRole("status")).toHaveText("No date selected");
  await page.getByLabel("Account locale").selectOption("en-US");
  await page.getByLabel("Numeric date").fill("10/11/2026");
  await expect(page.getByLabel("Numeric date").locator("..").getByRole("status")).toContainText(
    "October 11, 2026",
  );
  await capture(page, info, "date-time-field-en-us");
  await reflow(page);
});
for (const [name, label] of [
  ["empty", "Due date Choose"],
  ["all-day", "Deadline"],
  ["timed", "Appointment"],
]) {
  test(`DatePickerPopover: ${name} open and reflow`, async ({ page }, info) => {
    await page.goto("/dev/components/date-picker-popover");
    await page.getByRole("button", { name: new RegExp(label as string) }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, info, `date-picker-${name}-open`);
    await reflow(page);
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: new RegExp(label as string) })).toBeFocused();
  });
}
test.describe("DatePickerPopover hydration across timezones", () => {
  test.use({ timezoneId: "America/New_York" });
  test("localizes the fixed fixture instant without hydration errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/dev/components/date-picker-popover");
    const trigger = page.getByRole("button", { name: /Appointment/ });
    await expect(trigger).toContainText("Tuesday, 27 October 2026 at 13:00");
    await trigger.click();
    await expect(page.getByLabel("Time", { exact: true })).toHaveValue("13:00");
    expect(errors).toEqual([]);
    await accessible(page);
  });
});
test("DatePickerPopover: keyboard calendar, time and return focus", async ({ page }, info) => {
  await page.goto("/dev/components/date-picker-popover");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const trigger = page.getByRole("button", { name: /Due date/ });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Due date" });
  await expect(dialog.locator(".rdp-day_button:focus")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("All day")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Time")).toBeFocused();
  // Native time segment keyboard interactions vary by OS; verify reachable and editable.
  await dialog.getByLabel("Time").fill("17:30");
  await capture(page, info, "date-picker-keyboard-timed");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(trigger).toContainText("Choose a date");
  await accessible(page);
});
test("RecurrenceEditor: keyboard mode changes and invalid states", async ({ page }, info) => {
  await page.goto("/dev/components/recurrence-editor");
  const first = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Does not repeat", exact: true }) });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(first.getByLabel("Frequency")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // daily
  await page.keyboard.press("Tab");
  await expect(first.getByLabel(/Repeat every/)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  await expect(first.getByRole("status")).toContainText("Every 2 days");
  await first.getByLabel("Frequency").selectOption("MONTHLY");
  await first.getByLabel("Monthly pattern").selectOption("weekday");
  await first.getByLabel("Which week").selectOption("-1");
  await first.getByLabel("Weekday", { exact: true }).selectOption("Friday");
  await capture(page, info, "recurrence-editor-monthly-last");
  await first.getByLabel("Ends", { exact: true }).selectOption("after");
  await first.getByLabel("Occurrences").fill("0");
  await expect(first.getByRole("alert")).toContainText("whole number");
  await capture(page, info, "recurrence-editor-invalid-count");
  await first.getByLabel("Occurrences").fill("3");
  await first.getByLabel("Ends", { exact: true }).selectOption("on");
  await first.getByLabel("End date").fill("");
  await capture(page, info, "recurrence-editor-invalid-until");
  await first.getByLabel("Frequency").selectOption("WEEKLY");
  await first.getByRole("checkbox", { name: /Monday/ }).uncheck();
  await capture(page, info, "recurrence-editor-no-weekdays");
  await first.getByLabel(/Repeat every/).fill("");
  await capture(page, info, "recurrence-editor-invalid-interval");
  await reflow(page);
});

test("DatePickerPopover: touch targets and narrow calendar", async ({ browser }, info) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: info.project.use.viewport ?? { width: 375, height: 900 },
    colorScheme: info.project.use.colorScheme ?? "light",
    reducedMotion: "reduce",
    ...(info.project.use.baseURL ? { baseURL: info.project.use.baseURL } : {}),
  });
  const page = await context.newPage();
  try {
    await page.goto("/dev/components/date-picker-popover");
    await page.getByRole("button", { name: /Due date Choose/ }).click();
    await capture(page, info, "date-picker-touch-open");
    await reflow(page);
    for (const control of await page.getByRole("dialog").locator("button, input").all()) {
      const bounds = await control.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  } finally {
    await context.close();
  }
});
