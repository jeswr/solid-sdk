// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// autologin.ts — the PURE, testable decision + orchestration logic for the
// Pod-Manager deep-link autologin (media-kraken#54 pattern), factored out of
// SolidAuthProvider so it can be unit-tested without mounting the (browser-only,
// dynamic-import) React component. The SolidAuthProvider effect is a thin shell that
// supplies the live dependencies (provider methods, location, history, sessionStorage)
// to `runAutologin` below.
//
// THE FEATURE: opening the app with a URL fragment `#autologin/<encodeURIComponent(
// webid)>` (a deep-link from the Pod Manager, where the user already has a live IdP
// session at the shared broker and prior app authorization) AUTOMATICALLY
// authenticates as that WebID via a FULL-PAGE Solid-OIDC redirect. A live IdP session
// + prior approval ⇒ the broker redirects back ALREADY AUTHENTICATED — silent SSO,
// no credential prompt.
//
// WHY A FULL-PAGE REDIRECT (not the popup): published @solid/reactive-authentication
// 0.1.3 has only a popup login (via <authorization-code-flow> getCode). A popup
// auto-opened on page load — with no user gesture — is browser-blocked. So autologin
// uses the NEW redirect path on WebIdDPoPTokenProvider (beginRedirectLogin /
// completeRedirectLogin), a two-phase flow that persists its in-between state across
// the navigation.
//
// THE CASES (decided by `classifyAutologin`):
//   CASE A  — returning from the broker redirect: a pending redirect record exists AND
//     the URL has `?code` + `?state`. Complete the exchange (silent SSO).
//   CASE A' — returning from the broker redirect with an OIDC ERROR: a pending record
//     exists AND the URL has `?error` + `?state` (the broker declined silent SSO /
//     the user declined). Abort: reset the record + sentinel, clean the URL, surface
//     the error — so a declined SSO does not leave a stale record blocking retries.
//   CASE B  — a fresh deep-link: NOT logged in, NO pending record, and
//     `location.hash` starts with `#autologin/`. Begin the redirect.
//
// THE LOOP GUARD: a one-shot sessionStorage sentinel (`autologin-attempted`). If a
// fresh deep-link arrives and the sentinel is ALREADY set, we bounced back
// unauthenticated (live session/approval absent) — do NOT re-attempt; clear the
// sentinel + fragment and fall back to the login panel. A successful completion (CASE
// A) clears the sentinel too.

import {
  type WebIdDPoPTokenProvider,
  webIdsEqual,
} from "./webid-token-provider";

/** sessionStorage key for the one-shot loop-guard sentinel (the requested WebID). */
export const AUTOLOGIN_SENTINEL_KEY = "autologin-attempted";

/** The deep-link fragment prefix: `#autologin/<encodeURIComponent(webid)>`. */
export const AUTOLOGIN_FRAGMENT_PREFIX = "#autologin/";

/**
 * What the autologin effect should do this mount. A discriminated union so the
 * orchestration in {@link runAutologin} (and its tests) is exhaustive and explicit.
 */
export type AutologinDecision =
  | { kind: "none" }
  | { kind: "complete-redirect" }
  | { kind: "begin-redirect"; webId: string }
  | { kind: "abort-redirect"; error: string }
  | { kind: "loop-guard-fallback" };

/** The ambient inputs the classifier reads — injected so tests need no browser. */
export interface AutologinEnv {
  /** True once the auth runtime has loaded (SolidAuthProvider `ready`). */
  ready: boolean;
  /** Whether the app already has an authenticated WebID (a session takes precedence). */
  loggedIn: boolean;
  /** Full current URL (location.href). */
  href: string;
  /** Current URL fragment INCLUDING the leading `#` (location.hash), or "". */
  hash: string;
  /** Whether a two-phase redirect-login record is pending (hasPendingRedirectLogin()). */
  hasPendingRedirect: boolean;
  /** The current value of the loop-guard sentinel, or null when unset. */
  sentinel: string | null;
}

