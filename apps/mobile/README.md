<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# Solid Suite mobile shells

Capacitor iOS and Android shells around the suite origin. Native plugins use the existing
D3 bridge-origin guard. Run `pnpm run sync:android` / `pnpm run sync:ios` before native builds.
See [the emulator fixture guide](e2e/README.md) for share, sign-in and bridge isolation checks.

## Push (MOB-P2c)

`src/push.ts` declares and registers `SuitePush`: status, permission/token enablement, public
keys, topic maps, local silence, installation proofs, activation, disable and one-shot launch
routes. Android uses pinned Firebase Messaging 24.1.2 (including direct-boot support); an
unconfigured build runs normally and `enable()` rejects with `push-unavailable`. iOS embeds
`NotificationService.appex` alongside the Share Extension. Neither platform renders HTML.
Android rejects all `gcm.n.*` / `gcm.notification.*` extras before Firebase's automatic display
logic, with notification delegation and token auto-init disabled. Token requests time out after
30 seconds. When unlocked, overflow notices require an unsilenced registration under the same
lock used by local silence; direct boot keeps the generic fallback.

Every `enable()` requests the current provider token (APNs registration on iOS, Firebase
`getToken()` on Android) and waits for its callback, even after a previous enable succeeded.
Unsolicited APNs and FCM token updates persist token hashes without changing local silence.
`status().registrationStale` is true when an unsilenced registration's current token has not
been acknowledged, including older topic maps without token metadata. P2d must check it on
launch/resume, call `enable()`, update the relay installation and complete the new activation
challenge. Only after the relay confirms activation should it pass that `pushToken` to
`setTopicMap({registrationId, topics, pushToken})` to acknowledge the update. The acknowledgment
is atomic with the topic map and rejects if another rotation has already occurred; omitting
`pushToken` does not clear staleness. No provider tokens are logged or persisted in the topic store.

The RFC 8291 decryptor accepts one RFC 8188 aes128gcm record. Suite plaintext must be exactly
512 UTF-8 bytes, padded with trailing spaces, with only `v`, `id`, `kind`, `registrationId`,
`topicIndex`, `sentAt` and (for challenges only) `nonce`. `sentAt` is a nonnegative Unix integer;
indices are 0–15. IDs use ASCII letters, digits, `_` and `-` (1–128 characters).
Chat routes contain one unreserved ID segment; percent escapes and dot segments are refused.
Challenges put the **installation ID in `registrationId`** and a base64url 16-byte nonce in
`nonce`; this lets activation correlate an early challenge before any topic map exists.

P3 specifies signed fields but no proof serialization. The local contract is compact ES256
JWS: protected header `{"alg":"ES256"}`, sorted JSON payload `{bodyHash, method, timestamp, url}`,
64-byte JOSE signature. `timestamp` is native Unix seconds; `bodyHash` is base64url SHA-256 of
the exact UTF-8 `body` string (default empty). The caller sends `sign()`'s `{proof}` value as
`Installation-Proof`. The relay implementation must agree on this encoding.

`disable()` synchronously silences every registration before invalidating pending permission/token
callbacks; late callbacks cannot finish the cancelled enable. It retains keys/maps/token for cleanup retries.
After relay deletion is confirmed, P2d calls `disable({deleteLocalData: true})` to drop the OS
token and erase local push material. `silence({registrationId})` affects one account only.
`setTopicMap` replaces a registration's topics and explicitly unsilences it; an empty topic
array forgets that registration after remote cleanup, freeing one of the four registration slots.
`installed` means local push keys exist. Taps persist only `(registrationId, topicIndex)`.
`consumeLaunchRoute()` resolves the current map atomically and returns the registration and local route once;
silenced, disabled or removed topics fall back to `/notifications`, and forgotten registrations return
`registrationId: null` with that fallback route.
P2d must resolve/switch the account before navigating, falling back to `/notifications` for
signed-out accounts. Native Capacitor methods use a `{launchRoute: ... | null}` envelope;
the TypeScript binding unwraps it to the P13 result.

Signing keys stay in Android Keystore (StrongBox, then TEE/provider fallback) or the app-only
iOS Keychain group (Secure Enclave, then a permanent Keychain provider fallback).
The fallback uses a separate ThisDeviceOnly access control without the Enclave-only private-key-usage flag.
The plugin exposes signing operations only. Software signing fallback requires the provider to report
non-extractability; otherwise enable fails with `push-unavailable`. Android wraps decryption material with Keystore AES-GCM in `noBackupFilesDir/push/`. iOS shares only decryption
material through `$(AppIdentifierPrefix)org.jeswr.suite.push`, AfterFirstUnlockThisDeviceOnly,
never synchronised; protected labels/dedupe/counts live in `group.org.jeswr.suite/push/`.

