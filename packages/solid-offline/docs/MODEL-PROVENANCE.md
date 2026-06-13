# Model Provenance

This file tracks which parts of `@solid/offline` were authored by an AI model,
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
