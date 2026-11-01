<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
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

`disable()` silences every registration and retains keys/maps/token for cleanup retries.
After relay deletion is confirmed, P2d calls `disable({deleteLocalData: true})` to drop the OS
token and erase local push material. `silence({registrationId})` affects one account only.
`setTopicMap` replaces a registration's topics and explicitly unsilences it; an empty topic
array forgets that registration after remote cleanup, freeing one of the four registration slots.
`installed` means local push keys exist. `consumeLaunchRoute()` returns the registration and local route once;
P2d must resolve/switch the account before navigating, falling back to `/notifications` for
signed-out accounts. Native Capacitor methods use a `{launchRoute: ... | null}` envelope;
the TypeScript binding unwraps it to the P13 result.

Signing keys stay in Android Keystore (StrongBox, then TEE/provider fallback) or the app-only
iOS Keychain group (Secure Enclave, then a permanent Keychain provider fallback).
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

The relay (P2a/b), `@jeswr/suite-native/push` registrar and UI (P2d), end-to-end push fixtures
(P2e), and Firebase/APNs credentials and signed provisioning (P2f/P1) remain separate work.
No production credentials are included.

Test from this directory with `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`.
Native CI already runs `android/gradlew lint testDebugUnitTest assembleDebug` and the App scheme's
Debug/Release XCTest `AppTests` bundle, which includes push tests. Both native suites contain
the [RFC 8291 §5 vector](https://www.rfc-editor.org/rfc/rfc8291#section-5), random-key round trips,
tamper/size/schema rejection, routes, dedupe, grouping, silence, locked-state and activation seams.
Hardware key backing, APNs/FCM delivery, direct boot, OS permission prompts, extension expiry,
and concurrent delivered-notification replacement still require native CI/device verification.