/**
 * PURE classification of what the autologin effect should do. No I/O, no side
 * effects — every branch decided from {@link AutologinEnv} so the rules are pinned
 * in isolation (the same testability discipline as `login-result.ts`).
 *
 * Precedence (the guards the brief requires):
 *  - autologin runs ONLY when NOT logged in AND ready. A stored/active session
 *    takes precedence ⇒ "none".
 *  - CASE A (complete): a pending redirect record AND the URL carries `?code&state`.
 *  - CASE A' (abort): a pending redirect record AND the URL carries an OIDC ERROR
 *    return (`?error&state` — the broker declined silent SSO / the user declined).
 *    Without this the error return is NOT classified as a callback (it has no `code`),
 *    so the pending record + sentinel are left set, blocking later fresh attempts in
 *    the tab. ⇒ "abort-redirect" (reset the provider's record + clear sentinel +
 *    clean URL + surface the OAuth error).
 *  - CASE B (begin): NOT logged in, NO pending record, and `#autologin/<webid>` —
 *    but if the loop-guard sentinel is already set FOR THIS WebID (we bounced back
 *    unauthenticated for the same identity) ⇒ "loop-guard-fallback" (do NOT
 *    re-attempt); a sentinel for a DIFFERENT WebID does NOT swallow the new deep-link
 *    ⇒ "begin-redirect" for the new WebID (the begin path overwrites the sentinel).
 */
export function classifyAutologin(env: AutologinEnv): AutologinDecision {
  if (!env.ready) return { kind: "none" };
  // A stored/active session takes precedence — never autologin over it.
  if (env.loggedIn) return { kind: "none" };

  // CASE A — returning from the broker redirect with a successful auth code.
  if (env.hasPendingRedirect && hasAuthCallbackParams(env.href)) {
    return { kind: "complete-redirect" };
  }

  // CASE A' — returning from the broker redirect with an OIDC ERROR (e.g. the broker
  // declined silent SSO with `?error=login_required&state=...`). This IS a callback
  // return (it carries `state`), just an error one — classify it so the completion
  // path clears the pending record + sentinel instead of leaving them set.
  if (env.hasPendingRedirect && hasAuthErrorParams(env.href)) {
    return { kind: "abort-redirect", error: authErrorFromHref(env.href) };
  }

  // CASE B — a fresh deep-link (only when there is no pending record to complete).
  if (!env.hasPendingRedirect && env.hash.startsWith(AUTOLOGIN_FRAGMENT_PREFIX)) {
    const webId = parseAutologinFragment(env.hash);
    if (!webId) return { kind: "none" }; // malformed fragment — ignore it.
    // The loop guard: only fall back when the sentinel is set FOR THIS SAME WebID —
    // i.e. we already bounced back unauthenticated for THIS identity in this tab.
    // A sentinel left by a DIFFERENT WebID's attempt must NOT swallow a new
    // deep-link: a later deep-link for a different identity in the same tab should
    // begin its own redirect (the begin path overwrites the sentinel with its WebID).
    if (webIdsEqual(env.sentinel ?? undefined, webId)) {
      return { kind: "loop-guard-fallback" };
    }
    return { kind: "begin-redirect", webId };
  }

  return { kind: "none" };
}

/** Whether a URL carries BOTH `code` and `state` query params (an auth callback). */
export function hasAuthCallbackParams(href: string): boolean {
  try {
    const u = new URL(href);
    return u.searchParams.has("code") && u.searchParams.has("state");
  } catch {
    return false;
  }
}

/**
 * Whether a URL carries an OIDC ERROR return — `error` AND `state` query params (e.g.
 * `?error=login_required&state=...`, the broker declining silent SSO or the user
 * declining). This is still a redirect callback (it carries `state`), just an error
 * one; {@link classifyAutologin} routes it to an explicit abort so the pending record
 * + loop-guard sentinel are cleared instead of left set (which would block later fresh
 * autologin attempts in the same tab). Requires `state` so a stray `?error` on an
 * unrelated URL is not misclassified as our callback.
 */
export function hasAuthErrorParams(href: string): boolean {
  try {
    const u = new URL(href);
    return u.searchParams.has("error") && u.searchParams.has("state");
  } catch {
    return false;
  }
}

/**
 * Build a human-readable message from an OIDC error callback's `error` /
 * `error_description` query params, for surfacing to the UI on an aborted redirect.
 * Falls back to a generic message when the params are unreadable.
 */
function authErrorFromHref(href: string): string {
  try {
    const u = new URL(href);
    const error = u.searchParams.get("error") ?? "login_failed";
    const description = u.searchParams.get("error_description");
    return description
      ? `${error}: ${description}`
      : `Sign-in was declined by the identity provider (${error}).`;
  } catch {
    return "Sign-in was declined by the identity provider.";
  }
}

