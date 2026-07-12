// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// 401-BUDGET e2e (task #123) — proves the @jeswr/solid-elements PROACTIVE auth-fetch
// (which REPLACED the raw ReactiveFetchManager in SessionProvider) eliminates the
// per-resource "401-dance". Under the old reactive manager EVERY pod request went out
// UNAUTHENTICATED first and only attached the DPoP token on the 401 it provoked — per
// resource, no cache — so each distinct pod document paid a wasted 401 → upgrade → retry.
// The proactive patch attaches the token UP FRONT for an allowed origin, so the pod
// resource server (the CSS at :3000) should see AT MOST one bootstrapping 401 per
// storage root and NEVER a count that scales with the records size.
//
// REGRESSION SURFACE — pod-health loads the records by reading a DISCOVERY CHAIN of
// SEVERAL DISTINCT pod documents on load: the WebID profile, the Type-Index probe
// (`discoverHealthResource` reads the profile's publicTypeIndex/privateTypeIndex
// pointers + each index document), then the health RECORD DOCUMENT
// (`health/record.ttl`, via useHealthRecords → readHealth → listHealthEntries). Each
// health:Observation in that document renders a row; the OBSERVATION COUNT is the
// regression surface — under the old reactive manager the documents read on load each
// paid their own 401, but the proactive patch keeps the resource-server 401 count FLAT
// (≤1 per storage root), never scaling with the records.
//
// LOCAL-ONLY: runs against a LOCAL CSS (the playwright.config webServer), seeded by
// global-setup. NEVER the live deploy.
//
// METHOD:
//   • Intercept every RESPONSE; tally the 401s whose URL is on a POD STORAGE ROOT
//     (the resource server) — NOT the OIDC issuer endpoints (a `prompt=none` silent
//     login probe legitimately 401s at the .oidc layer; that is auth bootstrap, not the
//     resource-read dance this test guards).
//   • Drive the REAL OIDC popup login once (the proactive patch is wired by the live
//     SessionProvider — we exercise the production path, not a stub).
//   • Wait for the records to render their N rows (login lands on the records view) and
//     assert the resource-server 401 count is bounded and does NOT scale with the
//     observation count.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

interface Seeded {
  base: string;
  webId: string;
  email: string;
  password: string;
  podRoot: string;
  recordDoc: string;
  observationCount: number;
}

/** Read the facts global-setup seeded. Deferred to TEST time (not module load) so the
 * spec can be `--list`ed / loaded before global-setup writes the sidecar. */
function readSeeded(): Seeded {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL("./.seeded-account.json", import.meta.url)), "utf8"),
  );
}

/** A 401 we COUNT against the budget: a resource-server 401 on a pod storage root. We
 * EXCLUDE the OIDC issuer endpoints (`/.oidc/…`) — a `prompt=none` silent-login probe
 * 401ing there is auth bootstrap, not the per-resource read dance under test. */
function isResourceServer401(url: string, storageRoots: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!storageRoots.includes(u.origin)) return false;
  // Exclude the OIDC + account-management endpoints (not resource reads).
  if (u.pathname.startsWith("/.oidc") || u.pathname.startsWith("/.account")) return false;
  return true;
}

/** Drive the WebID-first popup login. Returns once the records view is on screen.
 *
 * The <authorization-code-flow> element's getCode() calls window.open DIRECTLY; the
 * popup opens as a page event (NO extra click) when the browser allows it (a user-gesture
 * click chain does). Its dialog with an "Open new window" button is shown ONLY as a
 * FALLBACK when window.open is blocked — so we wait for the popup, and click that button
 * only if it appears. A transient `prompt=none` SILENT popup may open + close itself
 * first, so we collect every popup and poll for the one that lands on the CSS `#email`. */
