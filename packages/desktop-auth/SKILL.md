---
name: desktop-auth
description: Use when adding Solid sign-in to a desktop app (Tauri or Electron) through the system browser and a private-use scheme deep link, wiring @jeswr/desktop-auth into pod-auth's ui.getCode, or publishing a desktop app's native Client Identifier Document.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# @jeswr/desktop-auth

Read [README.md](./README.md) and suite-native's [SKILL.md](../suite-native/SKILL.md) first. The
request and callback checks live in suite-native's `createNativeCodeDriver`; this package only
supplies a desktop `AuthSessionPlugin` and the Client ID document.

## Rules

- Security critical: 100% coverage and an adversarial review for every change. Add a test for
  every new place that decides which URL counts as the callback.
- Never return anything from the session but a callback URL that is on the configured redirect
  path and carries exactly the request's `state`. Ignore everything else; never fail a sign-in
  because a stray URL arrived.
- The session opens only an `https:` authorization URL without credentials, whoever calls it.
- `onIgnored` receives a reason code from a closed set, never the URL, and a throwing hook is
  swallowed.
- Timeouts and host failures reach the app as `DesktopAuthError` with code `timed-out` or
  `host-failed`, built from the code alone. Never pass a host's error or message through.
- Listen before opening the browser. Always stop listening when the sign-in settles, including
  when the listener registers only after a cancel or timeout.
- No Tauri, Electron or other shell dependency. The shell passes `openUrl` and `onOpenUrl`.
- Never route pod requests or tokens through the shell. Keep pod-auth's IndexedDB persistence; a
  keychain store, if ever needed, goes through one narrow seam like suite-native's
  `SuiteSecureStore` and holds refresh tokens only.
- `desktopClientIdDocument` builds through suite-native's `nativeClientIdDocument`, which owns the
  fixed metadata. It refuses what it would otherwise rewrite: HTTPS `clientId`, `clientUri` and
  `logoUri` in normal form (compared byte for byte), a `clientId` that is not a public host name,
  a `redirectUri` equal to `parseRedirect(x).href` with no `//` after the scheme, a name without
  control or bidi characters, and a logo on the `clientId` origin.

Validate with this package's `lint`, `build`, `typecheck` and `test` scripts.