/**
 * Parse + `decodeURIComponent` the WebID from a `#autologin/<encoded-webid>`
 * fragment. Returns null when the fragment is malformed (no payload, or a bad
 * percent-encoding) so the caller can ignore it rather than crash.
 */
export function parseAutologinFragment(hash: string): string | null {
  if (!hash.startsWith(AUTOLOGIN_FRAGMENT_PREFIX)) return null;
  const encoded = hash.slice(AUTOLOGIN_FRAGMENT_PREFIX.length);
  if (encoded.length === 0) return null;
  try {
    const webId = decodeURIComponent(encoded);
    return webId.length > 0 ? webId : null;
  } catch {
    return null; // malformed percent-encoding
  }
}

/**
 * The post-login steps shared with `doLogin`: confirm the OP authenticated the
 * REQUESTED WebID (never infer "logged in" from a token), read the profile, and hand
 * back what the caller sets into React state. Kept here (pure-ish — only reads the
 * provider + the injected readProfile) so the completion path mirrors doLogin EXACTLY.
 */
export interface AutologinCallbacks {
  /** WebIdDPoPTokenProvider — its redirect methods + identity accessors. */
  provider: Pick<
    WebIdDPoPTokenProvider,
    "beginRedirectLogin" | "completeRedirectLogin" | "authenticatedWebId" | "reset"
  >;
  /** Read a profile (the template's readProfile). */
  readProfile: (webId: string) => Promise<unknown>;
  /** location.href. */
  href: () => string;
  /** location.origin. */
  origin: () => string;
  /** Replace the URL (strip `?code&state` + fragment) without a navigation. */
  replaceUrl: (url: string) => void;
  /** Full-page navigate to the authorization URL. */
  assignUrl: (url: string) => void;
  /** Set the pending WebID the provider's getWebId reads (pendingWebIdHolder). */
  setPendingWebId: (webId: string | null) => void;
  /** Read the loop-guard sentinel. */
  getSentinel: () => string | null;
  /** Set the loop-guard sentinel to the requested WebID. */
  setSentinel: (webId: string) => void;
  /** Clear the loop-guard sentinel. */
  clearSentinel: () => void;
  /** Surface the "Signing you in…" pending state. */
  setRestoring: (restoring: boolean) => void;
  /** On a SUCCESSFUL completion: record the session in React state. */
  onAuthenticated: (webId: string, profile: unknown) => void;
  /** On any terminal failure: fall back to the login panel (clear pending state). */
  onFallback: (message?: string) => void;
}

/**
 * The completed URL after stripping `?code&state` AND any fragment — used by both
 * CASE A (clean the callback URL) and the loop-guard fallback (clean the fragment).
 * Keeps scheme/host/port/path; drops query + hash entirely.
 */
