<!-- AUTHORED-BY GPT-5.6 Codex -->
<!-- AUTHORED-BY Codex GPT-6 -->
# Mobile native WebView end-to-end harnesses (MOB-07)

iOS secure-store accepted residual (S4/S9): a commit after the final generation check but before Capacitor's queued JavaScript delivery may expose an already unlocked value to the allowed same-origin replacement document's `Capacitor.fromNative` wrapper; S9 cancels prompts and does not withdraw unlocked values.

## Android emulator

This runs DESIGN D2/D3/D7/D8 checks against the actual debug WebView without depending on
MOB-06 or the deployed suite. Requires Node 24, pnpm, Java 21, an Android SDK and a booted
API 34/35 emulator with a current System WebView. No npm dependencies are added.

From the workspace root, on a machine allowed to build Android:

```sh
pnpm install --frozen-lockfile
SUITE_URL=http://localhost:4173 MOBILE_DEBUG=1 pnpm --filter @jeswr/app-mobile run sync:android
cd apps/mobile/android
./gradlew --no-daemon --stacktrace assembleDebug
cd ../../..
node apps/mobile/e2e/android-e2e.mjs
```

`sync:android` runs `prepare-www.ts` first (writes `www/offline.html` and the iOS
app-bound domain), then `cap sync android`. Sync serializes `server.url` and debug settings
into the Android assets; changing the environment only when running the driver is too late.
The fixture is served remotely, so do **not** copy it into `www/`. Its required bundled
`index.html` remains the fallback. `prepare-www` also changes the tracked iOS Info.plist;
after a local fixture build, run `pnpm --filter @jeswr/app-mobile run www` with the default
environment to restore its production domain. Never commit a localhost plist.

The driver starts two HTTP listeners on **127.0.0.1**, reverses ports **4173** and **4174**
through adb, installs only `android/app/build/outputs/apk/debug/app-debug.apk`, clears that
app's emulator data and launches `org.jeswr.suite/.MainActivity`. Use a disposable emulator.
`ANDROID_SERIAL` selects it; otherwise exactly one connected device must exist and be an
emulator. The suite origin is consistently `http://localhost:4173`; hostile iframe and
foreign navigation target use `http://localhost:4174`. This intentionally exercises exact
port checks as well as secure loopback contexts. To change ports, set `E2E_PORT` and
`E2E_IFRAME_PORT` for the driver and build with the matching `SUITE_URL`.

Port **9222** must be free. The driver selects only the app PID's
`webview_devtools_remote_<pid>` socket from `/proc/net/unix`, forwards it without replacing
an existing forward, discovers the exact suite page via `/json/list`, and uses the Node 24
global `WebSocket` and `fetch` for CDP. It removes its forwards/reverses, stops the app and
closes both servers on completion. Every adb command and CDP request has a timeout.

Checks require explicit evidence and exit nonzero on failure:

- `crypto.subtle`, Web Locks, service worker API presence, and `isSecureContext`.
  This checks API availability, not registration or persistence of a service worker.
- A successful top-frame `SuiteShareIntake.getPending` and share listener registration.
- Real `SuiteSecureStore` calls through the trusted top frame's Capacitor bridge: `status`,
  ungated set/get with exact value and version, stale rejection, a current-version update,
  remove/get-null, and clear/get-null for two populated keys. A fresh plaintext marker remains
  stored until the host lists and base64-reads every file under `no_backup/securestore/` with
  `adb shell run-as org.jeswr.suite`. A non-empty state `.bin` must exist, and the decoded
  bytes must contain neither the marker's UTF-8 nor UTF-16LE encoding. The host then clears
  the retained item. This exercises AndroidKeyStore and native bridge serialization.
- An unsandboxed cross-origin iframe tries the legacy bridge, cookie/HTTP interfaces,
  Capacitor plugin proxy and the WebMessage listener. Capacitor 8.5.3 names both bridge
  transports `androidBridge`. Exposed native surfaces fail even without a response.
  A plugin wrapper with no response or an identified Capacitor `UNIMPLEMENTED` rejection is
  accepted only when all native transports are absent; unexpected probe exceptions fail;
  malformed, missing and timed-out iframe results fail. Parent messages check source,
  exact origin and a fresh nonce. There is no CSP masking native isolation failures.
  The same frame also tries secure-store get/set through every Android probe channel. Every
  call must remain without a native reply over at least two seconds; unexpected errors,
  exposed native transports and replies delivered into the main document fail.
