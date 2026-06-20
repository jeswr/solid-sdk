// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// launch.ts — the PURE launch-URL seam. Given an app entry + the (optional) logged-in
// WebID, build the URL the "Launch" button navigates to. This is the single place the
// store decides HOW to carry the user's identity into the target app.
//
// THE ONE SECURITY INVARIANT (load-bearing, exhaustively tested in launch.test.ts):
//   ONLY the user's PUBLIC WebID is ever placed in a launch URL — NEVER a token,
//   access_token, refresh_token, id_token, DPoP proof, authorization code, or any
//   other credential. A WebID is public by definition; the actual session is
//   re-established at the shared IdP broker via OIDC `prompt=none` on landing (the
//   media-kraken#54 silent-SSO pattern), so nothing secret needs to (or does) travel
//   in the URL. The no-token test asserts the output contains none of those tokens.
//
// THE TWO MECHANISMS (selected by the app's `launch` field):
//   1. "autologin" → `${app.url}#autologin/<encodeURIComponent(webid)>` — the
//      full-page redirect SSO consumed by the 8 vite pod-apps + Solid Issues. Built
//      with the vendored canonical `autologinFragment` so the producer matches every
//      target's parser. The WebID rides in the URL FRAGMENT, which (RFC 3986 §3.5) is
//      client-side and never sent on the wire — the strongest placement.
//   2. "prefill" → `${app.url}?webid=<encodeURIComponent(webid)>` — Pod Manager's
//      inbound contract (`webIdFromSearch`): prefills the WebID + surfaces a one-click
//      sign-in (the popup model needs a user gesture, so it is NOT auto-submitted).
//
// FALLBACKS (no identity carried):
//   - no webId (logged out)               → plain `app.url` (the target shows its own login).
//   - launch === "none" / app not live    → plain `app.url`.
//   - a non-live app (wip/local-only/gated) NEVER produces a launch URL here — the UI
//     renders those as "Coming soon" and calls {@link launchUrl} only for live apps —
//     but as defence-in-depth this returns `null` when the app has no deployed URL.

import { autologinFragment } from "./autologin-fragment";
import type { AppEntry } from "./catalog";

/**
 * Build the Launch URL for an app, carrying the (public) WebID when one is known.
 *
 * @param app    the catalog entry (its `deployedUrl` + `launch` mechanism).
 * @param webId  the logged-in user's WebID, or `null`/`undefined` when logged out.
 * @returns the URL string to navigate to, or `null` when the app has no deployed
 *   URL (a not-live app has nothing to launch).
 */
export function launchUrl(app: AppEntry, webId?: string | null): string | null {
  // No deployed origin → nothing to launch (the UI renders "Coming soon").
  if (!app.deployedUrl) return null;

  // Normalise the base origin (drop any trailing slash so we control the join).
  const base = app.deployedUrl;

  // Logged out, or an app that declares no deep-link contract → a plain link; the
  // target app shows its own login screen. Carry NOTHING.
  if (!webId || app.launch === "none") return base;

  // The WebID is the ONLY thing that ever leaves the store. `new URL` so we set the
  // hash/query through the URL API (correct encoding, no hand-concatenation) — and so
  // an attacker-controlled `deployedUrl` (it is committed config, but be principled)
  // cannot smuggle a second query/fragment past us.
  if (app.launch === "autologin") {
    const url = new URL(base);
    // autologinFragment already returns `#autologin/<encodeURIComponent(webid)>`;
    // assign to `url.hash` (the URL API keeps the leading `#`).
    url.hash = autologinFragment(webId);
    return url.toString();
  }

  // app.launch === "prefill" — Pod Manager's `?webid=` contract.
  const url = new URL(base);
  url.searchParams.set("webid", webId);
  return url.toString();
}
