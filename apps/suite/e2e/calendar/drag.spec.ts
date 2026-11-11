// AUTHORED-BY Claude Opus 5.5
import { expect, type Locator, type Page, test } from "@playwright/test";

// The demo seed is relative to "today": Sunday 1 Nov 2026, in a Monday-start week.
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
});
async function open(page: Page, view: "week" | "day" | "month") {
  await page.goto(`/calendar/${view}?d=2026-11-01`);
  await expect(page.getByText(/events loaded/)).toBeAttached();
}
async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
/** Press on the chip (at `grabY` px from its top), then travel to the target in small steps. */
async function press(page: Page, chip: Locator, grabY?: number) {
  await chip.scrollIntoViewIfNeeded();
  const { x, y, box } = await centre(chip);
  const start = { x, y: grabY === undefined ? y : box.y + grabY };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  return start;
}
async function travel(page: Page, to: { x: number; y: number }) {
  await page.mouse.move(to.x, to.y, { steps: 8 });
}
function announcement(page: Page) {
  return page.getByRole("status").filter({ hasText: /^(Moved|Resized|Move cancelled)/ });
}
function column(page: Page, day: string) {
  return page.locator(`[data-event-day="${day}"]`);
}

test("moves a timed event to another day and time in week view", async ({ page }) => {
  await open(page, "week");
  const chip = page.getByRole("button", { name: /^Project planning, 11:00–12:00, Work$/ });
  const start = await press(page, chip);
  const target = await centre(column(page, "2026-10-31"));
  // Three hours down (48px per hour), one column left.
  await travel(page, { x: target.x, y: start.y + 144 });
  const ghost = page.locator(".cal-drag-ghost");
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText("Project planning");
  await expect(chip).toHaveAttribute("data-dragging", "move");
  await page.mouse.up();
  const moved = column(page, "2026-10-31").getByRole("button", {
    name: "Project planning, 14:00–15:00, Work",
    exact: true,
  });
  await expect(moved).toBeVisible();
  await expect(ghost).toHaveCount(0);
  await expect(announcement(page)).toHaveText("Moved Project planning to Sat 31 Oct, 14:00");
  await expect(
    column(page, "2026-11-01").getByRole("button", { name: /^Project planning,/ }),
  ).toHaveCount(0);
  // The drag did not open details, and the move is persisted to the pod.
  await expect(page.getByRole("button", { name: "Close event details" })).toHaveCount(0);
  await expect(page.locator(".cal-sync-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByText(/events loaded/)).toBeAttached();
  await expect(moved).toBeVisible();
});

test("resizes a timed event's end in day view", async ({ page }) => {
  await open(page, "day");
  const chip = page.getByRole("button", { name: /^Dinner with friends, 19:00–21:00, Personal$/ });
  await chip.scrollIntoViewIfNeeded();
  const { box } = await centre(chip);
  // Grab the bottom-edge resize grip.
  const start = await press(page, chip, box.height - 3);
  await expect(chip.locator(".cal-resize-handle")).toBeAttached();
  await travel(page, { x: start.x, y: start.y + 48 });
  await expect(chip).toHaveAttribute("data-dragging", "resize-end");
  await expect(page.locator(".cal-drag-ghost")).toContainText("19:00–22:00");
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Dinner with friends, 19:00–22:00, Personal", exact: true }),
  ).toBeVisible();
  await expect(announcement(page)).toHaveText(
    "Resized Dinner with friends to end Sun 1 Nov, 22:00",
  );
});

test("moves a multi-day all-day event as a block in month view", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 640,
    "Compact month indicators open the day's agenda; dragging uses the desktop bars.",
  );
  await open(page, "month");
  const trip = (day: string) =>
    page
      .locator(`.cal-month [data-day="${day}"]`)
      .getByRole("button", { name: /^Three-day trip,/ });
  await press(page, trip("2026-11-01"));
  await travel(page, await centre(page.locator('.cal-month [data-day="2026-11-08"]')));
  for (const day of ["2026-11-08", "2026-11-09", "2026-11-10"])
    await expect(page.locator(`.cal-month [data-day="${day}"]`)).toHaveAttribute(
      "data-drop-target",
      "true",
    );
  await expect(page.locator(".cal-month .cal-drag-ghost")).toHaveCount(3);
  await page.mouse.up();
  for (const day of ["2026-11-08", "2026-11-09"])
    await expect(trip(day)).toHaveAccessibleName(
      "Three-day trip, Sun 8 Nov 2026 – Tue 10 Nov 2026, Personal",
    );
  await expect(trip("2026-11-10")).toHaveCount(0);
  for (const day of ["2026-11-01", "2026-11-02", "2026-11-03"])
    await expect(trip(day)).toHaveCount(0);
  await expect(announcement(page)).toHaveText("Moved Three-day trip to Sun 8 Nov");
});