async function login(page: Page, seeded: Seeded): Promise<boolean> {
  await page.goto("/");
  // The login form is WebID-first: one input + "Log in".
  const webIdInput = page.locator("#webid-input");
  await expect(webIdInput).toBeVisible();
  await webIdInput.fill(seeded.webId);

  // Collect popups from the moment we click (a listener registered up front never misses
  // a fast-opening popup the way a post-hoc waitForEvent can). The handler is NAMED + removed
  // in the finally below (roborev LOW): an un-removed `context.on("page")` would survive this
  // call and observe unrelated pages if more specs share the worker/context later.
  const popups: Page[] = [];
  const onPage = (p: Page) => popups.push(p);
  page.context().on("page", onPage);
  try {
    await page.getByRole("button", { name: /log in/i }).click();

    // HEADLESS POPUP FLAKINESS (documented): @solid/reactive-authentication's getCode →
    // window.open flow (with a `prompt=none` silent-first attempt) does not reliably open
    // its popup under headless Chromium in a constrained worktree. We wait for a popup that
    // lands on the CSS `#email` form; if a window.open-blocked FALLBACK dialog appears
    // instead, click its "Open new window" button. If NEITHER materialises in the budget we
    // return false → the caller fails-closed (skips only under the explicit opt-in, else
    // FAILS) so a genuine regression — e.g. the custom element not registering — is never
    // masked. The proactive-fetch behaviour itself is exhaustively covered by
    // @jeswr/solid-elements' own unit tests + this repo's webid-token-provider re-entrancy
    // guard test.
    const openWindowBtn = page.getByRole("button", { name: /open new window/i });
    let loginPopup: Page | undefined;
    try {
      await expect
        .poll(
          async () => {
            // If window.open was blocked, the element shows a fallback dialog — click it.
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
          { timeout: 60_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);
    } catch {
      return false;
    }
    if (!loginPopup) return false;

    // CSS login: #email / #password → "Log in", then "Authorize" on consent.
    await loginPopup.locator("#email").fill(seeded.email);
    await loginPopup.locator("#password").fill(seeded.password);
    await loginPopup.getByRole("button", { name: /log ?in/i }).click();
    // Consent screen (first authorization) — click Authorize if present (it may auto-consent).
    const authorize = loginPopup.getByRole("button", { name: /authorize|consent|continue/i });
    try {
      await authorize.click({ timeout: 15_000 });
    } catch {
      // Already authorized / auto-consented — the popup closes on its own.
    }

    // Back on the app: the logged-in shell (+ records section) appears once logged in.
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 60_000 });
    return true;
  } finally {
    // Always detach the popup listener — no stale handler survives this call.
    page.context().off("page", onPage);
  }
}

