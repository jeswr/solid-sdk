---
name: desktop-auth
description: Use when adding Solid sign-in to a desktop app (Tauri or Electron) through the system browser and a private-use scheme deep link, wiring @jeswr/desktop-auth into pod-auth's ui.getCode, or publishing a desktop app's native Client Identifier Document.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

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
- Listen before opening the browser. Always stop listening when the sign-in settles, including
  when the listener registers only after a cancel or timeout.
- No Tauri, Electron or other shell dependency. The shell passes `openUrl` and `onOpenUrl`.
- Never route pod requests or tokens through the shell. Keep pod-auth's IndexedDB persistence; a
  keychain store, if ever needed, goes through one narrow seam like suite-native's
  `SuiteSecureStore` and holds refresh tokens only.
- `desktopClientIdDocument` requires HTTPS `clientId` in normal form (it is compared byte for
  byte), a private-use redirect accepted by suite-native's `parseRedirect`, and a logo on the
  `clientId` origin.

Validate with this package's `lint`, `build`, `typecheck` and `test` scripts.
