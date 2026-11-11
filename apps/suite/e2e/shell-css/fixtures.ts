// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

export type AccountName = "alice" | "bob";
type SignInOptions = { method?: "provider" | "webid"; keyboardOnly?: boolean };

export function cssAccount(name: AccountName) {
  const port = process.env.SUITE_CSS_PORT;
  if (!port) throw new Error("Run shell-css with playwright.css.config.ts");
  const issuer = `http://localhost:${port}/`;
  return {
    issuer,
    webId: `${issuer}${name}/profile/card#me`,
    email: `${name}@example.com`,
    password: "shell-css-password-123!",
    name: name === "alice" ? "Alice" : "Bob",
  };
}

export async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical"),
  ).toEqual([]);
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

/** Traverse the real tab order, including in the CSS login form. */
export async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 40; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function activate(page: Page, target: Locator, keyboardOnly: boolean) {
  if (keyboardOnly) {
    await tabTo(page, target);
    await page.keyboard.press("Enter");
  } else await target.click();
}

async function typeInto(page: Page, target: Locator, value: string, keyboardOnly: boolean) {
  if (keyboardOnly) {
    await tabTo(page, target);
    await page.keyboard.type(value);
  } else await target.fill(value);
}

/** Interactive OIDC only: never inject a demo account, stub OAuth, or bypass issuer checks. */
export async function signIn(page: Page, name: AccountName, options: SignInOptions = {}) {
  const account = cssAccount(name);
  const keyboardOnly = options.keyboardOnly ?? false;
  await page.goto("/signin");
  await accessible(page);
  const submit = async () => {
    if (options.method === "webid") {
      await typeInto(
        page,
        page.getByRole("textbox", { name: "WebID", exact: true }),
        account.webId,
        keyboardOnly,
      );
      await activate(
        page,
        page.getByRole("button", { name: "Continue", exact: true }),
        keyboardOnly,
      );
    } else {
      // The configured provider list requires HTTPS. Use its real Other provider button
      // for this disposable HTTP issuer, without relaxing the production env schema.
      await activate(
        page,
        page.getByRole("button", { name: "Other provider", exact: true }),
        keyboardOnly,
      );
      await typeInto(
        page,
        page.getByRole("combobox", { name: "Provider address" }),
        account.issuer,
        keyboardOnly,
      );
      await page.keyboard.press("Enter");
    }
  };
  const waitForForm = async (candidate: Page) => {
    await candidate.waitForURL((url) => url.origin === new URL(account.issuer).origin);
    await candidate.locator("#email").waitFor({ state: "visible" });
    return candidate;
  };
  // Accept full-page auth or an interactive popup. Ignore silent prompt=none popups
  // that close before a login form appears. Surface app errors instead of hiding a timeout.
  const form = Promise.race([
    waitForForm(page),
    page.context().waitForEvent("page", {
      predicate: async (popup) => {
        try {
          await waitForForm(popup);
          return true;
        } catch {
          return false;
        }
      },
    }),
    page
      .getByRole("alert")
      .filter({ hasText: /\S/ })
      .waitFor({ state: "visible" })
      .then(async () => {
        throw new Error(
          `CSS sign-in stopped in the suite before the CSS login form: ${await page.getByRole("alert").filter({ hasText: /\S/ }).innerText()}`,
        );
      }),
  ]);
  const [login] = await Promise.all([form, submit()]);
  // Observe the actual provider redirect, including for popups that close immediately
  // after posting their callback. Do not replace it with injected shell/session state.
  const appOrigin = new URL(page.url()).origin;
  const callback = login.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.isNavigationRequest() &&
      url.origin === appOrigin &&
      url.pathname === "/auth/callback.html"
    );
  });
  await typeInto(login, login.locator("#email"), account.email, keyboardOnly);
  await typeInto(login, login.locator("#password"), account.password, keyboardOnly);
  await activate(login, login.getByRole("button", { name: "Log in", exact: true }), keyboardOnly);
  const authorize = login.getByRole("button", { name: "Authorize", exact: true });
  const needsConsent = await Promise.race([
    authorize.waitFor({ state: "visible" }).then(() => true),
    page.waitForURL(/\/home\/?$/).then(() => false),
  ]);
  if (needsConsent) await activate(login, authorize, keyboardOnly);
  const returned = new URL((await callback).url());
  expect(returned.searchParams.has("code")).toBe(true);
  expect(returned.searchParams.has("state")).toBe(true);
  await expect(page).toHaveURL(/\/home\/?$/);
  await expect(
    page
      .getByRole("button", { name: `Account: ${account.name}`, exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
}

export const signedOutTest = base;

// Playwright's JSON storage state cannot round-trip the non-extractable CryptoKeys in
// pod-auth's IndexedDB. Sign in in each test's own context; reloads retain the real keys.
export const test = base.extend<{ account: AccountName }>({
  account: ["alice", { option: true }],
  page: async ({ page, account }, use) => {
    await signIn(page, account);
    await use(page);
  },
});

export { expect };
