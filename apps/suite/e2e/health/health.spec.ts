// AUTHORED-BY Codex GPT-6
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  // Keep Date deterministic while timers continue to run for autosync and UI waits.
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
  await page.route("**/__health-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__health-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod database deletion blocked"));
    });
  });
  await page.unroute("**/__health-test-reset");
});
async function ready(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: /Loading|Preparing/ })).toHaveCount(0);
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle(/Health/);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, screen: string) {
  const directory = fileURLToPath(
    new URL("../../../../artifacts/screens/health/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${directory}/${info.project.name}-${screen}.png`,
    fullPage: true,
  });
}
async function addWeight(page: Page, value: string) {
  await page.getByRole("button", { name: "Add measurement", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add measurement", exact: true });
  await sheet.getByLabel("Metric", { exact: true }).selectOption("weight");
  await sheet.getByLabel("Value", { exact: true }).fill(value);
  await sheet.getByRole("button", { name: "Save measurement", exact: true }).click();
  await expect(sheet).toBeHidden();
}
test("weight entry, chart and bucket table match, with keyboard and private dashboard", async ({
  page,
}, info) => {
  await ready(page, "/health", "Summary");
  await expect(page.getByRole("region", { name: "Medication reminders" })).toContainText(
    "Vitamin D",
  );
  await accessible(page);
  await capture(page, info, "dashboard");
  const trigger = page.getByRole("button", { name: "Add measurement", exact: true }).first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Add measurement", exact: true });
  await expect(sheet).toBeVisible();
  await accessible(page);
  await capture(page, info, "add-measurement");
  await sheet.getByRole("button", { name: "Save measurement", exact: true }).click();
  await expect(sheet.getByText("Enter a positive number", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await addWeight(page, "76.3");
  await expect(page.getByTestId("health-card-weight")).toContainText("76.3");
  await page.clock.setFixedTime(new Date("2026-11-01T12:01:00Z"));
  await addWeight(page, "84.1");
  await expect(page.getByTestId("health-card-weight")).toContainText("84.1");
  await page.getByTestId("health-card-weight").getByRole("link", { name: "Weight" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Weight", exact: true })).toBeVisible();
  const chart = page.getByRole("group", { name: /^Weight over/ });
  await expect(chart).toBeVisible();
  await expect(page.getByText("Latest reading:")).toContainText("84.1 kg");
  const point = chart.locator("circle").last();
  const label = await point.getAttribute("aria-label");
  await expect(point).toHaveAttribute("aria-label", /average of 3 readings: 77.9 kg/);
  await expect(chart).toHaveAttribute(
    "aria-label",
    /Latest plotted Weight, 2026-11-01: average of 3 readings: 77.9 kg/,
  );
  const expectedValue = label?.split(": ").at(-1)?.replace(" kg", "");
  await point.focus();
  await expect(page.locator(".hlt-chart-tooltip")).toContainText(expectedValue as string);
  await page.keyboard.press("ArrowLeft");
  await expect(point).not.toBeFocused();
  await page.keyboard.press("End");
  await expect(point).toBeFocused();
  await accessible(page);
  await capture(page, info, "metric-chart");
  await page.getByRole("button", { name: "Show as table", exact: true }).click();
  await expect(page.getByRole("table")).toContainText(expectedValue as string);
  await accessible(page);
  await capture(page, info, "metric-table");
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await expect(page.getByRole("button", { name: "7D", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByText("Latest reading:")).toContainText("84.1 kg");
});

test("previews fifty Apple Health measurements, imports them and opens a GPX workout", async ({
  page,
}, info) => {
  await ready(page, "/health/import", "Import");
  await accessible(page);
  await capture(page, info, "import");
  await page
    .getByLabel("Choose or drop an XML file")
    .setInputFiles(fileURLToPath(new URL("fixtures/export.xml", import.meta.url)));
  await expect(page.getByRole("status", { name: "Apple Health preview status" })).toHaveText(
    "Apple Health preview complete. 50 measurements ready to import.",
  );
  await expect(page.getByText("50 measurements", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 50 measurements", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Import 50 measurements", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import complete", exact: true })).toBeVisible();
  await expect(page.getByText(/50 read · 50 saved/)).toBeVisible();
  await page
    .getByLabel("Choose or drop GPX files")
    .setInputFiles(fileURLToPath(new URL("fixtures/route.gpx", import.meta.url)));
  await expect(page.getByRole("status", { name: "GPX preview status" })).toHaveText(
    "GPX preview complete. 1 workout ready to import.",
  );
  await expect(page.getByText(/4 points ·/)).toBeVisible();
  await page.getByRole("button", { name: "Import 1 workout", exact: true }).click();
  await page.getByRole("link", { name: "Open route.gpx", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Run ·/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Workout route with 4 points/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Elevation profile/ })).toBeVisible();
  await accessible(page);
  await capture(page, info, "workout-detail");
  await page.getByRole("button", { name: "Show as table", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("31");
  await accessible(page);
  await ready(page, "/health/m/weight", "Weight");
  await expect(page.locator(".hlt-entry").filter({ hasText: "74.9" })).toBeVisible();
});

test("edits private records, shows a due medication, and supports drawer navigation", async ({
  page,
}, info) => {
  await ready(page, "/health/medications", "Medications");
  await accessible(page);
  await capture(page, info, "medications");
  await page.getByRole("button", { name: "Add medication", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add medication", exact: true });
  await sheet.getByLabel("Name", { exact: true }).fill("Morning record");
  await sheet.getByLabel("Dose", { exact: true }).fill("As prescribed");
  await sheet.getByLabel("Reminder time (UTC)").fill("00:00");
  await sheet.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Morning record", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("button", {
      name: (page.viewportSize()?.width ?? 0) >= 768 ? "Morning record" : "Edit Morning record",
      exact: true,
    })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit medication", exact: true });
  await edit.getByLabel("Name", { exact: true }).fill("Morning record updated");
  await edit.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(edit).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
    await expect(navigation.getByText("Only you can see this", { exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Summary", exact: true }).click();
  } else
    await page
      .getByRole("navigation", { name: "Health", exact: true })
      .getByRole("link", { name: "Summary", exact: true })
      .click();
  await expect(page.getByRole("region", { name: "Medication reminders" })).toContainText(
    "Morning record updated",
  );
  for (const [path, heading] of [
    ["conditions", "Conditions"],
    ["immunisations", "Immunisations"],
    ["workouts", "Workouts"],
  ]) {
    await ready(page, `/health/${path}`, heading as string);
    await accessible(page);
  }
});

test("rejects zipped exports and malformed GPX without saving", async ({ page }) => {
  await ready(page, "/health/import", "Import");
  await page
    .getByLabel("Choose or drop an XML file")
    .setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: Buffer.from("zip") });
  await expect(page.getByText(/Unzip your Apple Health export/)).toBeVisible();
  await page.getByLabel("Choose or drop GPX files").setInputFiles({
    name: "empty.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from("<gpx/>"),
  });
  await expect(page.getByText(/Couldn't preview the route/)).toBeVisible();
  await accessible(page);
});

for (const { zone, now, todayTime } of [
  { zone: "Pacific/Auckland", now: "2026-10-31T20:15:00Z", todayTime: "09:15" },
  // The second 01:30 during the DST rollback must retain its exact instant.
  { zone: "America/New_York", now: "2026-11-01T06:30:00Z", todayTime: "01:30" },
])
  test.describe(`date-only readings in ${zone}`, () => {
    test.use({ timezoneId: zone });
    test("uses the current time for today and local noon for historical dates", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date(now));
      await ready(page, "/health", "Summary");
      const addDatedWeight = async (value: string, date: string) => {
        await page.getByRole("button", { name: "Add measurement", exact: true }).first().click();
        const sheet = page.getByRole("dialog", { name: "Add measurement", exact: true });
        await sheet.getByLabel("Metric", { exact: true }).selectOption("weight");
        await sheet.getByLabel("Value", { exact: true }).fill(value);
        await sheet.getByLabel("Date and time", { exact: true }).fill(date);
        await sheet.getByRole("button", { name: "Save measurement", exact: true }).click();
        await expect(sheet).toBeHidden();
      };
      await addDatedWeight("86.7", "today");
      // A future timestamp would be omitted by the dashboard's as-of filter.
      await expect(page.getByTestId("health-card-weight")).toContainText("86.7");
      await page.reload();
      await expect(page.getByTestId("health-card-weight")).toContainText("86.7");
      await addDatedWeight("85.4", "31 Oct 2026");
      await page.getByTestId("health-card-weight").getByRole("link", { name: "Weight" }).click();
      await expect(page.locator(".hlt-entry").filter({ hasText: "86.7 kg" })).toContainText(
        `1 Nov 2026, ${todayTime}`,
      );
      await expect(page.locator(".hlt-entry").filter({ hasText: "85.4 kg" })).toContainText(
        "31 Oct 2026, 12:00",
      );
      await accessible(page);
    });
  });

// AUTHORED-BY Claude Opus 5.5
test("exports a FHIR bundle for a date range and refuses a reversed range", async ({
  page,
}, info) => {
  await ready(page, "/health/export", "Export");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2025-11-02");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-11-01");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download FHIR file", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("health-2025-11-02-to-2026-11-01.fhir.json");
  const bundle = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(bundle).toMatchObject({ resourceType: "Bundle", type: "collection" });
  await expect(page.getByRole("heading", { name: "Download ready", exact: true })).toBeVisible();
  const kinds = (bundle.entry as { resource: { resourceType: string } }[]).map(
    (entry) => entry.resource.resourceType,
  );
  const summary = page.locator(".hlt-import-preview");
  for (const [label, type] of [
    ["Readings", "Observation"],
    ["Medications", "MedicationStatement"],
    ["Conditions", "Condition"],
  ]) {
    const count = kinds.filter((kind) => kind === type).length;
    expect(count).toBeGreaterThan(0);
    await expect(summary.locator("div", { hasText: label }).locator("dd")).toHaveText(
      String(count),
    );
  }
  await accessible(page);
  await capture(page, info, "export");
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: "Download FHIR file", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "start date on or before the end date" }),
  ).toBeVisible();
  await expect(page.getByLabel("From", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("To", { exact: true })).toHaveAccessibleDescription(
    /start date on or before the end date/,
  );
  await accessible(page);
});
