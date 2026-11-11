<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/suite-native

> **Experimental — AI-agent-generated.** Security critical (`securityCritical: true`).

The seams the Solid Suite web app uses when it runs inside the iOS and Android shells
(`apps/mobile`, Capacitor 8). Design of record: `solid-suite-planning/specs/mobile/DESIGN.md`.

| Export | What it does |
|---|---|
| `platform()`, `isNativeApp()` | `"ios" \| "android" \| "web"` from the injected `Capacitor` global; no Capacitor import. |
| `createNativeCodeDriver({ plugin, redirectUri, resolveIssuer })` | pod-auth's `ui.getCode` for the apps: opens the system browser (ASWebAuthenticationSession / Custom Tabs) and returns the authorization code after fail-closed checks on the request (https, PKCE S256, one `state`, our `redirect_uri`) and the callback (exact redirect, matching `state`, one `code`, exactly one RFC 9207 `iss` equal to the resolved issuer, error responses as `AuthorizationError`). With `returns: "callback"` it resolves with the validated callback URL instead, error responses included, so pod-auth's RFC 9207 check runs before it rejects them; `resolveIssuer` is then optional. |
| `share(content, { native, web })` | Native share sheet, else Web Share, else `ShareUnavailableError`. |
| `stageFile(blob, { name, mimeType? }, plugin, limits?)`, `shareFiles(files, content, { staging, native })` | Stage already fetched bytes in bounded chunks, then share native file URIs. |
| `createShareInbox(plugin)`, `validateShareBatch()` | Validated `ShareBatch`es from other apps, chunked size-checked file reads, acknowledgement. |
| `createSecureStore(plugin)`, `refreshTokenKey({ issuer, webId, clientId })` | Validated native refresh-token storage, versioned writes, cancellable unlocks and session identity keys (MOB-P4 S11/S12). |
| `openPdf(plugin, name, bytes, signal?)` | Drive's native "Open PDF" (MOB-P3 E5): checks the 25 MiB cap and `%PDF-` signature, sends 1 MiB base64 chunks to `SuiteFiles`, opens the platform viewer; aborting `signal` stops before the next native call. Failures are `PdfPreviewError` with code `too-large`, `not-pdf`, `no-viewer`, `cancelled` or `failed`. |
| `clearPdfPreviews(plugin)` | Call on sign-out or account switch: drops any transfer, closes QuickLook on iOS and deletes every cached preview file. Failures are `PdfPreviewError` with code `failed`. |
| `mobileClientIdDocument({ origin })` | The `application_type: native` Client Identifier Document for `org.jeswr.suite:/oauth/callback`. |
| `@jeswr/suite-native/capacitor` | Native plugin bindings (`SuiteAuthSession`, `SuiteShareIntake`, `SuiteShareStaging`, `SuiteFiles`, `SuiteSecureStore`, `Share`). Import only inside the app shell. |

```ts
import { createNativeCodeDriver, isNativeApp, MOBILE_REDIRECT_URI } from "@jeswr/suite-native";
import { authSessionPlugin } from "@jeswr/suite-native/capacitor";

const getCode = createNativeCodeDriver({
  plugin: authSessionPlugin,
  redirectUri: MOBILE_REDIRECT_URI,
  // The issuer identifier pod-auth discovered for this authorization URL.
  resolveIssuer: (url) => issuer,
});
// createPodAuth({ clientId: `${origin}/.well-known/solid-client-id-mobile.jsonld`,
//                 redirectUri: MOBILE_REDIRECT_URI, ui: { getWebId, getCode } })
```

<!-- AUTHORED-BY GPT-5.6 Codex -->
Share a pod file after the caller downloads it with its authenticated fetch:

```ts
import { shareFiles } from "@jeswr/suite-native";
import { shareStagingPlugin, sharePlugin } from "@jeswr/suite-native/capacitor";

const response = await authFetch(podFileUrl);
if (!response.ok) throw new Error("Download failed");
await shareFiles(
  [{ blob: await response.blob(), name: "report.pdf", mimeType: "application/pdf" }],
  { title: "Report" },
  { staging: shareStagingPlugin, native: sharePlugin },
);
```

