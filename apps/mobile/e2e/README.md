<!-- AUTHORED-BY GPT-5.6 Codex -->
# Android emulator fixture harness (MOB-07a)

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
- An unsandboxed cross-origin iframe tries the legacy bridge, cookie/HTTP interfaces,
  Capacitor plugin proxy and the WebMessage listener. Capacitor 8.5.3 names both bridge
  transports `androidBridge`. Exposed native surfaces fail even without a response.
  A plugin wrapper with no response or an identified Capacitor `UNIMPLEMENTED` rejection is
  accepted only when all native transports are absent; unexpected probe exceptions fail;
  malformed, missing and timed-out iframe results fail. Parent messages check source,
  exact origin and a fresh nonce. There is no CSP masking native isolation failures.
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
real-suite deferral; `logcat.txt` is collected on driver failure. CI also uploads emulator
logs and logcat on any failed step. `.github/workflows/mobile.yml` provisions KVM and boots
the AVD using SDK tools directly. Native compilation, emulator/CDP behavior and actual bridge
isolation are verified there; they cannot be verified in the cloud development container.

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

## Real-suite follow-up

The MOB-07 work tracked by **sst-8wx.7** retains the MOB-06-dependent real sign-in and
authenticated pod read check. This fixture run explicitly records it as `deferred`, never
as passing. The phase boundary is the fixture driver's exit and cleanup: add a following CI
step that syncs/builds/installs a **separate debug build** whose SUITE_URL serves the real
suite, then runs a dedicated real-suite scenario driver with its own report. Fixture globals
must not be assumed there. Keep the fixture checks running independently.

The follow-up must seed a pinned local CSS instance, drive the real suite's native sign-in
through the Custom Tab and scheme callback, and read a private pod resource through the
suite's authenticated fetch. First assert an anonymous 401/403 for that resource and then
assert the exact authenticated body. Wire readiness and result evidence through a dedicated
scenario function, with login timeout as a failure. Do not emulate successful sign-in with
fixture JavaScript, pass credentials/tokens through CDP logs, or label this run a sign-in test.