test.describe("401-budget — the proactive auth-fetch eliminates the 401-dance", () => {
  test("a session loads the health records paying ≤1 resource-server 401 per storage root", async ({
    page,
  }) => {
    const seeded = readSeeded();
    // The pod storage roots a session's token may legitimately ride to. For this
    // single-pod seed there is exactly ONE (the pod root's origin). The budget is keyed
    // to this count.
    const storageRoots = [new URL(seeded.podRoot).origin];

    // Tally resource-server 401s across the WHOLE browser context — the main page AND
    // every popup the auth flow opens (roborev MEDIUM): the resource-read dance under test
    // runs in the main page (the app data layer), but listening at the CONTEXT level (not
    // just `page`) means a regression that hit a pod resource unauthenticated from the
    // popup/auth flow is also counted, so the budget can't pass while missing part of the
    // behaviour it guards. `context.on("response")` fires for every page in the context,
    // existing and future (popups included), so no per-popup wiring is needed.
    const resource401s: string[] = [];
    page.context().on("response", (res) => {
      if (res.status() === 401 && isResourceServer401(res.url(), storageRoots)) {
        resource401s.push(res.url());
      }
    });

    const loggedIn = await login(page, seeded);
    // FAIL-CLOSED on a non-completing popup login (roborev MEDIUM): a non-completing popup
    // is a genuine regression (e.g. the <authorization-code-flow> element failing to
    // register, or the popup never opening), so by DEFAULT we FAIL — never silently mask it.
    // The skip is allowed ONLY when the explicit opt-in (`ALLOW_E2E_POPUP_SKIP=1`) is set AND
    // we are NOT in CI — a constrained local worktree where the headless reactive-auth
    // dialog→window.open flow is known-flaky. CI is AUTHORITATIVE: `process.env.CI` forces a
    // hard FAILURE even if the opt-in is mistakenly set in the CI environment (roborev MEDIUM
    // 2nd round), so a misconfigured CI can never pass without exercising the only e2e
    // assertion for this change. The proactive-fetch behaviour is independently covered by the
    // unit tests (the webid-token-provider re-entrancy guard) + @jeswr/solid-elements' own
    // unit tests.
    if (!loggedIn) {
      if (process.env.CI || !process.env.ALLOW_E2E_POPUP_SKIP) {
        throw new Error(
          "Interactive OIDC popup login did not complete — this is a genuine regression " +
            "(e.g. the <authorization-code-flow> custom element not registering, or the " +
            "popup never opening), NOT acceptable flakiness. Set ALLOW_E2E_POPUP_SKIP=1 ONLY " +
            "for a constrained LOCAL worktree where the headless popup is known-flaky; it is " +
            "IGNORED in CI (process.env.CI), so a required gate always fails on a " +
            "non-completing login.",
        );
      }
      test.skip(
        true,
        "Interactive OIDC popup login could not be driven under headless Chromium and " +
          "ALLOW_E2E_POPUP_SKIP=1 was set OUTSIDE CI (constrained local worktree; known " +
          "reactive-auth dialog→window.open flakiness). Unset it (or run in CI) to treat a " +
          "non-completing login as a FAILURE.",
      );
    }

    // The records load on login. useHealthRecords reads the ONE health record document
    // and renders one <tr> per health entry (the seeded health:HealthRecord + N
    // health:Observation sibling subjects). Wait for the rows to render, proving we
    // actually loaded the record document — at least the N observations (the record adds
    // one more row, so ≥ observationCount is the safe floor).
    await expect
      .poll(async () => page.locator(".pod-health-table tbody tr").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(seeded.observationCount);

    // Give any straggler responses a SHORT, DETERMINISTIC beat to settle, then assert the
    // budget (roborev MEDIUM): we deliberately do NOT use `waitForLoadState("networkidle")`
    // — a health app can keep background/session requests alive, so networkidle could hang or
    // flake even after the asserted rows rendered, turning a 401-budget test into a
    // network-idleness test. The on-load discovery-chain reads (profile + Type-Index probe +
    // the record doc) have all resolved by the time the rows above rendered; a fixed short
    // window catches any immediate straggler 401 without waiting on indefinite background
    // traffic. (If the proactive boundary regressed, the 401s fire DURING those reads, before
    // the rows render — so they are already captured by the listener above.)
    await page.waitForTimeout(1_000);

    const total = resource401s.length;

    // (a) ≤ 1 resource-server 401 per storage root — the proactive patch attaches the
    //     token up front, so at most a single bootstrapping 401 per pod origin (in
    //     practice zero, but we allow one for any first-contact server-state edge).
    const perRoot = new Map<string, number>();
    for (const url of resource401s) {
      const origin = new URL(url).origin;
      perRoot.set(origin, (perRoot.get(origin) ?? 0) + 1);
    }
    for (const [origin, count] of perRoot) {
      expect(count, `401s on storage root ${origin}: ${count}`).toBeLessThanOrEqual(1);
    }

    // (b) total ≤ number of storage roots.
    expect(total, `total resource-server 401s: ${resource401s.join(", ")}`).toBeLessThanOrEqual(
      storageRoots.length,
    );

    // (c) REGRESSION GUARD: the 401 count does NOT scale with the records size. Under the
    //     old reactive manager every distinct pod document read on load paid its own 401;
    //     a larger record document / discovery chain surfaces more reads, so a regression
    //     would push `total` upward. The proactive patch keeps it flat — strictly below the
    //     observation count (which is ≥ the number of pod documents the app reads on load).
    expect(
      total,
      `401 count (${total}) must not scale with observation count (${seeded.observationCount})`,
    ).toBeLessThan(seeded.observationCount);
  });
});
