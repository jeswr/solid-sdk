<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/suite-native

> **Experimental — AI-agent-generated.** Security critical (`securityCritical: true`).

The seams the Solid Suite web app uses when it runs inside the iOS and Android shells
(`apps/mobile`, Capacitor 8). Design of record: `solid-suite-planning/specs/mobile/DESIGN.md`.

| Export | What it does |
|---|---|
| `platform()`, `isNativeApp()` | `"ios" \| "android" \| "web"` from the injected `Capacitor` global; no Capacitor import. |
| `createNativeCodeDriver({ plugin, redirectUri, resolveIssuer })` | pod-auth's `ui.getCode` for the apps: opens the system browser (ASWebAuthenticationSession / Custom Tabs) and returns the authorization code after fail-closed checks on the request (https, PKCE S256, one `state`, our `redirect_uri`) and the callback (exact redirect, matching `state`, one `code`, exactly one RFC 9207 `iss` equal to the resolved issuer, error responses as `AuthorizationError`). |
| `share(content, { native, web })` | Native share sheet, else Web Share, else `ShareUnavailableError`. |
| `stageFile(blob, { name, mimeType? }, plugin, limits?)`, `shareFiles(files, content, { staging, native })` | Stage already fetched bytes in bounded chunks, then share native file URIs. |
| `createShareInbox(plugin)`, `validateShareBatch()` | Validated `ShareBatch`es from other apps, chunked size-checked file reads, acknowledgement. |
| `createSecureStore(plugin)`, `refreshTokenKey({ issuer, webId, clientId })` | Validated native refresh-token storage, versioned writes, cancellable unlocks and session identity keys (MOB-P4 S11/S12). |
| `openPdf(plugin, name, bytes, signal?)` | Drive's native "Open PDF" (MOB-P3 E5): checks the 25 MiB cap and `%PDF-` signature, sends 1 MiB base64 chunks to `SuiteFiles`, opens the platform viewer; aborting `signal` stops before the next native call. Failures are `PdfPreviewError` with code `too-large`, `not-pdf`, `no-viewer`, `cancelled` or `failed`. |
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