`stageFile` reads sequential Blob slices of at most 512 KiB, base64-encodes each slice,
and calls `begin` → `writeChunk` → `commit`. It sanitises names, validates native IDs and
URIs, and attempts `abort` on every failure after a valid ID is allocated. Optional
`maxFileBytes` and `chunkBytes` limits can only lower the 100 MiB and 512 KiB caps.
No credentials or fetch URLs enter the staging plugin. `shareFiles` accepts 1–20 files,
preflights their combined size against the 100 MiB cache cap, and calls `share()` with
the resulting `files` array. It requires native sharing.

Both platforms return `file://` URLs: Capacitor Share 8.0.3 on Android wraps those paths
in its FileProvider; iOS passes the file URLs to its activity controller. Android exposes
only `cache/share-out/` through that provider; iOS uses `tmp/share-out/`. Native stores
validate metadata and contiguous offsets, reserve declared sizes for active uploads,
reject incomplete commits, and retain committed files after completion or dismissal.
On startup and staging access they delete files older than 24 hours and evict the oldest
committed files to keep at most 20 files and 100 MiB total. Active uploads cannot be
evicted for capacity, and nor can the files `shareFiles` has already staged for the same
share (it passes their ids as `keep`); a new upload fails when those fill the cache. On iOS
the shell replaces the `Share` plugin with one that shares only committed share-out files.

Store only refresh tokens through the injected `SuiteSecureStore` plugin:

```ts
import { createSecureStore, refreshTokenKey } from "@jeswr/suite-native";
import { secureStorePlugin } from "@jeswr/suite-native/capacitor";

const store = createSecureStore(secureStorePlugin);
const key = await refreshTokenKey({ issuer, webId, clientId });
const status = await store.status(); // No prompt.
const entry = await store.get(key, signal); // Optional AbortSignal; gated reads prompt.
const committed = await store.set(key, refreshToken, {
  userPresence: status.userPresence && unlockEnabled,
  version: entry.version,
});
// Keep committed.version beside the in-memory token for the next rotation.
// await store.delete(key); // Sign out one account.
// await store.clear(); // Sign out all accounts in this origin's namespace.
// await store.cancel(); // Abandon a pending unlock.
```

Keys match `^[a-z0-9][a-z0-9:._-]{0,127}$`; values are strings of at most 16 KiB
of UTF-8. `get` returns `{ value: string | null, version }` and `set` returns
`{ version }`. Versions are non-negative safe integers, start at zero for an unwritten
key, and increase on native mutations, including removal and clear. `delete`, `clear`
and `cancel` resolve with no value. All native responses are validated; malformed
responses reject with `SecureStoreError` whose `code` and message are `failed`.
Other codes are `cancelled`, `background`, `lockout`, `unavailable`, `stale`, `full`
and `invalid`; native messages are never forwarded. Invalid arguments reject before
the bridge. Aborting `get` rejects immediately with `cancelled` and requests native
cancellation; an already-aborted signal never calls native code.

`refreshTokenKey` uses WebCrypto SHA-256 of `JSON.stringify([issuer, webId, clientId])`,
prefixed with `pod-auth:refresh:` and encoded as lowercase hex, without normalising
the identity strings. There is no web fallback: off native, keep the existing IndexedDB
path. pod-auth integration waits for its storage seam (T-031 / MOB-06).

Private at 0.1.0. From the workspace root:

```sh
pnpm --filter @jeswr/suite-native run lint
pnpm --filter @jeswr/suite-native run build
pnpm --filter @jeswr/suite-native run typecheck
pnpm --filter @jeswr/suite-native run test   # 100% coverage thresholds
```

<!-- AUTHORED-BY Codex GPT-6 -->
## Native push notifications (`./push`, MOB-P2d)

`@jeswr/suite-native/push` is a pure, injectable API: it never imports Capacitor, reads a token,
fetches pod contents, or logs push data. Load the binding only after checking `isNativeApp()`:

```ts
import { createPush, createPushRegistrar } from '@jeswr/suite-native/push';

const { pushPlugin } = await import('@jeswr/suite-native/capacitor');
const push = createPush(pushPlugin);
```

`createPush` validates the native `status`, `enable`, `setTopicMap`, `silence`, `sign`, `activate`,
`disable`, `consumeLaunchRoute` and `scheduleRenewalReminder` methods. `consumeLaunchRoute()` unwraps
Capacitor's `{ launchRoute }` envelope. Keys must be public P-256 keys, byte strings canonical
base64url; routes are exactly `/notifications` or `/chat/<base64url-id>`. Native errors become a
fixed message without native details. `disable()` silences all registrations; only
`disable({ deleteLocalData: true })` deletes keys and the OS token after confirmed remote cleanup.

`createPushRegistrar({ relayUrl, fetch, fetchFor?, cleanupFetch?, push, store, subscriptions, clock? })`
owns the installation and registration lifecycle. `relayUrl` is an explicit HTTPS origin fixed by
the signed build. `fetch` comes from
`podAuth.fetchFor(account, { extraResourceOrigins: [RELAY_ORIGIN] })`; with multiple accounts,
`fetchFor(accountId)` returns each account's own bounded fetch. `cleanupFetch` is a pristine,
credential-free transport (default `globalThis.fetch`), used only for DELETE with a native device
proof. Authentication, refresh, access tokens and DPoP keys stay inside pod-auth.

- `enable({ accountId, webId, protocol, storage, topics })` creates or updates the installation,
  waits for its encrypted challenge and activates it, creates a registration with empty topics,
  subscribes at the pod, binds the returned channels at the relay and installs the local topic map.
  The bootstrap PUT is necessary because the relay returns the secret inbox URL on creation only.
- Each topic has `{ index, kind: 'inbox' | 'chat', topic, label, route, enabled }`. Labels/routes
  stay local. At most four account/storage registrations share one installation; each has at most
  sixteen topics. LWS storage subscriptions still require a Solid-OIDC account for relay auth.
- `renew(accountId)` refreshes the relay and OS token on launch/resume; it asks the pod for seven
  days when less than two days remain. It stores the expiry the pod actually returned, and schedules
  the native availability reminder from the earliest active expiry. Expired relay installations
  are recreated; lost inbox responses are recovered through `rotate-inbox`.
- `remove(accountId)` aborts that account's in-flight work, silences its native registrations first,
  then attempts pod cleanup and proof-only relay cleanup within ten seconds per operation. Other
  accounts retain their maps. Failed cleanup remains durable for `retryCleanup()` on a later launch.
  Keys/maps are retained until every remote deletion succeeds. A last-registration DELETE may
  already have removed the installation atomically, so a later installation DELETE's 404 is success.
- `snapshot()` returns a detached `PushRegistrarState` containing public account mapping,
  registration IDs, secret inbox URLs, channel expiries, superseded channels awaiting cleanup and
  removal flags. Treat it as sensitive metadata; persist through `store.load()/save(state)` in
  app-private storage. Never store it in pod data or logs. Device keys and push tokens are absent.

The app supplies `subscriptions.subscribe({ accountId, webId, protocol, storage, inbox, topics,
requestedExpiresAt, signal })`, returning `BoundPushTopic[]` (`index`, `kind`, `topic`, `channel`,
optional `sender`, actual epoch-millisecond `expiresAt`), and
`subscriptions.remove({ accountId, protocol, storage, topics, signal })`. The adapter uses the
account's authenticated pod fetch and owns discovery, scope checking, seven-day requests, and
cleanup if subscription creation fails part-way through. Solid uses one WebhookChannel2023 per
topic; LWS batches all topics in one WebhookSubscription. It must honor cancellation and delete
only the channels it created. Preserve a single registrar instance per installation/relay.

Settings must say **“Notifications pause if you don't open Solid Suite for a week”**. Launch routes
must resolve registration-to-account before navigation; signed-out/unknown registrations open only
`/notifications`. No production relay is configured by this package.
