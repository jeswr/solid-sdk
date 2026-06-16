# Model Provenance

This file tracks which parts of `solid-offline` were authored by an AI model,
which model, and any re-review/upgrade caveats. It exists so a later human or a
stronger model can find and re-review machine-authored code.

## Opus 4.8 (Fable unavailable) — re-review / upgrade candidate

The work below was authored by **Claude Opus 4.8** because **Fable was
unavailable** at the time. It is flagged as a **re-review / upgrade candidate**:
re-review (or regenerate with Fable) before treating it as fully trusted.

Each new file carries the matching top-of-file marker:

```
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
```

### P2 — page-driven proactive cache warmer (§3 + decisions 1 & 6)

New files:

- `src/warmer-rdf.ts` — pure RDF helpers: seed derivation from a WebID profile
  (`deriveSeeds`, Type-Index-first), container `ldp:contains` enumeration
  (`containerChildren`), Type Index target extraction (`typeIndexTargets`),
  ACL-URL derivation (`aclUrlFor` / `aclFromLinkHeader`), and `WAC-Allow` parsing
  (`parseWacAllow` / `userCanRead`).
- `src/warmer.ts` — the bounded-BFS warmer engine (`warm`), budget resolution
  (`resolveBudget`, `DEFAULT_WARM_BUDGET`), and the browser triggers
  (`onIdle`, `createWarmController` — post-login idle + reconnect re-warm).
- `test/warmer.test.ts` — headless unit tests (URL-routed mock fetch + Turtle
  fixtures) for all of the above.

Files modified for P2 (not newly authored, so no top-of-file marker):

- `src/types.ts` — `WarmBudget` (spec field names + back-compat aliases),
  `WarmConfig` (`warmOnLogin`/`rewarmOnReconnect`), `OfflineClientConfig.fetch`,
  `OfflineClient.warm()`.
- `src/index.ts` — wires the page-driven warmer into `createOfflineClient`
  (`register()` starts it on idle; `warm()` runs it on demand; `close()` stops
  it) and re-exports the warmer surface.
- `README.md` — P2 documentation.

### Re-review focus areas

- Seed/vocabulary coverage: only `pim:storage`, `solid:public/privateTypeIndex`,
  `ldp:inbox`, `ldp:contains`, `solid:instance(Container)` are followed. A real
  pod may surface other linkage worth warming.
- Binary/large-resource heuristics (`BINARY_TYPE_PREFIXES`, `LARGE_RESOURCE_BYTES`
  = 5 MB) are conservative guesses, not measured.
- The reconnect re-warm currently re-issues the full BFS and relies on the P1 SWR
  layer to make it cheap (mostly 304s) rather than doing a dedicated
  ETag-only sweep. Worth revisiting alongside P3. **(Done in P3 — see below.)**
- Browser triggers (`requestIdleCallback`, the `online` event) are unit-tested
  with injected globals but not yet exercised against a live pod.

### P3 — notification-driven cache invalidation (§5 + decision 5)

New files:

- `src/notifications.ts` — the PAGE-side notifications client (decision 5: the
  WebSocket lives in the page, never the SW). Endpoint discovery
  (`discoverSubscriptionUrl` via the `storageDescription` Link rel →
  `notify:subscription`, with a `/.well-known/solid` fallback), the
  WebSocketChannel2023 `subscribe` POST → `receiveFrom`, frame parsing
  (`parseFrame`, flattening `{id}`/bare-IRI `object`/`target` + `state`),
  `backoffDelay`, and `createNotificationsClient` — subscribe per-container
  (capped by `maxChannels`) + per-resource, open sockets, forward frames to the
  SW, exponential-backoff reconnect + re-subscribe (one-shot channels), an
  on-(re)connect ETag-resync request, and disconnected slow-poll. Written against
  injected fetch + socket factory + timers (no real network).
- `src/invalidation.ts` — the SW-side invalidation pipeline. `handleNotification`
  (ETag short-circuit → revalidate / re-fetch listing / purge → broadcast) and
  `resyncSweep` (flat conditional-GET resync of the whole warmed set). Same DI
  shape as `swr.ts`.
- `test/invalidation.test.ts`, `test/notifications.test.ts` — headless unit tests
  (fake WebSocket + URL-routed fake fetch + the real fake-indexeddb MetadataStore).

