import { expect, type BrowserContext, type Page } from "@playwright/test";

export const CSS_BASE = process.env.IT_CSS_BASE ?? "http://localhost:3000";

/**
 * Drive the CSS login (and consent, if shown) inside the interactive popup. The
 * interactive popup lands on /.account/ then client-redirects to the password
 * form, so we wait for #email; after login CSS may show a consent screen. The
 * transient prompt=none popup has no form and closes itself (swallowed).
 */
export function handleLoginPopups(context: BrowserContext, email: string, password: string): void {
  const seen = (locator: ReturnType<Page["locator"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);

  context.on("page", async (popup: Page) => {
    try {
      const field = popup.locator("#email");
      if (await seen(field, 10_000)) {
        await field.fill(email);
        await popup.locator("#password").fill(password);
        await popup.getByRole("button", { name: /^log in$/i }).click();
      }
      const consent = popup.getByRole("button", { name: /authorize|consent|allow|continue/i });
      if (await seen(consent, 10_000)) await consent.click();
    } catch {
      /* transient prompt=none popup */
    }
  });
}

/** Sign in via the WebID-first login screen; resolves once the issues view is shown. */
export async function signIn(page: Page, webId: string) {
  await page.goto("/");
  await page.getByLabel(/your webid/i).fill(webId);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: /open tracker/i })).toBeVisible({ timeout: 30_000 });
}

/** Dismiss any visible sonner toasts — they overlay bottom-right controls. */
export async function dismissToasts(page: Page) {
  for (const btn of await page.getByLabel(/close toast/i).all()) {
    await btn.click().catch(() => {});
  }
  await page.waitForTimeout(150);
}
