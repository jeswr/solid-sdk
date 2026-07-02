// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// EXTENSION↔APP integration (bead suite-tracker-lpo). Proves, against a LOCAL CSS, that Pod
// Drive works with the @jeswr Solid browser extension INSTALLED, and that the app hides its own
// duplicate account chrome when the extension is present.
//
// WHAT THIS ACTUALLY EXERCISES (no mocks — a real built extension in a real Chromium):
//   1. the MV3 extension loads into a persistent context (--load-extension) and its MAIN-world
//      inject reaches the APP's own origin — window.solid is defined + the sticky presence
//      marker <html data-solid-extension="1"> is set on the app page (so the app's
//      useExtensionPresent hook fires); the app renders with NO console / page errors (the
//      extension's global-fetch patch does not break the app's boot);
//   2. the extension's fetch-routing is TRANSPARENT: a cross-origin read from the app origin to
//      the local CSS still returns the real response (an installed extension does not break the
//      app's own network reads / OIDC discovery).
//
// The logged-in "hide the app's own <AccountMenu/>" assertion is proven at the UNIT level
// (src/useExtensionPresent.test.tsx + App.tsx) rather than here — reaching pod-drive's logged-in
// header needs its OWN window.open OIDC popup, which does not open inside the persistent context
// an MV3 extension requires (isolation-verified as a Playwright/Chromium limitation, NOT the
// extension; see the test.fixme below). That path lands with the bead's "app consumes the
// extension's identity" follow-up.
//
// The built extension dist is located via POD_APP_EXTENSION_DIST or the default sibling checkout;
// absent → the whole suite SKIPS with a clear reason (never a false failure).
//
// LOCAL-ONLY: the app (vite:5173) + CSS (:3000) are the playwright.config webServers. NEVER the
// live deploy.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";

const APP_URL = "http://localhost:5173";

/** Resolve the built extension `dist/`. Env override, else the default sibling checkout. */
function extensionDist(): string | null {
  const fromEnv = process.env.POD_APP_EXTENSION_DIST;
  const candidates = [
    fromEnv,
    // Default sibling layout: <root>/pod-drive/web/tests/extension → <root>/solid-browser-extension/dist
    fileURLToPath(new URL("../../../../solid-browser-extension/dist", import.meta.url)),
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) {
    if (existsSync(`${c}/manifest.json`)) return c;
  }
  return null;
}

interface Seeded {
  webId: string;
  email: string;
  password: string;
  podRoot: string;
  manyChildCount: number;
}

function readSeeded(): Seeded {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL("../e2e/.seeded-account.json", import.meta.url)), "utf8"),
  );
}

/** Console-error / pageerror noise we tolerate — genuinely-benign, unrelated to the app or the
 * extension integration (documented so a REAL error is never silently swallowed). Checks both the
 * message text AND (for a resource-load error) the source URL, since the generic browser
 * "Failed to load resource … 404" message carries the URL only in its console location. */
function isBenign(text: string, sourceUrl = ""): boolean {
  return (
    /favicon\.ico/i.test(text) || // the vite dev host serves no favicon (a chrome-issued request)
    /favicon\.ico/i.test(sourceUrl) ||
    /Lit is in dev mode/i.test(text) // solid-elements Lit dev-mode advisory (a warning, not a bug)
  );
}

const DIST = extensionDist();