Files modified for P3 (not newly authored, so no top-of-file marker):

- `src/types.ts` — `NotificationFrame` / `NotificationActivityType`,
  `NotificationsClientConfig`, the `notification`/`resync`/`poll`
  `PageToWorkerMessage` variants, `OfflineClientConfig.notifications` widened.
- `src/metadata-store.ts` — `getAll()` (enumerate the warmed set for the resync
  sweep) + `setLastState()`.
- `src/worker.ts` — message handlers for `notification`/`resync`/`poll` driving
  the invalidation pipeline with the SW's own unauthenticated fetch.
- `src/warmer.ts` — **the P2-gap refactor**: `createWarmController` now takes an
  `onReconnect` hook; when wired (notifications enabled) reconnect runs the
  dedicated ETag-resync sweep instead of re-issuing the full BFS. Falls back to
  the P2 full re-warm when no sweep is wired.
- `src/index.ts` — wires the page notifications client into `createOfflineClient`
  (`register()` starts it from the warmed containers; `close()` stops it; the SW
  control messages + `onReconnect` resync are posted to the active SW).
- `README.md` — P3 documentation.

### P3 re-review focus areas

- The SW's invalidation/resync conditional GETs are **unauthenticated** (the SW
  holds no key — decisions 1 & 5). For a private resource a missed-frame resync
  GET may 401/403 and purge the entry; the page's own authenticated read/warm
  re-populates it. This is correct but means private resources lean more on the
  page path than public ones. A SharedWorker token authority (v2 / P6) removes
  the asymmetry.
- `Add`/`Remove` re-fetch the container *listing* but do not eagerly pull the new
  member's bytes (left to lazy read-time / the warm budget). Fine for read-first,
  but a future "eager member warm" could prefetch the just-added resource.
- Topic derivation defaults to the warmed containers; very large pods can exceed
  the channel cap (`maxChannels`, default 50) and silently drop the tail — there
  is no LRU/hot-set eviction of channels yet.
- **Real-socket integration is deferred**: discovery/subscribe/socket lifecycle
  are exercised against a fake WebSocket + fake fetch only, not a live
  prod-solid-server WebSocketChannel2023 endpoint.

### P5 — DX hooks + status surface + WebID-scoping + logout-purge (§7)

New files:

- `src/scope.ts` — the single source of truth for §7 cache scoping: `scopeHash`
  (FNV-1a 32-bit), `scopeFor`, `dbNameForWebId` (`solid-offline:<hash>`) and
  `cacheNameForWebId` (`solid-offline-cache:<hash>`), plus the prefixes and the
  anonymous defaults. Both the page client and the SW import this so they agree
  on exactly which DB/Cache a WebID maps to.
- `src/status.ts` — the framework-agnostic offline/stale/pending status surface
  (`createStatusSurface`). A plain `subscribe`/`getSnapshot` store with
  referentially-stable snapshots (so it drives `useSyncExternalStore` without
  looping); bridges the `updated` BroadcastChannel + `online`/`offline` events;
  `markPending`/`markStale`/`markFresh`/`forget`. Injectable channel/connectivity/
  isOnline for headless tests.
- `src/logout.ts` — the **mandatory logout-purge** (`purgeForWebId`): deletes the
  WebID-scoped Cache API cache + IndexedDB DB. Best-effort but total (a missing
  store is success; one half failing does not stop the other); injectable
  `caches`/`indexedDB`; reports the outcome.
- `src/react.ts` — `solid-offline/react`: the thin hooks `useOfflineStatus`
  (wraps the status surface with `useSyncExternalStore`; can own or borrow a
  surface) and `useOfflineResource` (reads a URL through the page fetch, tracks
  pending/stale/outdated, re-reads on an `updated` broadcast for that URL). React
  is an **optional peer dependency** — the core imports nothing from here, and
  tsup externalizes `react`.
- `test/scope.test.ts`, `test/status.test.ts`, `test/logout.test.ts`,
  `test/react.test.ts` — unit tests (vitest + fake-indexeddb; the React tests run
  in `jsdom` with real React 18 + `@testing-library/react`). They pin: WebID
  scoping isolates two identities; logout purges BOTH stores (and leaves the other
  identity intact); the status surface + hooks subscribe and re-render on
  `updated`.

