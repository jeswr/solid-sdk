// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// 401-BUDGET e2e (task #123) — proves the @jeswr/solid-elements PROACTIVE auth-fetch
// (which REPLACED the raw ReactiveFetchManager in SessionProvider) eliminates the
// per-resource "401-dance". Under the old reactive manager EVERY pod request went out
// UNAUTHENTICATED first and only attached the DPoP token on the 401 it provoked — per
// resource, no cache — so each distinct pod URL paid a wasted 401 → upgrade → retry.
// The proactive patch attaches the token UP FRONT for an allowed origin, so the pod
// resource server (the CSS at :3000) should see AT MOST one bootstrapping 401 per
// storage root and NEVER a count that scales with the room-list size.
//
// REGRESSION SURFACE — pod-chat's useChat loads the room list by ONE GET on the rooms
// container AND THEN point-reading EACH room descriptor individually (the N+1 walk in
// src/ui/useChat.ts: `Promise.all(entries.map((e) => readRoomViewResilient(store, e.url)))`),
// so a room list of N rooms performs N+1 pod reads on load. Under the old reactive
// manager those would be N+1 wasted 401s; the proactive patch keeps the 401 count flat
// (≤1 per storage root).
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
//   • Wait for the room list to render its N room rows (login resolves the rooms
//     container + lists it) and assert the resource-server 401 count is bounded and does
//     NOT scale with the room count.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

interface Seeded {
  base: string;
  webId: string;
  email: string;
  password: string;
  podRoot: string;
  roomsContainer: string;
  roomCount: number;
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

/** Drive the WebID-first popup login. Returns once the room list is on screen.
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
  // a fast-opening popup the way a post-hoc waitForEvent can).
  const popups: Page[] = [];
  page.context().on("page", (p) => popups.push(p));
  await page.getByRole("button", { name: /log in/i }).click();

  // HEADLESS POPUP FLAKINESS (documented): @solid/reactive-authentication's getCode →
  // window.open flow (with a `prompt=none` silent-first attempt) does not reliably open
  // its popup under headless Chromium in a constrained worktree. We wait for a popup that
  // lands on the CSS `#email` form; if a window.open-blocked FALLBACK dialog appears
  // instead, click its "Open new window" button. If NEITHER materialises in the budget we
  // return false → the caller skips-with-reason locally / FAILS in CI (so a genuine
  // regression — e.g. the custom element not registering — is never masked). The
  // proactive-fetch behaviour itself is exhaustively covered by @jeswr/solid-elements' own
  // unit tests + this repo's webid-token-provider re-entrancy guard test.
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

  // Back on the app: the chat root section (`.pod-chat`) appears once logged in (after the
  // host resolves the pod root and renders <ChatRooms>).
  await expect(page.locator(".pod-chat")).toBeVisible({ timeout: 60_000 });
  return true;
}

test.describe("401-budget — the proactive auth-fetch eliminates the 401-dance", () => {
  test("a session loads the room list paying ≤1 resource-server 401 per storage root", async ({
    page,
  }) => {
    const seeded = readSeeded();
    // The pod storage roots a session's token may legitimately ride to. For this
    // single-pod seed there is exactly ONE (the pod root's origin). The budget is keyed
    // to this count.
    const storageRoots = [new URL(seeded.podRoot).origin];

    const resource401s: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 401 && isResourceServer401(res.url(), storageRoots)) {
        resource401s.push(res.url());
      }
    });

    const loggedIn = await login(page, seeded);
    // SKIP-vs-FAIL on a non-completing popup login (roborev MEDIUM finding, addressed):
    // a non-completing popup is a genuine regression (e.g. the <authorization-code-flow>
    // element failing to register, or the popup never opening), so the DEFAULT — in CI AND
    // locally — is a HARD FAILURE: the test never silently provides zero coverage. The
    // skip is OPT-IN ONLY, gated behind an explicit `ALLOW_AUTH_E2E_SKIP=1` AND never in
    // CI, for the narrow case of a constrained local worktree where the headless
    // reactive-auth dialog→window.open flow is known-flaky and a developer has chosen to
    // tolerate a skip. Without that opt-in, a broken login fails the run — so the 401-budget
    // coverage cannot silently disappear during development. (The proactive-fetch behaviour
    // is also independently covered by @jeswr/solid-elements' own unit tests + this repo's
    // webid-token-provider re-entrancy guard test.)
    if (!loggedIn) {
      const skipAllowed = !process.env.CI && process.env.ALLOW_AUTH_E2E_SKIP === "1";
      if (!skipAllowed) {
        throw new Error(
          "Interactive OIDC popup login did not complete — this is a genuine regression " +
            "(e.g. the <authorization-code-flow> custom element not registering, or the popup " +
            "never opening), NOT acceptable flakiness. Investigate before merge. (To tolerate " +
            "a skip in a constrained LOCAL worktree only, re-run with ALLOW_AUTH_E2E_SKIP=1.)",
        );
      }
      test.skip(
        true,
        "Interactive OIDC popup login could not be driven under headless Chromium in this " +
          "local worktree (known reactive-auth dialog→window.open flakiness); skip explicitly " +
          "opted into via ALLOW_AUTH_E2E_SKIP=1. Unset it (or set CI=1) to treat a " +
          "non-completing login as a FAILURE.",
      );
    }

    // The room list loads on login. useChat does ONE rooms-container GET AND THEN reads
    // each room descriptor individually — the N+1 regression surface. Wait for the N room
    // rows to render (one <tr.pod-chat-room-row> per room), proving we actually performed
    // the per-room reads.
    await expect
      .poll(async () => page.locator(".pod-chat-table tr.pod-chat-room-row").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(seeded.roomCount);

    // Give any straggler responses a beat to settle, then assert the budget.
    await page.waitForLoadState("networkidle");

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

    // (c) REGRESSION GUARD: the 401 count does NOT scale with the room count. Under the
    //     old reactive manager every read (the listing + each per-room descriptor GET) paid
    //     its own 401, so a room list of N rooms would push `total` toward N+1. The
    //     proactive patch keeps it flat — strictly below the room count.
    expect(
      total,
      `401 count (${total}) must not scale with room count (${seeded.roomCount})`,
    ).toBeLessThan(seeded.roomCount);
  });
});
