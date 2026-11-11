// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));
async function showView(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Places views" });
  if (!(await nav.isVisible()))
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await nav.getByRole("button", { name, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Places navigation", exact: true });
  if (await drawer.isVisible())
    await drawer.getByRole("button", { name: "Close places navigation", exact: true }).click();
}
for (const width of [375, 768, 1280]) {
  test(`Places demo timeline, editing and private import at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let mapRequests = 0;
    await page.route("https://www.openstreetmap.org/**", (route) => {
      mapRequests++;
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Map fixture</title>",
      });
    });
    await page.goto("/places");
    await expect(page.getByRole("heading", { name: "Your timeline", exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Day’s visits and journeys" })).toBeVisible();
    expect(mapRequests).toBe(0);
    await showView(page, "Places");
    await page.getByLabel("Search places").fill("Fern");
    await page.getByRole("button", { name: "Fern & Finch café", exact: true }).click();
    const details = page.getByRole("region", { name: "Place details" });
    await expect(details).toBeVisible();
    await details.getByLabel("Name", { exact: true }).fill("Fern & Finch, favourite café");
    await details.getByLabel("Notes").fill("A fictional favourite for a quiet morning.");
    await details.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      details.getByRole("heading", { name: "Fern & Finch, favourite café" }),
    ).toBeVisible();
    expect(mapRequests).toBe(0);
    await details.getByRole("button", { name: "Show on map", exact: true }).click();
    await expect(details.locator("iframe")).toHaveCount(1);
    await expect(details.getByText(/OpenStreetMap will see/)).toBeVisible();
    await details.getByRole("button", { name: "Hide map", exact: true }).click();
    await expect(details.locator("iframe")).toHaveCount(0);
    // Close the shell's details sheet on narrow screens before navigating.
    const close = page.getByRole("button", { name: /close details/i });
    if (await close.isVisible()) await close.click();
    await showView(page, "Import");
    const json = JSON.stringify({
      semanticSegments: [
        {
          startTime: "2026-11-10T14:00:00Z",
          endTime: "2026-11-10T15:00:00Z",
          visit: {
            topCandidate: {
              placeId: "fictional-observatory",
              placeName: "Merewick observatory",
              placeLocation: { latLng: "48.21, -27.38" },
            },
          },
        },
      ],
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByLabel("Google Timeline JSON file").setInputFiles({
        name: "Timeline.json",
        mimeType: "application/json",
        buffer: Buffer.from(json),
      });
      await expect(page.getByRole("heading", { name: "Preview · Timeline.json" })).toBeVisible();
      await page.getByRole("button", { name: "Import into my private pod", exact: true }).click();
      await expect(
        page.getByText("Import complete. Open Timeline or Places to explore.", { exact: true }),
      ).toBeVisible();
    }
    await showView(page, "Places");
    await page.getByLabel("Search places").fill("observatory");
    await expect(
      page.getByRole("button", { name: "Merewick observatory", exact: true }),
    ).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your timeline", exact: true })).toBeVisible();
    await showView(page, "Stats");
    await expect(page.getByText("Places visited", { exact: true })).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await new AxeBuilder({ page }).analyze();
    expect(
      dark.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
    ).toEqual([]);
  });
}