- Two independent gated set/get attempts drive the real system authentication UI. The host
  first inspects `locksettings get-disabled` and verifies with no old credential, refusing to
  change an already secured emulator. It arms PIN cleanup **before** attempting to set disposable
  PIN `1234`, then verifies that PIN, opens `android.settings.FINGERPRINT_ENROLL`, advances
  recognized setup controls and sends repeated `adb emu finger touch 1` events. Fingerprint
  enrollment must be confirmed by `dumpsys fingerprint` before that path is attempted.
  One get is unlocked with a sensor touch; the other selects the device credential control
  and enters the PIN with `input text 1234` and `input keyevent 66`. A pass requires an
  observed prompt, authentication input and the exact decrypted value and committed version.
  Returning before input, native errors and mismatched values fail. The complete native
  `status()` response must have `available === true` and boolean `userPresence` / `hardwareBacked`
  fields. Runner capability comes from verified PIN setup and confirmed enrollment, independently
  of the plugin. A false `userPresence` despite a verified PIN, an unavailable store, or malformed
  status fails; the plugin cannot suppress its own gated tests.
  Before each gated read, the host also checks that the UI dump contains readable nodes.
  Only independent capability failures collected **before starting the gated read** record
  `not automatable`: `PIN setup failed`, `fingerprint enrollment failed`, or
  `UI dump unreadable before gated read`. Each skip must include `evidence.phase` equal to
  `before-gated-read`, the independent source (`runner setup` or `uiautomator`) and its failed
  probe result; setup verdicts retain the runner's PIN/enrollment details and native status,
  and UI verdicts retain the dump/error. `gatedReadStarted`, `authenticationAttempted`,
  `authenticationSent` and `authenticationConfirmed` must all explicitly be false.
  The verdict validator rejects missing evidence, evidence collected after the read or an
  authentication attempt, contradictory results, and native read outcomes used as skip evidence.
  The verdict is printed as `not automatable on this runner: ...`.
  Once the read starts, missing prompts, unavailable controls, UI errors and timeouts fail.
  A pending read with no prompt fails with `gated read pending but no system prompt appeared`,
  even when no authentication input was sent. A UI dump showing the app again with the
  authentication prompt dismissed confirms the sent input; if the native get still never
  replies, the failure reason is
  `native callback never resolved after confirmed authentication`.
  Both paths are reported separately; a skip never counts as a passing unwrap. Pending prompts
  are cancelled and the store cleared between attempts. In `finally`, every attempted PIN setup
  triggers `locksettings clear --old 1234`, even if setup timed out or its reply was ambiguous.
  Cleanup accepts an already absent credential, then verifies no old credential is needed;
  other errors or a credential that remains installed fail the run.
- A unique ACTION_SEND text (including quotes and shell metacharacters) must appear as exactly
  one item in one pending batch. A document identity token recorded before sending requires
  exactly one matching listener event when the original document survives; pending alone
  suffices only after a reload. It is then acknowledged so the rejection check starts empty.
- A **readable existing** app-private file URI is sent with typed `--eu EXTRA_STREAM` and a
  unique text sentinel. The entire batch must be rejected: no pending batch or listener
  event after the receiver finishes. A fresh control text share through the same receiver's
  single-thread executor proves completion of the preceding file request. Exactly the control
  batch and its matching event (if the document survives) may arrive; after acknowledging it,
  the inbox and listener history must be empty. This cannot pass because the file is missing
  or because an activity disappeared before processing.
- `/navigation.html` tries `location.assign` to the foreign origin. After a bounded two-second
  observation window, the driver requires that same navigation document and suite origin to
  survive, including after foregrounding the app. An external browser may open as designed.

`e2e/artifacts/report.json` records every step, fixture evidence, share results and the explicit
real-suite deferral. Its `secureStore` member contains `ungated`, `disk` (file paths, byte counts
and plaintext absence), `cleanup`, `setup`, post-setup native `status`, and independent
`gated.fingerprint` / `gated.credential` verdicts (`passed`, `failed`, or `not automatable` with
`reason` and setup/UI/prompt evidence). Only independently evidenced capability failures before
the gated read may skip the gated step. CI uploads the report on success as well as failure,
so runner limitations remain reviewable; `logcat.txt` is collected on driver failure.
CI also uploads emulator logs and logcat on any failed step. `.github/workflows/mobile.yml` provisions KVM and boots
the AVD using SDK tools directly. Native compilation, emulator/CDP behavior and actual bridge
isolation are verified there; they cannot be verified in the cloud development container.

Secure-store manual checks still include either authentication path reported as not automatable
on that runner, physical-device biometric/PIN UX, hardware backing (an emulator may report false),
enrollment changes/key invalidation, lockout, background/cancellation races, and backup/restore
behavior. This Android lane does not claim iOS secure-store or real-session refresh coverage.
All secure-store fixture code is served remotely from `e2e/fixture`; `prepare-www` never copies
it into bundled assets or Release builds.

