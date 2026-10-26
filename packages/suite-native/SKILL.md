---
name: suite-native
description: Work on @jeswr/suite-native, the Solid Suite's native-app seams (system-browser Solid-OIDC code driver, share sheet in/out, mobile Client ID Document) used by the Capacitor shells in apps/mobile.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/suite-native

Read `solid-suite-planning/specs/mobile/DESIGN.md` (D3 bridge isolation, D4 sign-in,
D5 redirect + Client ID Document, D7 share, D9 hardening) and sdk-core `ADR-004-auth.md`
(D2 `ui.getCode`, D5 keys) before changing this package.

## Rules

- Security critical: 100% coverage, adversarial tests for every check. Never relax a fail-closed
  check in `auth-session.ts` without a design change; never return anything but the code from the
  driver, and never let tokens, PKCE verifiers or DPoP keys pass through native code.
- `src/index.ts` must not import `@capacitor/core` (web bundles load it); native bindings live only
  in `src/capacitor.ts` and are registered by the native plugin names `SuiteAuthSession`,
  `SuiteShareIntake`, `SuiteShareStaging` and `Share`. Changing a plugin method means changing the Swift/Java plugin
  in `apps/mobile` in the same PR.
- Everything from native code is untrusted: validate with `validateShareBatch` and enforce sizes in
  `readFile`; native code validates too.
- The redirect URI is the private-use scheme `org.jeswr.suite:/oauth/callback`; the Client ID
  Document is served from the suite origin at `/.well-known/solid-client-id-mobile.jsonld`.

Validate with this package's `lint`, `build`, `typecheck` and `test` scripts.

<!-- AUTHORED-BY GPT-5.6 Codex -->
## Outgoing pod files (DESIGN D7)

- The caller supplies a Blob already downloaded with its authenticated fetch. `stageFile` and
  `shareFiles` must never accept tokens or perform downloads in native code.
- `ShareStagingPlugin` has `begin({name, mimeType, size})`,
  `writeChunk({stagingId, offset, data})` (base64), `commit({stagingId})`, and `abort({stagingId})`.
  Both sides enforce at most 512 KiB decoded per chunk, contiguous offsets, and a 100 MiB file cap.
  JS limits may lower these caps, never increase them. Sanitise names with `sanitiseFileName`.
- Validate native IDs and commit URIs; attempt abort on every error once an ID is available.
  Empty files commit without any write. `shareFiles([{blob, name, mimeType?}], content, targets)`
  preflights 1–20 files and at most 100 MiB combined, then invokes the existing `share` seam.
- Both native stores return **file://** URLs accepted by the installed Capacitor Share 8.0.3.
  Android Share creates its own FileProvider content URI; do not return content:// from staging.
  Keep `file_paths.xml` scoped to `cache/share-out/` alone. iOS uses `tmp/share-out/`.
- Native stores reserve active uploads' declared bytes, reject malformed arguments and incomplete
  commits, and enforce 24-hour retention, 100 MiB total, and 20 files, evicting oldest committed
  files. Do not delete files when the share sheet closes: the recipient may read them later.
- Keep store logic independent of Android/Capacitor APIs, test it with JVM JUnit, and maintain
  mobile guard tests for registration, FileProvider scope, and Xcode App target source entries.
