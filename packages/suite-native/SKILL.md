---
name: suite-native
description: Use when working on @jeswr/suite-native, the Solid Suite's native-app seams (system-browser Solid-OIDC code driver, share sheet in/out, refresh-token secure store, mobile Client ID Document) used by the Capacitor shells in apps/mobile.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/suite-native

Read `solid-suite-planning/specs/mobile/DESIGN.md` (D3 bridge isolation, D4 sign-in,
D5 redirect + Client ID Document, D7 share, D9 hardening) and sdk-core `ADR-004-auth.md`
(D2 `ui.getCode`, D5 keys) before changing this package.

## Rules

- Security critical: 100% coverage, adversarial tests for every check. Never relax a fail-closed
  check in `auth-session.ts` without a design change; never return anything but the code from the
  driver, and never let access tokens, PKCE verifiers or DPoP keys pass through native code.
  Refresh tokens may cross only the `SuiteSecureStore` seam (MOB-P4 S11/S12).
- `src/index.ts` must not import `@capacitor/core` (web bundles load it); native bindings live only
  in `src/capacitor.ts` and are registered by the native plugin names `SuiteAuthSession`,
  `SuiteShareIntake`, `SuiteShareStaging`, `SuiteSecureStore`, `SuiteFiles` and `Share`. Changing a plugin method means changing the Swift/Java plugin
  in `apps/mobile` in the same PR.
- Everything from native code is untrusted: validate with `validateShareBatch` and enforce sizes in
  `readFile`; native code validates too. The sending app declares a shared file's type, so active
  types (HTML, XML, SVG, script) become `application/octet-stream`. `sanitiseFileName` also
  replaces `%`, `?`, `#`, `:`, C1 controls and bidi overrides, and caps names at 255 UTF-8 bytes.
- The driver refuses authorization URLs carrying `request` or `request_uri` (JAR/PAR would bypass
  its checks) and drops an IdP error description outside the RFC 6749 charset.
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
  Keep `file_paths.xml` scoped to `cache/share-out/` and the PDF handoff's `cache/pdf-preview/`
  alone. iOS uses `tmp/share-out/`.
- Native stores reserve active uploads' declared bytes, reject malformed arguments and incomplete
  commits, and enforce 24-hour retention, 100 MiB total, and 20 files, evicting oldest committed
  files. `shareFiles` passes the ids it has already staged as `begin({ keep })`, so a batch never
  evicts its own files; begin fails instead when only kept files remain. Do not delete files when
  the share sheet closes: the recipient may read them later.
- iOS registers `SuiteSharePlugin` under the name `Share`, replacing @capacitor/share 8.0.3,
  which would hand any app-container `file:` URL to the sheet. It accepts only committed
  share-out files and https URLs without credentials. Keep that override registered.
- Keep store logic independent of Android/Capacitor APIs, test it with JVM JUnit, and maintain
  mobile guard tests for registration, FileProvider scope, and Xcode App target source entries.

## PDF preview handoff (MOB-P3 E5)