test.describe("extension ↔ Pod Drive integration", () => {
  test.skip(
    !DIST,
    "Built extension dist not found. Build solid-browser-extension (npm run build) and set " +
      "POD_APP_EXTENSION_DIST=/abs/path/to/solid-browser-extension/dist, or check it out as a " +
      "sibling of pod-drive.",
  );

  let context: BrowserContext;
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    // A persistent context is REQUIRED to host an MV3 extension. headless:true works with the
    // full `chromium` channel (verified on this box); POD_APP_EXTENSION_HEADED=1 runs headed (the
    // extension's own e2e likewise runs headed). Both load the extension identically.
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: !process.env.POD_APP_EXTENSION_HEADED,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    // Confirm the extension's service worker registered (else the persistent context did not
    // actually load it — fail loudly rather than pass a vacuous test).
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    expect(sw.url()).toContain("chrome-extension://");

    page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !isBenign(m.text(), m.location()?.url ?? ""))
        consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (!isBenign(e.message)) consoleErrors.push(`pageerror: ${e.message}`);
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("the extension injects window.solid + the presence marker into the app page", async () => {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    // The MAIN-world inject runs at document_start via the manifest content script, so it is
    // present without waking the SW. Poll briefly for robustness across the navigation.
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            hasSolid: typeof (window as { solid?: unknown }).solid !== "undefined",
            marker: document.documentElement.getAttribute("data-solid-extension"),
          })),
        { timeout: 15_000 },
      )
      .toEqual({ hasSolid: true, marker: "1" });

    // The logged-out app shows its login screen (no gesture yet) and NO error output.
    await expect(page.locator("#webid-input")).toBeVisible({ timeout: 15_000 });
    expect(consoleErrors, `unexpected console/page errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test("the extension's fetch-routing is TRANSPARENT — the app's cross-origin reads still work", async () => {
    // The extension patches the page's global fetch to route pod requests through its SW. This
    // proves that routing does NOT break the app's normal network: a cross-origin request from
    // the APP origin (:5173) to the local CSS (:3000, a different origin the extension does NOT
    // hold a grant for) is native-passed-through and returns the real response — so an installed
    // extension does not break an app that fetches its own resources / does OIDC discovery.
    // Establish this test's own page state (do not depend on a prior test's navigation, so a
    // filtered / solo run still evaluates from the app origin, not about:blank).
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    const discovery = await page.evaluate(async () => {
      const r = await fetch("http://localhost:3000/.well-known/openid-configuration");
      return { status: r.status, bodyLen: (await r.text()).length };
    });
    expect(discovery.status).toBe(200);
    expect(discovery.bodyLen).toBeGreaterThan(0);
    expect(consoleErrors, `unexpected console/page errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  // The logged-in header behaviour — the app drops its own <AccountMenu/> profile display but
  // keeps a Sign-out control when the extension is present — is proven deterministically at the
  // unit level (src/App.header.test.tsx + src/useExtensionPresent.test.tsx). It is NOT driven
  // here because reaching pod-drive's logged-in header requires its OWN OIDC window.open popup,
  // which does NOT open inside the persistent browser context that loading an MV3 extension
  // REQUIRES — a Playwright/Chromium limitation, NOT the extension (isolation-verified: the same
  // login popup fails to open in a persistent context even with NO extension loaded, while it
  // completes in the normal-context suite tests/e2e/auth-401-budget.spec.ts). The full
  // "app consumes the extension's identity so it needs no popup of its own" path is the bead's
  // follow-up ("apps skip own login when extension present"); once wired, this test can drive
  // login through the extension popup (which DOES work in a persistent context) instead.
  test.fixme("logged in: the app drops its AccountMenu but keeps Sign-out (extension present)", async () => {
    const seeded = readSeeded();
    const loggedIn = await login(page, seeded);
    expect(loggedIn).toBe(true);
    await expect(page.locator(".pod-drive-browser")).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^sign out$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /feedback/i })).toBeVisible();
    expect(consoleErrors, `unexpected console/page errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });
});

/** Drive the app's WebID-first OIDC popup login against the local CSS. Returns true once the
 * file browser is on screen. Adapted from tests/e2e/auth-401-budget.spec.ts (same known
 * headless-popup flakiness handling). */
async function login(page: Page, seeded: Seeded): Promise<boolean> {
  const webIdInput = page.locator("#webid-input");
  await expect(webIdInput).toBeVisible();
  await webIdInput.fill(seeded.webId);

  const popups: Page[] = [];
  page.context().on("page", (p) => popups.push(p));
  await page.getByRole("button", { name: /log in/i }).click();

  const openWindowBtn = page.getByRole("button", { name: /open new window/i });
  let loginPopup: Page | undefined;
  try {
    await expect
      .poll(
        async () => {
          if (await openWindowBtn.isVisible().catch(() => false)) {
            await openWindowBtn.click().catch(() => {});
          }
          for (const p of popups) {
            if (p.isClosed()) continue;
            if (
              (await p
                .locator("#email")
                .count()
                .catch(() => 0)) > 0
            ) {
              loginPopup = p;
              return true;
            }
          }
          return false;
        },
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
  } catch {
    return false;
  }
  if (!loginPopup) return false;

  await loginPopup.locator("#email").fill(seeded.email);
  await loginPopup.locator("#password").fill(seeded.password);
  await loginPopup.getByRole("button", { name: /log ?in/i }).click();
  const authorize = loginPopup.getByRole("button", { name: /authorize|consent|continue/i });
  try {
    await authorize.click({ timeout: 15_000 });
  } catch {
    // auto-consented / already authorized.
  }

  await expect(page.locator(".pod-drive-browser")).toBeVisible({ timeout: 60_000 });
  return true;
}
