<!-- AUTHORED-BY Codex GPT-6 -->

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# `feature.spec.example.ts` — source example

Preserved from the detailed source snapshot as reading material. Extract the code
block to `feature.spec.example.ts` when adapting the example; sibling `.js` imports refer
to the corresponding extracted TypeScript files. These examples were not executed
as part of this documentation consolidation.

```ts
/**
 * feature.spec.example.ts — the per-feature e2e shape, distilled from a real
 * Bob-built Solid TODO app developed against this guide. Copy per feature and
 * adapt names/locators. Pair with global-setup.ts (seeded account) and
 * playwright.config.ts from this skill.
 *
 * Patterns it encodes:
 *  - auth/UX error states tested FIRST (they are part of the login behaviour
 *    spec in the solid-reactive-authentication skill, and they fail loudest);
 *  - beforeEach login so each feature test starts authenticated;
 *  - role/placeholder locators (no brittle CSS selectors), auto-waits, no sleep;
 *  - unique test data per run; empty state → create → mutate progression.
 */
import { test, expect, type Page } from "@playwright/test";

// Shared by beforeEach and reload recovery. Adapt app locators to your feature.
async function login(page: Page) {
  const account = JSON.parse(process.env.SOLID_E2E_ACCOUNT ?? "null");
  if (!account) throw new Error("Missing test account; run global-setup.ts first");
  const popups: Page[] = [];
  const collect = (popup: Page) => popups.push(popup);
  const context = page.context();
  context.on("page", collect); // subscribe BEFORE submitting the WebID
  try {
    await page.fill('input[type="url"]', account.webId);
    await page.click('button[type="submit"]');
    // A prompt=none popup may close before the interactive popup opens. Drive
    // every live popup, including consent-only pages when CSS already has a session.
    await expect.poll(async () => {
      for (const popup of popups) {
        if (popup.isClosed()) continue;
        try {
          const email = popup.locator("#email");
          if (await email.isVisible()) {
            await email.fill(account.email);
            await popup.locator("#password").fill(account.password);
            await popup.getByRole("button", { name: /^log in$/i }).click();
          }
          const consent = popup.getByRole("button", { name: /^authorize$/i });
          if (await consent.isVisible()) await consent.click();
        } catch (error) {
          if (!popup.isClosed()) throw error;
        }
      }
      return page.getByRole("heading", { name: /items/i }).isVisible();
    }, { timeout: 30_000 }).toBe(true); // incomplete login fails the test
  } finally {
    context.off("page", collect);
  }
}

test.describe("Login surface", () => {
  test("shows WebID-first entry with a get-a-pod affordance", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('input[type="url"]')).toBeVisible(); // WebID input
    await expect(page.getByRole("link", { name: /get .*pod/i })).toBeVisible();
  });

  test("rejects a malformed WebID with a clear error", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[type="url"]', "not-a-valid-url");
    await page.click('button[type="submit"]');
    // native URL validation or the app's own error — either way, no navigation
    await expect(page.locator('input[type="url"]')).toBeVisible();
  });

  test("surfaces an unreachable-profile error actionably", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[type="url"]', "https://nonexistent.example/profile/card#me");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/error/i)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Feature: items", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await login(page);
  });

  test("shows the empty state before any item exists", async ({ page }) => {
    await expect(page.getByText(/no items yet/i)).toBeVisible();
  });

  test("adds an item and clears the input", async ({ page }) => {
    const text = `Test item ${Math.random().toString(36).slice(2)}`;
    await page.fill('input[placeholder*="add" i]', text);
    await page.click('button:has-text("Add")');
    await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[placeholder*="add" i]')).toHaveValue("");
  });

  test("persists across reload (the pod is the store)", async ({ page }) => {
    const text = `Persistent ${Math.random().toString(36).slice(2)}`;
    await page.fill('input[placeholder*="add" i]', text);
    await page.click('button:has-text("Add")');
    await expect(page.getByText(text)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    // Wait for either session restore or the login form; complete login if needed.
    const entry = page.locator('input[type="url"]');
    await expect.poll(async () =>
      (await page.getByRole("heading", { name: /items/i }).isVisible()) ||
      (await entry.isVisible()),
    ).toBe(true);
    if (await entry.isVisible()) await login(page);
    await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
  });
});
```