- `openPdf(filesPlugin, name, bytes, signal?)` takes bytes the caller already read with a bounded
  reader (Drive's `readLimited`); native code never fetches. It refuses files over
  `PDF_PREVIEW_MAX_BYTES` (25 MiB) or without the `%PDF-` signature before anything crosses,
  cuts the name to 255 code points, and stops before the next native call once `signal` aborts.
  Callers abort when the view that started the transfer goes away.
- Native code repeats every check: the cap on the declared size and on each append, the
  signature on the first bytes, canonical base64 chunks, a whole non-boolean size, names up to
  4096 UTF-16 units, one handle at a time (a new `pdfBegin` discards the old one), and a
  `cache/pdf-preview/` directory emptied when the process starts. A call naming any other handle
  is refused without touching the live transfer or the file a viewer has open.
- Expiry is lazy and uses the monotonic clock: an idle (60 s) transfer is dropped on its next call
  or when the app returns to the foreground. Android also deletes a finished file five minutes
  after opening it, on the next resume (the external viewer may still read it until then); iOS
  deletes it when QuickLook closes. Android keeps one store per process, so a recreated activity
  never deletes a file the viewer is reading.
- Android opens a read-only FileProvider URI after `resolveActivity`; iOS presents QuickLook with
  editing off. Keep `PdfPreviewStore` free of Capacitor and platform UI so the JVM and XCTest
  suites cover it, including the bridge argument checks (`declaredSize`, `checkChunk` /
  `decodeChunk`).
- `clearPdfPreviews(filesPlugin)` (native `pdfClear`) drops any transfer, dismisses QuickLook on
  iOS and empties `cache/pdf-preview/`. The suite shell calls it whenever the active account
  changes away from a signed-in one (sign-out, sign-out-all, switch), never on first mount, so a
  recreated view cannot delete a file the viewer is reading for the same account.
  Drive's handoff also aborts its transfer when the active account changes, and iOS clears on
  the plugin queue before closing QuickLook, so a transfer that was already opening is closed.
- Import `@jeswr/suite-native/capacitor` lazily from web code, so only native builds load it.

## Refresh-token secure store (MOB-P4 S11/S12)

Read `solid-suite-planning/specs/mobile/P4-SECURE-STORE.md` completely before changing this seam.

- `createSecureStore(plugin)` exposes `status()`, `get(key, signal?)`,
  `set(key, value, { userPresence, version })`, `delete(key)`, `clear()` and `cancel()`.
  `get` returns `{ value, version }`; `set` returns the committed `{ version }`.
  Keep that version beside the in-memory token for rotations. Native `remove` and `clear`
  invalidate earlier versions through tombstones and the namespace epoch.
- Validate keys against `^[a-z0-9][a-z0-9:._-]{0,127}$` and values against the 16 KiB UTF-8
  byte cap before the bridge. Versions must be non-negative safe integers, and `userPresence`
  must be boolean. Validate every native response's exact fields and types; malformed results
  become `failed`, including a committed set version that does not increase.
- `SecureStoreError` extends `SuiteNativeError` with a typed `code`: `cancelled`, `background`,
  `lockout`, `unavailable`, `stale`, `full`, `invalid` or `failed`. Its message is the code alone;
  never expose native details or use native messages to infer a code. Unknown codes become `failed`.
- An aborted `get` rejects immediately with `cancelled`, requests native `cancel()`, drops late
  results and removes its listener. An already-aborted signal calls neither native method.
  `cancelled`, `background` and `lockout` never justify deleting a session.
- `refreshTokenKey({ issuer, webId, clientId })` (each a non-empty string, else TypeError) is
  `pod-auth:refresh:` plus the lowercase hex
  WebCrypto SHA-256 of `JSON.stringify([issuer, webId, clientId])`, without URL normalisation.
  Store only refresh tokens. Gate them when user presence is supported and unlock is enabled.
- Keep the root pure and `secureStorePlugin` in `./capacitor`. There is no web fallback;
  off native, keep IndexedDB. pod-auth wiring belongs to MOB-06 after T-031 lands.

<!-- AUTHORED-BY Codex GPT-6 -->
## Predecessor-session notice (MOB-P3d)

- `createSecureStore(plugin).takeMigrationNotice()` returns `Promise<boolean>`. Native
  `SuiteSecureStore.takeMigrationNotice()` takes no arguments and returns exactly
  `{ signInAgain: boolean }`, atomically consuming the pending notice. Validate the exact shape
  and map failures through `SecureStoreError`; never expose origin, namespace, key or value.
- Consume only on the native sign-in surface that can display “Sign in again to continue”.
  No web fallback. Remote shells return false. This method cannot perform migration.
- Migration stays native, before bridge startup, scoped to the complete validated
  `build-info.json.predecessorOrigins` plan. Check every artifact even with completion markers,
  persist notice intent before deletion, and preserve the current namespace and share inbox.
  Keep JVM/XCTest isolation, interruption and malformed-plan tests with changes to this seam.
