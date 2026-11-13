// AUTHORED-BY Claude Opus 5.5
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Mirrors src/shell/lib/registration-fixture.ts: the dev-fixture build's stand-in for
// SUITE_TEST_CAPS={"selfRegistration":true}, so one server can test both states.
const FIXTURE_KEY = "suite.test.registration.v1";

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
async function offerRegistration(page: Page, failOnce: string[] = []) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: FIXTURE_KEY,
    value: JSON.stringify({ available: true, failOnce }),
  });
}
/** Press Tab until `target` has focus: a keyboard-only user's path through the page. */
async function tabTo(page: Page, target: Locator, limit = 30) {
  for (let step = 0; step < limit; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
// Next's route announcer is also role="alert" and gains text after a client navigation.
const alert = (page: Page) =>
  page
    .getByRole("alert")
    .filter({ hasText: /\S/ })
    .and(page.locator(":not(#__next-route-announcer__)"));

test("signup is hidden and redirects to sign-in when registration is off", async ({ page }) => {
  await page.goto("/welcome");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toHaveCount(0);
  await page.goto("/signin");
  await expect(page.getByRole("textbox", { name: "WebID", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/signin\?signup=unavailable$/);
  await expect(
    page.getByRole("status").filter({
      hasText: "Account creation isn't offered here yet — sign in with an existing account.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
  await accessible(page);
});

test("signup creates an account, retries a failed step and reaches onboarding", async ({
  page,
}, info) => {
  await offerRegistration(page, ["account-id"]);
  await page.goto("/welcome");
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account");
  await expect(page.getByText("no real account is created")).toBeVisible();
  await capture(page, "signup", info.project.name);

  const username = page.getByRole("textbox", { name: "Username" });
  const status = page.locator("#signup-username-status");
  const rules = page.getByRole("list", { name: "Username rules" });
  await expect(rules.getByRole("listitem")).toHaveText([
    "3–30 characters (not met yet)",
    "Lowercase letters, numbers and hyphens only (not met yet)",
    "Starts and ends with a letter or number (not met yet)",
  ]);
  await username.fill("Sam");
  await expect(status).toHaveText("Use only lowercase letters, numbers and hyphens.");
  await expect(rules.getByRole("listitem")).toHaveText([
    "3–30 characters (met)",
    "Lowercase letters, numbers and hyphens only (not met yet)",
    "Starts and ends with a letter or number (not met yet)",
  ]);
  await accessible(page);
  await username.fill("sam-");
  await expect(status).toHaveText("Start and end with a letter or number.");
  await username.fill("alice");
  await expect(status).toHaveText("alice is taken. Try another username.");
  await accessible(page);
  await username.fill("sam-river");
  await expect(status).toHaveText("sam-river is available.");
  await expect(
    page.getByText("Your pod will be at https://sam-river.demo.example.org/"),
  ).toBeVisible();
  await expect(
    page.getByText("Your account ID: https://sam-river.demo.example.org/profile/card#me"),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Display name" })).toHaveValue("Sam River");
  // The demo provider offers no passkeys, so there is no method choice.
  await expect(page.getByRole("radio")).toHaveCount(0);
  await capture(page, "signup-available", info.project.name);

  // Submitting with gaps explains each one and focuses the first.
  const create = page.getByRole("button", { name: "Create my account" });
  await create.click();
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page.getByText("Confirm you've read how your data is stored.")).toBeVisible();
  await accessible(page);

  await password.fill("short");
  await expect(page.getByText("Password strength: Too short")).toBeVisible();
  await password.fill("correct horse battery staple");
  await expect(page.getByText("Password strength: Strong")).toBeVisible();
  const reveal = page.getByRole("button", { name: "Show password" });
  await reveal.click();
  await expect(reveal).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("link", { name: "how my data is stored" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  await page.getByRole("checkbox", { name: "I've read how my data is stored" }).check();
  await create.click();

  const panel = page.getByRole("region", { name: "Setting up your account" });
  await expect(alert(page)).toHaveText("We couldn't create your account ID. Please try again.");
  await expect(panel.getByRole("listitem")).toHaveText([
    "Creating your pod: Done",
    "Creating your account ID: Didn't finish",
    "Signing you in: Not started",
  ]);
  const retry = panel.getByRole("button", { name: "Retry" });
  await expect(retry).toBeFocused();
  // Only a pod failure offers going back to change the username.
  await expect(panel.getByRole("button", { name: "Change my details" })).toHaveCount(0);
  await capture(page, "signup-retry", info.project.name);
  await retry.click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This is your pod");
  await accessible(page);
});

test("a pod failure can go back to the form with the details kept", async ({ page }) => {
  await offerRegistration(page, ["pod"]);
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Username" }).fill("rowan-vale");
  await expect(page.locator("#signup-username-status")).toHaveText("rowan-vale is available.");
  await page.getByLabel("Password", { exact: true }).fill("a quiet orchard at dusk");
  await page.getByRole("checkbox", { name: "I've read how my data is stored" }).check();
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(alert(page)).toHaveText("We couldn't create your pod. Please try again.");
  await accessible(page);
  await page.getByRole("button", { name: "Change my details" }).click();
  const username = page.getByRole("textbox", { name: "Username" });
  await expect(username).toBeFocused();
  await expect(username).toHaveValue("rowan-vale");
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("signup works with the keyboard alone", async ({ page }) => {
  await offerRegistration(page);
  await page.goto("/signin");
  const create = page.getByRole("link", { name: "Create an account" });
  await tabTo(page, create);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/signup$/);
  const username = page.getByRole("textbox", { name: "Username" });
  await tabTo(page, username);
  await page.keyboard.type("kit-moss");
  await expect(page.locator("#signup-username-status")).toHaveText("kit-moss is available.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Display name" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Kit Moss");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.type("lantern meadow pebble rain");
  const consent = page.getByRole("checkbox", { name: "I've read how my data is stored" });
  await tabTo(page, consent);
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Create my account" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/onboarding$/);
  await accessible(page);
});

test("the privacy page explains storage in plain language", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How your data is stored");
  await expect(page.getByRole("heading", { name: "Who can see it" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/WebID|LDP|ACL/u);
  await accessible(page);
});