Files modified for P5 (not newly authored, so no top-of-file marker):

- `src/metadata-store.ts` — now imports + re-exports `dbNameForWebId` /
  `DEFAULT_DB_NAME` from `scope.ts` (the hash/name logic moved there; no behaviour
  change).
- `src/worker.ts` — the Cache API name is now WebID-scoped via `cacheNameForWebId`
  (was a fixed `solid-offline-v1`), matching the metadata DB scope so logout-purge
  drops exactly one identity's bytes.
- `src/types.ts` — `OfflineClient.logout()`.
- `src/index.ts` — wires `offline.logout()` (page-side purge → `close()`), a lazily
  created `offline.status` surface, and re-exports the scope/logout/status surface.
- `package.json` — `./react` export, `react` optional peer dep, and the
  React/testing dev deps (`react`, `react-dom`, `@types/react`,
  `@testing-library/react`, `jsdom`).
- `tsup.config.ts` — `react` entry + `external: ['react']`.
- `test/warmer.test.ts` — the CPU-bound `stops at maxBytes` case now sets a 20 s
  timeout (it brushed the 5 s default under full-suite contention once the jsdom
  React tests were added); bounded work, not a hang.
- `README.md` — P5 documentation.

### P5 re-review focus areas

- **No encryption at rest** (decision 3): purge is the control on shared devices,
  but anything read while logged in is plaintext in IDB/Cache until `logout()` (or
  quota eviction). An ephemeral memory-only mode and the v2 passphrase-key hook are
  not built.
- `onblocked` during DB deletion resolves rather than waiting: if another tab holds
  the DB open at logout, the deletion is *queued* (completes when that tab closes)
  but `purgeForWebId` reports `dbDeleted: true` optimistically. A stricter
  cross-tab logout (broadcast a "close your DB handle" message first) is deferred.
- The status surface only flips a resource to `updated` for URLs the consumer is
  already tracking (it does not grow the map for every pod change); consumers must
  `markFresh`/read a URL to begin tracking it.
- `useOfflineResource` is intentionally minimal (no request dedup/caching of its
  own, no Suspense): caching is the SW's job. A Suspense-friendly variant and
  request coalescing across components are candidates for a later pass.
- React hooks are tested in `jsdom` with `@testing-library/react`, not against a
  real browser SW + a live pod.

### P4 — app-shell precache (the app BOOTS offline) — Opus 4.8

Branch `feat/offline-sw-complete`. The half of "works completely offline" that P1–P3
left out: precaching the app's STATIC SHELL so it paints with no network after the
first visit. Authored by **Claude Opus 4.8** (Fable unavailable);
**re-review / upgrade candidate**.

New files:

- `src/app-shell.ts` — pure, framework-agnostic app-shell logic:
  `resolveAppShellConfig` (defaults the fallback to the first HTML/`/` entry,
  de-dupes, defaults the version), `precacheAppShell` (install-time precache into
  the versioned `solid-offline-shell-<ver>` bucket, per-URL 404 tolerance so one
  bad URL never aborts the rest), `cleanupOldShellCaches` (activate-time stale-bucket
  cleanup that ONLY touches the `solid-offline-shell-` prefix — never the pod-data
  caches), `isPrecachedAsset` (pathname match), `handleNavigation` (network-first
  with cached-route → fallback offline path), `handlePrecachedAsset` (cache-first
  for immutable hashed assets). Carries the top-of-file marker.
- `test/app-shell.test.ts` — strict offline-boot unit tests (mocked CacheStorage +
  fetch that simulate offline: fetch rejects / `navigator.onLine` false) over both a
  vite `dist/` and a Next static `out/` shape.

Files modified for P4 (not newly authored, so no top-of-file marker):

- `src/types.ts` — `AppShellConfig` (the public precache config) +
  `OfflineClientConfig.appShell`; the `PageToWorkerMessage` `config` already carries
  it. (Also: removed a stray NUL byte that had corrupted a space in the
  `CacheMetadata.key` JSDoc, which made git treat the file as binary.)
