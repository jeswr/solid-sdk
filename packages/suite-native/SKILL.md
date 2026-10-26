---
name: suite-native
description: Work on @jeswr/suite-native, the Solid Suite's native-app seams (system-browser Solid-OIDC code driver, share sheet in/out, mobile Client ID Document) used by the Capacitor shells in apps/mobile.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/suite-native

Read `solid-suite-planning/specs/mobile/DESIGN.md` (D3 sign-in, D4 redirect + Client ID Document,
D6 share) and sdk-core `ADR-004-auth.md` (D2 `ui.getCode`, D5 keys) before changing this package.

## Rules

- Security critical: 100% coverage, adversarial tests for every check. Never relax a fail-closed
  check in `auth-session.ts` without a design change; never return anything but the code from the
  driver, and never let tokens, PKCE verifiers or DPoP keys pass through native code.
- `src/index.ts` must not import `@capacitor/core` (web bundles load it); native bindings live only
  in `src/capacitor.ts` and are registered by the native plugin names `SuiteAuthSession`,
  `SuiteShareIntake` and `Share`. Changing a plugin method means changing the Swift/Kotlin plugin
  in `apps/mobile` in the same PR.
- Everything from native code is untrusted: validate with `validateShareBatch` and enforce sizes in
  `readFile`; native code validates too.
- The redirect URI is the private-use scheme `org.jeswr.suite:/oauth/callback`; the Client ID
  Document is served from the suite origin at `/.well-known/solid-client-id-mobile.jsonld`.

Validate with this package's `lint`, `build`, `typecheck` and `test` scripts.