For a host-only fixture smoke test (not evidence of native bridge isolation):

```sh
node apps/mobile/e2e/fixture-server.mjs
# In another terminal:
curl --fail http://127.0.0.1:4173/health
curl --fail http://127.0.0.1:4174/hostile.html
```

Run the pure assertions, socket parser, quoting and fixture server tests with:

```sh
pnpm --filter @jeswr/app-mobile test
```

## iOS simulator (MOB-07b)

The same fixture suite runs inside the **real WKWebView of the Debug app**, driven only
through XCUITest accessibility. Requires macOS, Node 24, pnpm, Xcode 26+ and an available
iPhone simulator with iOS 16+. Use a disposable simulator with no existing share inbox.
The simulator shares the host's loopback: the two listeners remain on **127.0.0.1:4173/4174**,
with document origins **http://localhost:4173/4174**. No adb or port forwarding is involved.

From the workspace root, after selecting Xcode and booting the simulator:

```sh
SUITE_URL=http://localhost:4173 MOBILE_DEBUG=1 pnpm --filter @jeswr/app-mobile run sync:ios
TEST_DESTINATION='platform=iOS Simulator,id=<simulator UDID>' node apps/mobile/e2e/ios-e2e.mjs
```

The destination can also be the driver's first argument. Custom fixture ports use the same
`E2E_PORT` / `E2E_IFRAME_PORT` settings and require syncing the matching `SUITE_URL` first.
`sync:ios` runs `prepare-www.ts` before Capacitor sync, writes `WKAppBoundDomains` to the suite
hostname, and generates `NSAppTransportSecurity/NSAllowsLocalNetworking` **only** when
`MOBILE_DEBUG=1` and `SUITE_URL` names `localhost` or `127.0.0.1`. There is no arbitrary-loads
exception. A subsequent `pnpm --filter @jeswr/app-mobile run www` with the default production
environment removes that generated exception and restores the production domain.
**Never commit a localhost plist.** The committed production plist has no ATS exception.

The App target's `Guard non-Debug ATS` build phase runs on every build after resources and
extension copying. Its declared input is the processed **built product** Info.plist; every
configuration other than `Debug` fails if that plist contains any `NSAppTransportSecurity`
entry, including `NSAllowsLocalNetworking`, or cannot be validated. This also protects Release
builds and archives after fixture sync, regardless of the build's `MOBILE_DEBUG` environment.
The input plist and output stamp are declared for Xcode's user script sandbox.
The `ios` CI job prepares the loopback exception after the Debug compile, requires an unsigned
Release simulator build with script sandboxing enabled and `MOBILE_DEBUG` unset to fail with
the guard's message, and restores default preparation before running Debug/Release policy tests.

The shared App scheme includes AppTests and the new AppUITests target; this driver runs
`xcodebuild test -configuration Debug -only-testing:AppUITests`. The fixture publishes
`window.__e2e` as JSON in a read-only textarea labelled `e2e-result`, whose native accessibility
value can be read without injecting JavaScript. The UI test waits with bounded element queries
and predicates, attaches `e2e-result.json` with `keepAlways`, follows the navigation fixture
link and taps its foreign link (which calls `location.assign`). It reads the document before
the attempt, after the two-second observation window, and after backgrounding/foregrounding.
`e2e-navigation.json` preserves all three snapshots, including their document identity and URL.
There are no test-only hooks in the application target.

Result polling regains the foreground if the asynchronous external-browser handoff arrives after
`activate()`. If the result disappears or WebContent accessibility stops responding, timeout
diagnostics use the last cached value length without querying the vanished element. The
`e2e-debug.txt` attachment records the expected page, done flag, exact navigation step, WebView
presence and application hierarchy. The host retains these diagnostics through both bulk and
legacy attachment export, including when navigation evidence is missing.

Secure-store reads are cancelled through observations of the main WebView's URL and loading
state (including reloads of the same URL). Capacitor retains its original navigation delegate,
which owns bridge reset, navigation policy and WebContent-process reload. The secure-store
fixture script is loaded only by the Android paths in both frames; iOS keeps its existing
share-intake/prompt probes and does not wrap `toNative` for Android secure-store checks.