- `src/worker.ts` — the SW adapter: a build-time `__SOLID_OFFLINE_SHELL__` injection
  slot (precache at `install`) OR adoption from the first `config` message; the
  install-precache / activate-cleanup wiring; and the fetch router that sends a
  navigation → `handleNavigation`, a precached asset → `handlePrecachedAsset`, and
  everything else → the existing pod-data SWR engine (each request handled by
  EXACTLY ONE layer). The shell uses the SW's OWN unauthenticated fetch (the shell
  is public static assets — decision 1 holds).
- `src/index.ts` — re-exports the P4 surface from the package root.
- `README.md`, `docs/MODEL-PROVENANCE.md` — P4 documentation.

**roborev (codex/gpt-5.5) findings — two review rounds, all fixed in this branch.**

Round 1 (2 Medium):

- **Shell cache could STORE a private same-origin page.** `handleNavigation`
  originally cached ANY `2xx text/html` navigation, so an authenticated/private route
  could land in the identity-independent, logout-surviving shell cache.
- **A config-message deploy never updated the shell.** The worker adopted `appShell`
  only when it had none, pinning the old shell for the active worker's lifetime.

Round 2 (on the round-1 fix — 1 High + 2 Medium): the write-gate alone left three
paths open; all closed by a stronger, key-canonical design:

- **Offline READ could still SERVE a poisoned/private entry (High).** The offline path
  returned any `cache.match(request)` hit before checking it was a configured shell
  doc. FIXED: the offline read is keyed by the CANONICAL configured URL
  (`canonicalShellUrl`) — an unconfigured route is never read from cache, it skips
  straight to the public `fallback`. New test seeds a poisoned `/account/secret` entry
  and asserts it is NOT served.
- **Query-variant path match could cache a private variant (Medium).** Pathname-only
  matching treated `/index.html?user=alice` as the configured `/index.html`. FIXED:
  the WRITE is gated on an EXACT path+query match (`isExactConfiguredShellUrl`) — a
  personalizing query variant is served live but NEVER stored — while the offline READ
  still resolves the canonical doc so client routes boot. Two new tests (online: not
  stored; offline: canonical served).
- **Config promoted BEFORE precache (Medium).** `adoptShellConfig` switched
  `shellConfig` before the new bucket was populated, so a slow/partial precache could
  strand offline navigations on an empty cache. FIXED: the new version is precached
  into its OWN bucket (the old, still-serving bucket is untouched — buckets are
  version-keyed) and `shellConfig` is PROMOTED only once the new bucket can boot
  (its fallback is cached); the stale bucket is cleaned up only AFTER promotion. On a
  precache failure the old working shell config is kept.

The change-detection decision (`sameShellConfig`) and the URL classifiers
(`canonicalShellUrl`/`isExactConfiguredShellUrl`, via `handleNavigation`) are pure,
exported, and unit-tested; the worker's `adoptShellConfig` orchestration is the
browser-only adapter (excluded from coverage, like the rest of `worker.ts`).

### P4 re-review focus areas

- The shell bucket is identity-INDEPENDENT and deliberately survives `logout()` — it
  holds the app's own public static assets, not pod data. Confirm no pod data can
  ever land in it: only navigations to CONFIGURED shell docs + same-origin URLs listed
  in `appShell.precache` route to (and are written by) the shell handler; everything
  else (pod reads) stays on the WebID-scoped SWR path.
- The asset routing is gated SAME-ORIGIN (`isSameOrigin` in `worker.ts`) so a
  cross-origin pod path that shares a pathname with a precached asset is never diverted
  off the pod-data path. Re-check that gate.
- A first-ever offline visit (nothing precached) intentionally surfaces the network
  error rather than fabricating a response — verify that's the desired UX vs a
  generic offline page (an `offlineFallback` is a candidate follow-up).

## roborev security/correctness fixes (codex/gpt-5.5 findings) — Opus 4.8

Branch `fix/roborev-security-findings`. roborev (codex/gpt-5.5) reviewed the P0–P5
commits and flagged a set of HIGH/MEDIUM/LOW findings; all were fixed by **Claude
Opus 4.8** (Fable unavailable) and are **re-review / upgrade candidates**.

### Canonical internal cache key (resolves #1/#3/#7 coherently)

