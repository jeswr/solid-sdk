// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** Real local-CSS popup login, meal/symptom writes and persisted reload. */
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

/** The shared WebID form opens the audited authorization element's popup. */
async function login(page: Page, creds: Auth): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Coeliac Diary" })).toBeVisible();
  await page.getByRole("textbox", { name: "WebID", exact: true }).fill(creds.webId);
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const popup = await opened;
  await popup.locator("#email").fill(creds.email);
  await popup.locator("#password").fill(creds.password);
  await popup.getByRole("button", { name: /log in/i }).click();
  const authorize = popup.getByRole("button", { name: /authorize|consent|allow/i });
  if (!popup.isClosed()) {
    await Promise.race([
      popup.waitForEvent("close"),
      authorize.waitFor({ state: "visible" }).then(() => authorize.click()),
    ]);
  }
  await expect(page.getByRole("link", { name: "Log food" })).toBeVisible();
}

test("log a meal + symptom and persist across reload", async ({ page }) => {
  const creds = auth();
  await login(page, creds);

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