Before first unlock Android posts generic activity; iOS preserves the generic placeholder,
as it does on NSE timeout/failure/silence. Filtering is **off**: enabling it requires Apple's
entitlement, `SUITE_PUSH_FILTERING`, and `SuitePushFilteringEnabled=true`; the entitlement is
not included in unsigned builds. The NSE cannot change an APNs request's immutable identifier.
Without filtering it removes the previously delivered notification for the same topic and
replaces the remote content with a count. With filtering it suppresses that remote notification
and issues a local request using the stable topic identifier. Different topics have different
keys (first 16 SHA-256 bytes of UTF-8 `registrationId:topicIndex`, lowercase hex).
The NSE and iOS foreground delegate claim payload IDs and increment counts in the same App Group
file transaction. A persisted, request-bound, one-use native token allows the accepted NSE delivery
to become one local foreground replacement. Duplicate deliveries within the last 50 IDs are suppressed.
Local callbacks consume their own one-use permit and revalidate content and current silence state.
NSE fallback placeholders strip `p` and native presentation metadata, including on duplicate rejection
and timeout. Foreground deliveries without NSE processing use the same dedupe and count updates.

The relay (P2a/b), `@jeswr/suite-native/push` registrar and UI (P2d), end-to-end push fixtures
(P2e), and Firebase/APNs credentials and signed provisioning (P2f/P1) remain separate work.
No production credentials are included.

Test from this directory with `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`.
Native CI already runs `android/gradlew lint testDebugUnitTest assembleDebug` and the App scheme's
Debug/Release XCTest `AppTests` bundle, which includes push tests. Both native suites contain
the [RFC 8291 §5 vector](https://www.rfc-editor.org/rfc/rfc8291#section-5), random-key round trips,
tamper/size/schema rejection, routes, dedupe, grouping, silence, locked-state and activation seams.
Regression tests also cover background FCM display rejection, cancelled enable callbacks, topic-map
changes between tap and consumption, overflow after disable, unsolicited provider token rotation and
durable relay-refresh state, and actual Keychain fallback creation/signing
through the injected Security provider on the iOS simulator. That test requires real generation, then
asserts acceptance/reload only when the provider reports non-extractability; exportable software keys
must be rejected and deleted, including on the simulator.
Hardware key backing, APNs/FCM delivery, direct boot, OS permission prompts, extension expiry,
and concurrent delivered-notification replacement still require native CI/device verification.

<!-- AUTHORED-BY Codex GPT-6 -->
## Predecessor secure-store migration (MOB-P3d)

Bundled builds read `public/build-info.json` before the Capacitor bridge starts. The suite
export's `PREDECESSOR_ORIGINS` setting is baked as `predecessorOrigins`, defaulting to the
public deployed suite origin (`https://solid-suite.vercel.app` by default). Use a JSON array
of at most 32 canonical https origins; duplicates are removed by the exporter. `[]` is an
explicit empty migration plan. Paths (including `/`), userinfo, queries, fragments,
noncanonical spellings, port zero, and `localhost` / `.localhost` hosts are rejected.
`prepare-www` checks the list before copying, and both native implementations validate the
entire list again before deleting anything. Sync-time environment variables do not override it.

Android migrates in `MainActivity.load()` before `super.load()`; iOS migrates while preparing
the web-view configuration, before `CapacitorBridge` construction. Only the listed namespaces'
state files and their exact Keystore alias prefixes or Keychain service/key tags are deleted.
The Android adapter also removes namespace-scoped interrupted-write temporary files.
The current origin, unlisted origins and pending share batches are untouched. No token is
read, decrypted or logged. Remote builds skip migration. Invalid metadata or storage failures
fail closed before starting the bridge.

A no-backup `securestore-migration` journal records notice intent before deletion and marks
each predecessor complete only after its file and keys are removed. Every startup checks
artifacts again, even with a marker, to resume interrupted deletion. `SuiteSecureStore` adds
only `takeMigrationNotice()` → `{ signInAgain: boolean }`, which atomically consumes the
pending notice. It accepts no origin or namespace and performs no migration. The native
sign-in surface displays “Sign in again to continue” once; fresh installs show no notice.
The JVM and XCTest migration tests cover partial artifacts, retries, malformed plans, namespace
isolation, inbox retention and consumption failures. Android Gradle and iOS XCTest remain
required CI checks, including the real Keychain namespace-deletion test on the simulator.