The byte cache (Cache API) is now keyed on a single CANONICAL `(url, varyKey)`
synthetic `Request` (`cache-policy.ts#keyRequest`) — the SAME `(url, varyKey)` the
metadata store uses — instead of the live request. Reads/deletes pass
`{ ignoreVary: true }` so the stored response's own `Vary` can't re-apply header
matching on top of our canonical key, WITHOUT mutating the stored response (its
`url`/`redirected`/`type` are preserved). `Vary: *` responses are classified
uncacheable up front (`varyHasStar`). This keeps the byte cache and the metadata
store in exact 1:1 correspondence, which:

- **#1 (HIGH, cross-user leak):** `handleFetch` is now METADATA-FIRST — it looks up
  the metadata record first and treats a byte-cache hit with NO matching metadata
  as a miss (deleting the orphan bytes). A previous user's stray cached bytes can
  no longer be served.
- **#3 (HIGH):** `invalidation.purge` deletes EVERY cached variant (one per
  metadata `varyKey`), not just a synthetic `Accept: text/turtle` key.
- **#7 (MEDIUM):** RDF `application/ld+json` and `text/turtle` reads now share one
  cached entry (canonical Accept folds them onto one key).

### Other findings

- **#2 (HIGH):** `swr.revalidate` builds the conditional request from the ORIGINAL
  request (`new Request(request, { method:'GET', headers })`) so credentials / mode
  / referrer are preserved; cross-origin authenticated reads no longer revalidate
  unauthenticated.
- **#4 (HIGH):** the worker treats `undefined` as a valid scope change
  (`scope.isScopeChange`); an anonymous client after a logged-in user now clears
  the previous identity scope and closes the old metadata handle.
- **#5 (HIGH):** `logout.deleteDatabase` resolves `'deleted'` only on `onsuccess`
  and reports `'blocked'` distinctly; `PurgeResult` gains `dbBlocked` and only sets
  `dbDeleted` after a real success. (Supersedes the P5 re-review caveat above.)
- **#6 (MEDIUM):** HEAD is never byte-cached (`Cache.put` is GET-only). HEAD is a
  network passthrough that only reconciles existing GET state on definitive signals
  (see the focus-areas note below); it never serves or wrongly clobbers GET bytes.
- **#8 (MEDIUM):** 403/404 negative responses' bytes are byte-cached so
  within-TTL / offline reads serve the same bytes the server returned.
- **#9 (MEDIUM):** the warmer HEAD-probes before the skip decision; large binaries
  are never GET-downloaded / byte-cached.
- **#10 (MEDIUM):** the warmer reserves a warmed slot SYNCHRONOUSLY before the
  byte-pull await (`CrawlState.reserved`), so concurrent workers cannot overshoot
  `maxResources`.
- **#11 (MEDIUM):** `deriveSeeds` derives seeds ONLY from the logged-in WebID
  subject (with a narrow, tested fallback to the profile document IRI); a profile
  can no longer steer the crawl to a foreign subject's storage.
- **#12 (MEDIUM):** the notifications client schedules a reconnect even while
  offline, so notifications resume after coming back online.
- **#13 (MEDIUM):** notification topic derivation reuses the scheduled warm
  (`WarmController.result()`) instead of forcing a duplicate full crawl, and does
  not crawl at all when auto-warm is off.
- **#14 (MEDIUM):** `useOfflineResource({ skip: true })` can now be loaded manually
  via `reload()` (skip only gates the initial read, `reloadNonce === 0`).
- **#15 (LOW):** the resolved `channelName` is sent to the worker and used for both
  update + invalidation BroadcastChannels.
- **#16 (LOW):** `WarmConfig.seeds` (a custom URL array) is now honoured — threaded
  through `createWarmController` → `warm(..., { seeds })`.

### Re-review focus areas (new)

- `keyRequest` builds a SENTINEL-ORIGIN key (`https://solid-offline.invalid/<enc>`)
  encoding the full `(url, varyKey)` composite in one percent-encoded path segment.
  (An earlier draft folded the varyKey into a query param on the live URL; the
  roborev re-review flagged it as a HIGH collision risk when the resource URL
  already carried that param, so it was replaced with this collision-free key.)