The iOS checks require all four secure-context APIs and a successful top-frame
`SuiteShareIntake.getPending`. On iOS, `addListener` returns a JS removal handle synchronously,
so the fixture reports only `listenerSubscriptionRequested`; this field is excluded from pass
criteria. Native listener verification needs a real `shareReceived` event and is deferred with
share-sheet intake. Android still requires listener registration and a matching real event
when the document survives. iOS hostile-frame probes differ because WebKit exposes registered handler
names in every frame: visibility alone cannot establish a native effect. The hostile frame
sends a typed `SuiteShareIntake.getPending` message with a fresh callback ID through
`window.webkit.messageHandlers.bridge`, and observes for at least two seconds. An identical
top-frame call must resolve with a valid batch array. Capacitor 8.5.3 delivers even iframe
plugin replies into the **top document**, so the fixture also observes `Capacitor.fromNative`
there and rejects any hostile callback response, including native errors.

Capacitor 8.5.3 has **no plugin-call prompt bridge**: its prompt delegate accepts synchronous
cookie/HTTP commands. Sending `getPending` through prompt would open an ordinary JavaScript
dialog in the top frame. Instead both frames send the actual `CapacitorCookies.isEnabled`
prompt command. A native `"true"` or `"false"` top-frame response proves the channel works;
the hostile frame must receive only `null`, observed over the same window. Missing transports,
exceptions, missing evidence and failed top-frame controls fail; silent calls in both frames
never prove isolation. These verdicts live in the shared `checks.ts` and have host unit tests.

The host exports xcresult attachments with `xcrun xcresulttool export attachments`, with
legacy object/ref traversal and export fallbacks for older CLI spellings. Missing, malformed
or duplicate result attachments fail. It applies `checks.ts` to the exported fixture and
navigation JSON, requires an empty share inbox, and writes `artifacts/report-ios.json`.
Every subprocess has a timeout (25 minutes for xcodebuild; one minute for each xcresulttool
invocation); both fixture servers close in `finally`, including when XCTest/export fails.
`artifacts/AppUITests.xcresult`, `ios-attachments/` and `xcodebuild-ios.log` retain diagnostics.

The `ios-e2e` job runs on `macos-15` with a 45-minute job timeout, mirrors the policy job's
Xcode 26+ and iPhone selection, and waits for `simctl bootstatus <udid> -b` with a four-minute
subprocess timeout before syncing the fixture build. It uploads the xcresult bundle and all
artifacts on failure. The `ios` policy job restores production preparation after its expected
Release guard failure.
Swift compilation, WKWebView accessibility behavior, actual simulator bridge isolation, and
xcresulttool execution require that macOS CI run; Linux host tests cannot verify them.

**iOS share-in via another app's share sheet is deferred:** XCUITest cannot reliably drive
another application's share sheet into this Share Extension. This lane does not simulate
share-in through a debug bridge. `report-ios.json` records `shareIn` and `shareListener` as
`deferred`, separately from the real-suite Android scenario below. A subscription
request alone never establishes native listener registration or delivery.

## Real-suite Android scenario (MOB-07, sst-8wx.7)

`android-real-suite.mjs` runs separately from the fixture drivers and writes
`artifacts/report-real-suite.json`. It builds and installs a **separate debug APK** from the
real native export. It never assumes fixture globals or inserts sessions/tokens into the
WebView. The fixture report's legacy real-suite deferral describes that fixture's scope;
this scenario supplies the separate integration evidence.

Requires Node 24, pnpm, OpenSSL, Java 21, Android SDK 36/build-tools 36.0.0 and a **disposable,
booted API 35 google_apis x86_64 emulator with Chrome and adb root**. The driver clears both
Chrome and suite app data and selects Chrome as the default browser. `ANDROID_SERIAL` selects
the emulator; otherwise exactly one connected device must be a booted emulator. Ports
**8443**, **9223** and **9224** must be free. No Playwright/browser download or new dependency
is needed: Custom Tab automation uses Chrome's on-device DevTools socket.

From the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter='@jeswr/app-suite^...'
ANDROID_SERIAL=emulator-5554 node apps/mobile/e2e/android-real-suite.mjs
```

The driver owns these seven scenarios, each with bounded readiness/result waits and a report entry:

1. Start the existing **CSS 7.2.0** pin from `tools/storage-conformance`, isolated using the web
   suite's Components.js dependency-closure approach. Its in-memory backend listens on a private
   temporary Unix socket behind a TLS listener bound only to **127.0.0.1:8443**. Seed a fresh
   account, password login and pod through the same CSS account controls as `shell-css`, with
   CSS's own profile templates providing name and storage links. Host-only client credentials
   arrange a private text file and verify its exact body. Require anonymous **401/403**.
   Serve `mobileClientIdDocument` at its exact local HTTPS client ID, dereferenceable by CSS.
2. Build the real `build:native` export with `NEXT_PUBLIC_APP_BASE_URL=https://localhost`,
   `NEXT_PUBLIC_PUBLIC_SUITE_URL=https://127.0.0.1:8443`, and
   `NEXT_PUBLIC_CLIENT_ID_URL=https://127.0.0.1:8443/.well-known/solid-client-id-mobile.jsonld`.
   CSS uses the IP literal because bundled builds refuse every other `localhost` origin.
   Sync with `SUITE_MODE=bundled MOBILE_DEBUG=1`, verify no remote `server.url`, compile
   `assembleDebug`, and retain a separate APK in the private temporary directory. No production
   defaults change; the existing `org.jeswr.suite:/oauth/callback` scheme remains registered.
