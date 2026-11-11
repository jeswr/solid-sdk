// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { appRegistry } from "../../src/shell/registry";
import { companionApps } from "../../src/welcome/apps";

test("welcome shows the directory, captioned tour, pending media and feedback steps", async ({
  page,
}) => {
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Try the Solid Suite");
  for (const name of [
    "The apps",
    "Watch first, if you like",
    "More features",
    "How to give feedback",
  ]) {
    await expect(page.getByRole("heading", { name, exact: true, level: 2 })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Start the guided walkthrough" })).toHaveAttribute(
    "href",
    "/welcome/walkthrough",
  );
  const apps = page.getByRole("navigation", { name: "Suite apps", exact: true });
  await expect(apps.getByRole("link")).toHaveCount(appRegistry.length);
  for (const app of appRegistry)
    await expect(apps.locator(`a[data-app="${app.slug}"]`)).toHaveAttribute("href", app.basePath);
  const companions = page.getByRole("navigation", { name: "Companion apps", exact: true });
  for (const app of companionApps)
    await expect(
      companions
        .getByRole("link")
        .filter({ has: page.getByRole("heading", { name: app.name, exact: true }) }),
    ).toHaveAttribute("href", app.href);
  await expect(page.getByTestId("tour-video")).toBeVisible();
  await expect(
    page.getByTestId("tour-video").locator("track[kind=captions][default]"),
  ).toHaveAttribute("src", "/media/suite-walkthrough.vtt");
  await expect(page.getByTestId("feedback-pending")).toContainText("This video isn't ready yet.");
  await expect(page.getByTestId("clips-pending")).toContainText(
    "The feature clips aren't ready yet.",
  );
  await page.getByTestId("tour-video").evaluate((video) => {
    Object.defineProperty(video, "duration", { value: 201, configurable: true });
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  await expect(page.getByText("3 minutes, with captions")).toBeVisible();
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(
    a11y.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("welcome preserves the demo return route", async ({ page }) => {
  await page.goto("/welcome?next=%2Fdrive");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "href",
    "/signin?next=%2Fdrive",
  );
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/drive\/my$/);
  await expect(page.getByRole("link", { name: "Give feedback", exact: true })).toHaveAttribute(
    "href",
    "/feedback",
  );
  await expect(page.getByRole("link", { name: "Give feedback", exact: true })).toBeInViewport();
  await expect(page.getByRole("complementary", { name: "Walkthrough guide" })).toHaveCount(0);
});

test("a listed video with a missing file shows the pending state", async ({ page }) => {
  await page.route("**/media/manifest.json", (route) =>
    route.fulfill({
      json: {
        videos: {
          tour: {
            id: "tour",
            title: "A tour of the Solid Suite",
            summary: "Tour",
            file: "missing-tour.mp4",
          },
        },
        clips: [],
      },
    }),
  );
  await page.goto("/welcome");
  await expect(page.getByTestId("tour-pending")).toContainText("This video isn't ready yet.");
});

test("feature clips follow deep links, selection and autoplay next", async ({ page }) => {
  await page.route("**/media/manifest.json", (route) =>
    route.fulfill({
      json: {
        videos: {},
        clips: [
          {
            id: "drive",
            title: "Find your files",
            summary: "Try Drive.",
            file: "suite-walkthrough.mp4",
            captions: "suite-walkthrough.vtt",
          },
          {
            id: "docs",
            title: "Write a document",
            summary: "Try Docs.",
            file: "suite-walkthrough.mp4",
            captions: "suite-walkthrough.vtt",
          },
        ],
      },
    }),
  );
  await page.goto("/welcome#clip-docs");
  const picker = page.getByLabel("Choose a feature");
  await expect(picker).toHaveValue("docs");
  await picker.selectOption("drive");
  await expect(page).toHaveURL(/#clip-drive$/);
  await page.getByTestId("clip-video").dispatchEvent("ended");
  await expect(picker).toHaveValue("docs");
  await expect(page.getByTestId("clip-video")).toHaveAttribute("autoplay", "");
  await picker.selectOption("drive");
  await page.getByRole("button", { name: "Next: Write a document" }).click();
  await expect(picker).toHaveValue("docs");
  await page.evaluate(() => {
    location.hash = "clip-drive";
  });
  await expect(picker).toHaveValue("drive");
});