- Cache lookups are now METADATA-DRIVEN (`swr.lookupRecord`): for each row of a
  URL we recompute the request's varyKey UNDER that row's STORED `vary` and match.
  So a resource varying on any header (Accept, Accept-Language, …) is looked up
  under exactly the key it was stored under — no permanent miss / orphan bytes.
  (An earlier draft assumed `Vary: Accept` at lookup time, which the roborev
  re-review flagged as a desync against the actual stored `vary`.)
- HEAD is a NON-DESTRUCTIVE network passthrough: it never serves cached GET bytes,
  never fabricates metadata, and NEVER PURGES. A HEAD (especially the warmer's
  probe, which the SW forwards and which may be unauthenticated relative to the
  GET) is not authoritative enough to evict GET bytes — a 403/404 or ETag mismatch
  there is ambiguous. The only thing a HEAD does is CONFIRM freshness when its
  explicit ETag matches the stored variant. Revocation/change is handled
  authoritatively by GET revalidation + notification invalidation. (The HEAD path
  was tightened across several roborev re-review passes — from metadata-only-store,
  to definitive-signal eviction, to fully non-destructive.)
- `client.warm()` (manual) starts auto-derived notifications from its result when
  notifications are enabled with non-explicit topics and aren't already running —
  so manual-warm users (`warmOnLogin: false`) still get notifications wired.
- Non-cacheable revalidation responses (a 2xx/403/404 carrying `no-store`/
  `private`) now PURGE the stale entry in both `swr.revalidate` and
  `invalidation.{revalidateResource,refreshListing}` rather than leaving old bytes.
- The warmer reserves the resource slot SYNCHRONOUSLY after the HEAD probe and
  BEFORE the byte-warming GET, so concurrent workers can't fire GETs that overshoot
  the cache budget through the SW. A warmer HEAD 403/404 is treated as INCONCLUSIVE
  (the bare probe may lack the auth the GET carries) → it never prunes; the GET is
  the authoritative ACL signal. Explicit `WarmConfig.seeds` are crawled even when
  the WebID profile fetch fails (independent of discovery).
- `Vary: *` is classified UNCACHEABLE (`classifyResponse` → `vary-star`): because
  we store under our own synthetic canonical key with `Vary` stripped, we must
  reproduce the Cache API's own refusal to store a non-shareable response.
- Revocation/change is RESOURCE-WIDE: `swr.revalidate`, the HEAD reconciler, and
  `invalidation.{revalidateResource,refreshListing}` purge EVERY variant for the
  URL (via `purgeAllVariants` / `purgeStaleVariants`), not just the matched one.
- `WarmController.result()` settles (resolve OR reject) on warm completion/failure
  and on `stop()`, so notification topic derivation can never hang on it.
- The byte cache + metadata DB names carry a CACHE-FORMAT GENERATION
  (`scope.CACHE_FORMAT = 'v2'`): the canonical-key format is incompatible with the
  old live-request-keyed bytes, so the generation abandons an old-format cache
  COHERENTLY (both stores together) rather than reading bytes under a key they were
  never stored under. (The package is unpublished `0.0.0`, so there is no real
  deployed cache to migrate; the generation is the forward-safe mechanism.)
- The warmer's `budgetExceeded` checks `reserved` (not just completed `warmed`), so
  once the resource budget is reserved the BFS stops admitting items / HEAD probes.
- `useOfflineResource`'s manual-load (`reload()`) bypass of `skip` stays active
  until the load SETTLES, so a mid-flight `updated` broadcast can't drop it to idle.
- #4 is verified via the pure `isScopeChange` helper (the SW message handler itself
  is excluded from coverage — it needs a real SW lifecycle).

### API / behavioural changes (for the caller)

- `PurgeResult` gained a `dbBlocked: boolean` field (additive).
- `WarmController` gained a `result()` method (additive).
- `isScopeChange` is newly exported from the package root.
- HEAD no longer populates the byte cache at all (it reconciles existing GET state
  on definitive signals; metadata is not fabricated from a bare HEAD) — a
  behavioural change for any consumer that relied on a HEAD warming the cache.
- The warmer now issues a HEAD probe per resource before the GET (one extra request
  per resource), trading a cheap HEAD for never downloading large binaries.
