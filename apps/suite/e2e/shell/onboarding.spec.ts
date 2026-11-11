// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Mirrors src/shell/session/demo-backend.ts; importing it would load the demo pod seed.
const demoAccount = {
  id: "demo",
  name: "Alice Wilder",
  webId: "https://alice.demo.pod/profile/card#me",
  storageUrl: "https://alice.demo.pod/",
  kind: "demo",
};
const PREFS_KEY = `suite.prefs.v1.${demoAccount.id}`;
const START = /\/home$/;

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, name: string, project: string) {
  await accessible(page);
  const directory = "../../artifacts/playwright/shell";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${project}.png`, fullPage: true });
}
async function tabTo(page: Page, target: Locator, limit = 30) {
  for (let step = 0; step < limit; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
const onboardingState = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").onboarding, PREFS_KEY);
const skip = (page: Page) => page.getByRole("button", { name: "Skip setup" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((account) => {
    if (localStorage.getItem("suite.accounts.v1") === null)
      localStorage.setItem(
        "suite.accounts.v1",
        JSON.stringify({ activeId: account.id, accounts: [account] }),
      );
  }, demoAccount);
});

test("skipping lands on the start page and onboarding is never shown again", async ({
  page,
}, info) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This is your pod");
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  const diagram = page.getByRole("figure");
  await expect(diagram).toContainText("Alice Wilder");
  await expect(diagram).toContainText("alice.demo.pod");
  await expect(page.getByText("Your data lives here.")).toBeVisible();
  await expect(page.getByText("Apps ask you first.")).toBeVisible();
  await expect(page.getByText("You stay in charge.")).toBeVisible();
  await capture(page, "onboarding-pod", info.project.name);
  await skip(page).click();
  await expect(page).toHaveURL(START);
  expect(await onboardingState(page)).toBe("skipped");
  await page.reload();
  await expect(page).toHaveURL(START);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(START);
  await page.reload();
  await expect(page).toHaveURL(START);
});

test("every step keeps Skip, and the theme follows the appearance preference", async ({
  page,
}, info) => {
  await page.goto("/onboarding");
  await expect(skip(page)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make it yours");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(skip(page)).toBeVisible();
  await expect(page.getByText("Alice Wilder")).toBeVisible();
  // The demo account cannot write its profile, so there is no photo upload.
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await capture(page, "onboarding-yours", info.project.name);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This is your pod");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bring your data");
  await expect(skip(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Connect a service/ })).toHaveAttribute(
    "href",
    "/connect",
  );
  await expect(page.getByRole("link", { name: /^Import files/ })).toHaveAttribute(
    "href",
    "/drive/my",
  );
  await expect(page.getByRole("link", { name: /^Start fresh/ })).toHaveAttribute("href", "/home");
  await capture(page, "onboarding-data", info.project.name);
  await page.getByRole("link", { name: /^Import files/ }).click();
  await expect(page).toHaveURL(/\/drive\/my$/);
  expect(await onboardingState(page)).toBe("complete");
  const theme = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}").theme,
    PREFS_KEY,
  );
  expect(theme).toBe("dark");
  await page.goto("/onboarding");
  await expect(page).toHaveURL(START);
});

test("onboarding works with the keyboard alone", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This is your pod");
  await tabTo(page, page.getByRole("button", { name: "Next" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Make it yours" })).toBeFocused();
  const system = page.getByRole("radio", { name: "System" });
  await tabTo(page, system);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Next" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Bring your data" })).toBeFocused();
  await accessible(page);
  await tabTo(page, page.getByRole("link", { name: /^Start fresh/ }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(START);
  expect(await onboardingState(page)).toBe("complete");
});

test("onboarding needs a signed-in account", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("suite.accounts.v1", "{}"));
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/signin\?next=%2Fonboarding$/);
  await accessible(page);
});