test("moves an all-day event across days in the week view's all-day row", async ({ page }) => {
  await open(page, "week");
  const bar = page.locator(".cal-all-day").getByRole("button", { name: /^A day for myself,/ });
  await press(page, bar);
  const target = await centre(column(page, "2026-10-30"));
  const start = await centre(bar);
  await travel(page, { x: target.x, y: start.y });
  await expect(page.locator(".cal-all-day .cal-drag-ghost")).toContainText("A day for myself");
  await page.mouse.up();
  await expect(announcement(page)).toHaveText("Moved A day for myself to Fri 30 Oct");
  await expect(bar).toHaveAccessibleName("A day for myself, All day, Personal");
  await expect(async () => {
    const moved = await centre(bar);
    const friday = await column(page, "2026-10-30").boundingBox();
    expect(moved.x).toBeGreaterThan(friday?.x ?? Infinity);
    expect(moved.x).toBeLessThan((friday?.x ?? 0) + (friday?.width ?? 0));
  }).toPass();
});

test('moves one occurrence of a recurring event with "This event"', async ({ page }) => {
  await open(page, "week");
  const standUp = (day: string) =>
    column(page, day).getByRole("button", { name: /^Team stand-up,/ });
  const chip = standUp("2026-10-28");
  await expect(chip).toHaveAccessibleName("Team stand-up, 09:30–09:45, Work");
  // Grab above the 8px resize grip of the 24px chip.
  const start = await press(page, chip, 6);
  await travel(page, { x: start.x, y: start.y + 48 });
  await page.mouse.up();
  const dialog = page.getByRole("alertdialog", { name: "Edit recurring event" });
  await expect(dialog).toBeVisible();
  // The preview stays at the target while the scope is chosen.
  await expect(page.locator(".cal-drag-ghost")).toContainText("10:30");
  await dialog.getByRole("button", { name: "This event", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(standUp("2026-10-28")).toHaveAccessibleName("Team stand-up, 10:30–10:45, Work");
  await expect(standUp("2026-10-26")).toHaveAccessibleName("Team stand-up, 09:30–09:45, Work");
  await expect(standUp("2026-10-30")).toHaveAccessibleName("Team stand-up, 09:30–09:45, Work");
  await expect(announcement(page)).toHaveText("Moved Team stand-up to Wed 28 Oct, 10:30");
  await expect(page.locator(".cal-sync-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByText(/events loaded/)).toBeAttached();
  await expect(standUp("2026-10-28")).toHaveCount(1);
  await expect(standUp("2026-10-28")).toHaveAccessibleName("Team stand-up, 10:30–10:45, Work");
});

test("Escape cancels a drag without saving or opening details", async ({ page }) => {
  await open(page, "week");
  const chip = page.getByRole("button", { name: /^Project planning, 11:00–12:00, Work$/ });
  const start = await press(page, chip);
  await travel(page, { x: start.x, y: start.y + 96 });
  const ghost = page.locator(".cal-drag-ghost");
  await expect(ghost).toContainText("13:00");
  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
  await expect(chip).not.toHaveAttribute("data-dragging");
  await page.mouse.up();
  await expect(announcement(page)).toHaveText("Move cancelled");
  await expect(chip).toHaveAccessibleName("Project planning, 11:00–12:00, Work");
  await expect(page.getByRole("button", { name: "Close event details" })).toHaveCount(0);
  // A plain click still opens details.
  await chip.click();
  await expect(page.getByRole("button", { name: "Close event details" })).toBeVisible();
});
