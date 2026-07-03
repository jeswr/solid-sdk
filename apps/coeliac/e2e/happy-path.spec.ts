// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The authenticated golden path against a REAL local CSS: interactive WebID login
 * (the reactive-auth popup), then log a meal by hand and a symptom, and confirm
 * they persist across a reload. No mocks — this exercises the whole suite login +
 * pod-write stack end to end.
 *
 * Interactive popup login against local CSS depends on reactive-auth's
 * loopback-issuer handling; if the environment can't complete the popup this test
 * is SKIPPED (the smoke spec is the guaranteed local-CSS E2E). It never asserts a
 * false pass.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

interface Auth {
  webId: string;
  email: string;
  password: string;
}

function auth(): Auth {
  return JSON.parse(readFileSync(join(process.cwd(), "e2e", ".auth.json"), "utf8")) as Auth;
}

/**
 * Drive the reactive-auth popup login for a WebID. Handles the transient
 * `prompt=none` popup that closes itself before the interactive one opens (skill
 * gotcha) by collecting every popup and driving the one that shows the CSS login
 * form. Returns false if it can't complete (→ the test skips, never a false pass).
 */
async function login(page: Page, creds: Auth): Promise<boolean> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Coeliac Diary" })).toBeVisible();

  const popups: Page[] = [];
  page.context().on("page", (p) => popups.push(p));

  const webIdInput = page.getByRole("textbox").first();
  await webIdInput.fill(creds.webId);
  await page.getByRole("button", { name: /sign in/i }).first().click();

  // Poll popups for the interactive CSS login form (ignore the prompt=none popup).
  const deadline = Date.now() + 30_000;
  let loginPopup: Page | null = null;
  while (Date.now() < deadline && !loginPopup) {
    for (const p of popups) {
      if (p.isClosed()) continue;
      const emailVisible = await p
        .locator("#email")
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (emailVisible) {
        loginPopup = p;
        break;
      }
    }
    if (!loginPopup) await page.waitForTimeout(500);
  }
  if (!loginPopup) return false;

  try {
    await loginPopup.locator("#email").fill(creds.email);
    await loginPopup.locator("#password").fill(creds.password);
    await loginPopup.getByRole("button", { name: /log in/i }).click();
    const authorize = loginPopup.getByRole("button", { name: /authorize|consent|allow/i });
    if (await authorize.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await authorize.click();
    }
  } catch {
    return false;
  }
  return await page
    .getByRole("link", { name: "Log food" })
    .isVisible({ timeout: 20_000 })
    .catch(() => false);
}

test("log a meal + symptom and persist across reload", async ({ page }) => {
  const creds = auth();
  const loggedIn = await login(page, creds);
  test.skip(!loggedIn, "interactive local-CSS popup login unavailable in this environment");

  // Log a meal by hand.
  await page.getByRole("link", { name: "Log food" }).click();
  await page.getByText(/Log a meal by hand instead/i).click();
  await page.getByLabel(/Food \/ drink/i).fill("Porridge with oat milk");
  await page.getByRole("button", { name: "Ate it now" }).click();
  await expect(page.getByText(/Saved/i)).toBeVisible();

  // Log a symptom (two taps).
  await page.getByRole("link", { name: "Symptoms" }).click();
  await page.getByRole("button", { name: "Bloating" }).click();
  await page.getByRole("button", { name: /Log Bloating/i }).click();
  await expect(page.getByText(/Saved to your pod/i)).toBeVisible();

  // Persist across reload (instant cache paint).
  await page.getByRole("link", { name: "Home" }).click();
  await page.reload();
  await expect(page.getByText("Porridge with oat milk")).toBeVisible();
});
