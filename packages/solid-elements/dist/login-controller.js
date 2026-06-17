// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The LoginController seam — the dependency-injection boundary between
// <jeswr-login-panel> (presentation + UX) and the security-critical auth
// machinery (@solid/reactive-authentication + @jeswr/solid-session-restore).
//
// WHY A SEAM (load-bearing):
//   1. The core @jeswr/solid-elements library has ZERO runtime auth deps and a
//      self-contained, committed `dist/` (the GitHub-installable contract under
//      `ignore-scripts=true`). reactive-auth pulls in oauth4webapi + dpop, and
//      @jeswr/solid-session-restore is OFF-NPM (github:-installed). Hard-importing
//      either into the core entry would break that contract for every consumer of
//      every component. So the heavy wiring lives in the OPTIONAL `/auth`
//      subexport (`createReactiveAuthController`), and the element depends only on
//      this tiny structural interface.
//   2. It makes the element trivially + adversarially testable: a test injects a
//      mock controller and asserts the UX/seam without standing up a real OP.
//   3. It keeps the credential-leak boundary explicit and reviewable in one place:
//      the controller owns `authenticatedFetch` (the session-bound fetch) and
//      `publicFetch` (the pristine, pre-patch native fetch); the element only
//      RELAYS them and never authenticates a foreign-origin request itself.
//
// This module is PURE TYPES + tiny pure helpers — no auth dep, no DOM dep — so it
// compiles into the core dist without dragging anything in.
/**
 * `webId` may legitimately be a URL with a fragment (`#me`). For display we keep
 * it verbatim; this helper is only the dedup/identity comparison used by the
 * recent-accounts list and the restore WebID re-check, normalising trailing
 * whitespace but NOT case (WebIDs are case-sensitive URLs). Exported for tests.
 */
export function sameWebId(a, b) {
    if (!a || !b)
        return false;
    return a.trim() === b.trim();
}