export function cleanedUrl(href: string): string {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Run ONE autologin pass for the current mount. Idempotency is the CALLER's
 * responsibility (an in-flight ref/module guard + the sentinel), because React
 * StrictMode double-invokes the effect — see SolidAuthProvider. This function does
 * the side-effectful orchestration the classifier decided.
 *
 * CASE A (complete-redirect): surface "Signing you in…", complete the DPoP-bound
 *   exchange, then mirror doLogin's post-login steps — confirm the authenticated
 *   WebID matches via webIdsEqual, read the profile, set webId+profile, clear the
 *   sentinel, and IMMEDIATELY clean the URL (strip `?code&state` + fragment). On
 *   failure: clear the record + sentinel and fall back to the login panel.
 *
 * CASE B (begin-redirect): IMMEDIATELY clean the URL (strip the fragment) BEFORE
 *   anything else so a refresh/bounce can't re-trigger and the WebID isn't left in
 *   the address bar; set the sentinel; set the pending WebID + reset the provider
 *   (mirror doLogin's identity-change reset); surface "Signing you in…"; begin the
 *   redirect and full-page navigate. On any pre-redirect error: clear the sentinel
 *   and fall back to the login panel.
 *
 * abort-redirect (CASE A', the OIDC error return): reset the provider (clears the
 *   persisted redirect record + per-identity state), clear the sentinel, clean the URL
 *   (strip `?error&state` + fragment), and surface the OAuth error — so a declined
 *   silent SSO does NOT leave a stale record/sentinel blocking later attempts.
 *
 * loop-guard-fallback: clear the sentinel, clean the fragment, fall back (no loop).
 */
export async function runAutologin(
  decision: AutologinDecision,
  cb: AutologinCallbacks,
): Promise<void> {
  switch (decision.kind) {
    case "none":
      return;

    case "loop-guard-fallback": {
      // We bounced back unauthenticated: clear the one-shot sentinel and the
      // fragment, and fall through to the login panel. No re-attempt — no loop.
      cb.clearSentinel();
      cb.replaceUrl(cleanedUrl(cb.href()));
      cb.onFallback();
      return;
    }

    case "abort-redirect": {
      // CASE A' — the broker redirected back with an OIDC ERROR (declined silent
      // SSO / the user declined). reset() the provider so the PENDING redirect
      // record (its persisted DPoP key + PKCE verifier + state) is cleared along with
      // any per-identity state — otherwise the stale record would block later fresh
      // attempts. Clear the one-shot sentinel, clean the URL (strip `?error&state` +
      // fragment), and surface the OAuth error to the UI. No re-attempt — no loop.
      cb.provider.reset();
      cb.clearSentinel();
      cb.replaceUrl(cleanedUrl(cb.href()));
      cb.onFallback(decision.error);
      return;
    }

    case "complete-redirect": {
      cb.setRestoring(true);
      try {
        await cb.provider.completeRedirectLogin(cb.href());
        // PROVE the session authenticated AS the WebID the pending flow targeted —
        // the provider published authenticatedWebId from the id_token claims.
        const authedWebId = cb.provider.authenticatedWebId();
        if (!authedWebId) {
          throw new Error(
            "Autologin did not complete — no authenticated WebID was established.",
          );
        }
        // Read the (now authenticated) profile, exactly as doLogin does.
        const profile = await cb.readProfile(authedWebId);
        // Success: clear the loop-guard sentinel and clean the URL (strip
        // `?code&state` AND any leftover fragment) so a refresh doesn't re-run.
        cb.clearSentinel();
        cb.replaceUrl(cleanedUrl(cb.href()));
        cb.onAuthenticated(authedWebId, profile);
      } catch (e) {
        // Failure: the provider cleared its own record in completeRedirectLogin's
        // finally; clear the sentinel + clean the URL and fall back. No loop, no spew.
        cb.clearSentinel();
        cb.replaceUrl(cleanedUrl(cb.href()));
        cb.onFallback(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    case "begin-redirect": {
      const { webId } = decision;
      // IMMEDIATELY clean the URL (strip the fragment) BEFORE anything else, so a
      // refresh/bounce can't re-trigger and the WebID isn't left in the address bar.
      cb.replaceUrl(cleanedUrl(cb.href()));
      // One-shot sentinel: a bounce-back-unauthenticated next time falls through to
      // the login panel instead of redirecting again (the loop guard).
      cb.setSentinel(webId);
      // Mirror doLogin's identity-change reset so no prior identity leaks in.
      cb.setPendingWebId(webId);
      cb.provider.reset();
      cb.setRestoring(true);
      try {
        const returnUri = `${cb.origin()}/`;
        const { authorizationUrl } = await cb.provider.beginRedirectLogin(returnUri);
        cb.assignUrl(authorizationUrl);
        // Note: on success the page navigates away; we do NOT clear setRestoring —
        // the next document load decides the next state.
      } catch (e) {
        // Pre-redirect failure: clear the sentinel and fall back to the login panel.
        cb.clearSentinel();
        cb.setPendingWebId(null);
        cb.provider.reset();
        cb.onFallback(e instanceof Error ? e.message : String(e));
      }
      return;
    }
  }
}

/**
 * Build the `#autologin/<encodeURIComponent(webid)>` deep-link fragment for a WebID.
 * The inverse of {@link parseAutologinFragment} — exported so the Pod Manager (and
 * tests) construct the deep-link the same way the parser expects.
 */
export function autologinFragment(webId: string): string {
  return `${AUTOLOGIN_FRAGMENT_PREFIX}${encodeURIComponent(webId)}`;
}

/** Re-export so callers can reuse the same strict WebID comparison. */
export { webIdsEqual };