3. Reverse 8443 through adb, install that APK, clear the suite's data and launch its real
   `https://localhost` WebView. Only its PID's DevTools socket is selected. The app is bundled;
   no fixture HTTP server participates.
4. Submit the suite's WebID form. Observe the actual Chrome Custom Tab activity, drive CSS's
   real email/password and consent forms through **the Custom Tab's CDP**, and wait for the
   signed-in Home greeting from the suite's ready PodSession. CSS's outgoing scheme redirect must contain code/state/iss;
   only a boolean is retained. The signed-in app and subsequent private read establish completion
   of the native callback/token exchange; the suite's own driver validates state and issuer.
   Require CSS to have fetched the Client ID Document. A login timeout **fails**, with no skip.
5. Assert anonymous denial again, then open the actual Drive file preview route. Its production
   `client.read()` goes through `PodSession.fetch`; read `.drv-preview-text` over CDP and compare
   **the complete body exactly**, including newline and Unicode. No token is extracted.
6. Send a unique `ACTION_SEND` text, including shell metacharacters, and require exactly that
   item on `/share` with “Save to Suite” and the controls that render only for a ready
   signed-in ShareSession. Discard through the UI.
7. Create a real external MediaStore PDF, write and read back its exact source bytes, then send
   its typed `content://media/external/file/...` URI with a read grant using `ACTION_SEND`.
   Require its exact name, MIME type and byte count in the signed-in `/share` screen
   (the shared-item list renders only after its session is ready).
   Discard through the UI. No pod save is triggered.

Each run creates a two-day localhost certificate and private key outside the repository. Node
trusts that certificate through `NODE_EXTRA_CA_CERTS`. The debug APK temporarily includes that
single certificate as a debug trust anchor. Chrome's test command line bypasses certificate
errors only for that certificate's SHA-256 SPKI; it does not disable web security or OAuth
validation. This tests native auth with a local TLS service, not public CA deployment.
The driver restores the original iOS plist, Capacitor Gradle files/config and Android debug
network policy in `finally`, removes its temporary trust resource, forwards/reverse, Chrome
flags, source MediaStore entry, CSS server and temporary key/APK directory, and stops both apps.
It leaves the chosen browser and cleared app data on the disposable emulator.

Reports contain public evidence and fixed failure labels only. CSS/subprocess output and CDP
console/network events are never printed. Credentials enter only CSS's actual system-browser
form; protocol values are never returned by CDP or written to the report. Failure logcat is
redacted before writing `artifacts/logcat-real-suite.txt`; callback URLs, token/credential lines
and disposable secrets are removed. The independent
`.github/workflows/mobile-real-suite.yml` uses the existing KVM/SDK/AVD setup and action versions,
runs on scoped PRs/main pushes, and uploads the report, emulator log and sanitized logcat.
The existing `mobile.yml` fixture job remains independent and unchanged.

Host-only checks:

```sh
pnpm --filter @jeswr/app-mobile test
node --check apps/mobile/e2e/android-real-suite.mjs
node --check apps/mobile/e2e/real-suite-server.mjs
# Starts/seeds/verifies CSS and shuts down, without an APK or sign-in claim:
node apps/mobile/e2e/android-real-suite.mjs --seed-only
```

`--seed-only` records `status: "seed-only"`, never an end-to-end pass. It still requires local
socket/listener permission. The host tests cover fail-closed login/private-body verdicts, share
intent arguments/quoting, signed-in share DOM verdicts, report completion and log redaction.

This lane proves the native browser leg, scheme return, authenticated private pod read and
Android text/file intake **only when its emulator run passes**. Host tests and seed-only runs
cannot establish those properties. It does not prove refresh/restore across process death,
secure-store biometric behavior (covered separately by the fixture), saving incoming shares to
a pod, file byte identity after intake, share-out/chooser UX, public TLS deployment, physical
devices, iOS sign-in or iOS share-sheet intake. Those limitations remain explicit.
