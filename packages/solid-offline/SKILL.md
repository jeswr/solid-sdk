---
name: solid-offline
description: Use when implementing or changing the solid-offline service-worker cache, proactive warmer, StorageClient reads, pod-notifications invalidation, app-shell precache, WebID-scoped storage, logout purge, status surface, or React offline hooks.
---
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Work with `@jeswr/solid-offline`

Preserve the central invariant: cached pod data is never authoritative. Serve cached bytes quickly, mark offline hits stale, and revalidate online entries against the pod.

## Page-client workflow

```ts
import { createOfflineClient } from "@jeswr/solid-offline";
import { createPodClient } from "@jeswr/storage-client";

const { storage } = await createPodClient({ storage: storageRoot, fetch: session.fetch });
const offline = createOfflineClient({
  storage,
  webId,
  fetch: session.fetch,
  warm: { seeds: "auto" },
  notifications: true,
  appShell: { precache: shellUrls, fallback: "/index.html", version: buildSha },
  workerUrl: "/solid-offline-worker.js",
});

await offline.register();
// Mandatory when this identity signs out:
await offline.logout();
```

Import `@jeswr/solid-offline/worker` from an origin-served service-worker entry. Import React-only helpers from `@jeswr/solid-offline/react`; React is an optional peer and must not leak into the core entry point.

## Security and correctness rules

- Keep the service worker credential-free. Authenticated warming happens in the page through the injected StorageClient. The optional page fetch is used by pod-notifications.
- Scope Cache API and IndexedDB state by WebID. Anonymous and authenticated identities must never share a cache namespace.
- Purge both read-cache stores on logout. Preserve the separate write outbox; only its explicit `purge()` discards unsent changes. A failure in one purge path must not prevent attempting the other.
- Never cache auth, token, OIDC, notification-subscription, WebSocket-upgrade, opaque, `private`, or `no-store` responses.
- Cache response bytes only for GET. Treat HEAD as a network passthrough that may confirm existing
  metadata freshness when its ETag matches; never pass a HEAD request to `Cache.put()` and never let
  it replace or evict a cached GET body. Keep the bounded negative-cache behavior for 403/404 GETs.
- Respect `Vary`; normalize supported RDF reads to the canonical accept value without collapsing genuinely different variants.
- On an online hit, serve immediately and conditionally revalidate. A `304` refreshes metadata; a changed `200` replaces bytes and broadcasts an update.
- Tag readable in-scope pod GET responses with `X-Solid-Offline-Cache`, exported as
  `CACHE_PROVENANCE_HEADER`. `cacheProvenance(response)` returns `'hit' | 'miss' | 'stale' | null`
  without reading the body. Network bytes are `miss`, even when HTTP policy prevents storage;
  synchronous 304-confirmed bytes and negative entries within their bounded TTL are `hit`.
  Offline positive-cache reads and immediate SWR bytes are `stale`, including when background
  validation fails, is skipped, or later succeeds. Keep the legacy offline `X-Offline` marker.
  Decorate cloned responses only, never cached entries. Leave out-of-scope requests, HEAD,
  app-shell responses, and opaque/opaque-redirect or status-zero responses unchanged.
- Treat notification `state`/ETag equality as a fast no-op, not a universal correctness assumption. Reconcile after disconnects.
- Bound warming by resource count, bytes, depth, and concurrency. Acknowledge the worker budget session before intercepted StorageClient reads, retain HEAD size evidence, and validate streams before Cache.put; never retry guarded failures outside the budget. Prune unreadable subtrees and avoid eager caching of large binary bodies.
- Keep app-shell caches versioned and separate from pod-data caches. Cache only explicitly declared public shell URLs.

## Status and React integration

Use `offline.status` or `createStatusSurface()` as a stable `subscribe`/`getSnapshot` store. `useOfflineStatus` and `useOfflineResource` should remain thin `useSyncExternalStore` adapters; caching policy stays in the service worker.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
The worker broadcasts `OfflineEvent` messages containing only URL, event, and an opaque
random `attemptId` shared by an attempt's start and terminal messages: `revalidating` starts an attempt;
exactly one of `updated` (replacement/purge), `revalidated` (confirmed 304 or matching sweep HEAD), or
`revalidate-failed` (network/offline/storage/non-authoritative response) terminates it.
Keep `UpdatedEvent` source-compatible; do not put ETags, bytes, headers, credentials, or
errors on the channel. Direct delete purges use the same balanced lifecycle without
fetching; purge errors terminate with `revalidate-failed`.

Track URLs with the surface's mark methods. For tracked URLs, start → `pending`,
confirmed 304 → `fresh`, replacement/purge → `updated`, and failure → the prior state.
Parallel observed attempts remain pending until all settle. Correlate completions by ID,
so a missed start before subscription cannot settle newer work (including lazy `offline.status`).
Keep legacy ID-less messages source-compatible with separate URL-based counting; that
older protocol cannot guarantee correct accounting across missed starts.
Keep settled freshness separate from
active-attempt counts: manual marks update the settled state while pending, and failures
retain that state. An unread `updated` survives 304 confirmations until a consumer mark
acknowledges its read. Offline cache hits and no-op/skipped
validations emit no lifecycle events. An unsolicited 304 on an unconditional listing
refresh is a failed confirmation. `markPending` remains supported. `useOfflineStatus`
returns `UseOfflineStatusResult`, which adds `syncing: boolean` (`pending > 0`) to the
snapshot. `useOfflineResource` continues to reload only on `updated` events.

Test decision logic with fake storage clients/transports, Cache API, subscriptions, and real fake IndexedDB seams. A change to worker lifecycle wiring also needs browser-level verification because unit tests do not exercise real service-worker install/activate/fetch events.

Run the package and full workspace gates. For an intentional public API change, rebuild and update the API report before the final gate.

## Storage and subscription plumbing (T-062)

- `WarmDeps.storage` is a StorageClient; use `head`/`read`/`list`, never parse container listings locally. Reserve a shared resource slot before each listing page; preserve the cursor loop guard and 10,000-page ceiling of `listAll`.
- Keep backend-reported container kinds (LWS identifiers may be slashless) and listing size hints.
- All derived/explicit seeds must pass `isWithinStorage`; an external WebID needs explicit seeds or an already-fetched profile.
- `notificationsClient` optionally injects the shared pod-notifications client. Forward normalized changes, including Move and membership parents. Wire `resync` to the ETag sweep.
- Strip both clients and fetch before structured cloning worker config; pass only the storage root and cloneable backend identity. LWS identity comes from authenticated page-side HEAD evidence (or explicit `storageBackend`), so public child reads do not require credential-free root discovery. Keep the worker credential-free.
- Preserve HTTP Cache-Control/Vary/type evidence at the worker transport boundary. Without original policy, evict changed bytes conservatively. Never synthesize cacheability from ReadResult alone.
- A sweep HEAD-confirms equal validators; changed or missing validators trigger reads. HEAD never replaces cached GET bytes. One failed observation must not stop the sweep.
- The duplicated notification discovery, socket, frame-parser and backoff exports are removed. Backoff belongs to pod-notifications; `maxChannels` caps distinct topics and `pollIntervalMs` controls its polling fallback.

## Durable writes and RDF merge

Import `createOutbox`, `withOutbox` and the `Outbox`, `OutboxItem`, `ConflictRecord`,
`QueueingStorageClient` types from `@jeswr/solid-offline/outbox`. Construct one outbox per
active WebID, optionally injecting `idb` and `now`. Await `outbox.ready` before reading the
initial synchronous `pending()` and `conflicts()` snapshots. Queue bodies live only in the
separate IndexedDB queue; `localBody(conflictId)` (or item ID) asynchronously returns a copy.

- Decorate the authenticated StorageClient with `withOutbox(storage, outbox)`. Only `write`,
  `writeRdf`, `create`, and `delete` accept `offline: 'queue'`; patch/move remain unqueueable.
  Without opt-in preserve the original arguments, errors and body identity. Buffer opted-in
  streams before attempting a request. Queue only offline/network failures, never HTTP errors
  or cancelled requests. Queued writes/creates return `queued: true`; delete returns void.
- Application policy uses `guard: OutboxGuard` (`{ tag, assertions?: JsonValue }`) on enqueue
  or the decorated write/writeRdf/create/delete options (`QueueOption`). Tags match
  `/^[a-z][a-z0-9.-]{0,63}$/`; assertions are plain JSON, at most 16 KiB serialized UTF-8.
  Reject lossy values, accessors, sparse arrays, class instances and cycles before enqueue/online
  delivery, and revalidate stored guards on every hydration. Invalid records become failed and
  cannot be delivered by retry or resolution. Snapshot assertions before asynchronous work.
- `registerDelegate(tag, ReplayDelegate)` returns an idempotent unregister function; duplicate
  tags throw. Registrations are instance/session-local, cleared by close, and never persisted.
  All guarded deliveries, including online attempts and retry/mine/both, go through the delegate;
  never fall back to raw storage. A missing delegate leaves replay waiting with
  `blocked: 'no-delegate'`, holds later same-URL operations and lets other URLs proceed without
  delivery progress. Register later and replay explicitly. Online delivery and mine/both reject
  missing delegates; theirs can drop without one. Guard-only calls enforce policy without queuing.
- `GuardedDelivery` is a defensive snapshot with actual operation/URL, optional container/name,
  content type/validator/create/delete options, bytes (`Uint8Array | null`) and private assertions.
  Its purpose is `replay`, `resolve-mine`, or `resolve-both`; conflict resolution passes the fresh
  ETag or generated create-only copy name. Delegate context is `{ storage, signal }`, using the
  underlying client and a signal cancelled on close. Use that raw client to avoid recursive
  delivery. Delegate replay failures follow storage classification; failed resolution retains
  its conflict. `pending()` exposes only a defensive read-only `guard.tag`, never assertions.
- Queued RDF keeps the requested Turtle or expanded, context-free JSON-LD format; named
  graphs require JSON-LD. Rebuild validated RDF/JS fields before N3 Writer; never trust private
  IDs, unsafe IRIs, language tags or prefix mappings. Omit queued Turtle prefixes. Generated create names stay stable for replay. Use named StorageClient
  creates for conflict copies so Solid sends `If-None-Match: *`; never unconditional overwrites.
- Replay one item at a time in creation order with FIFO ties and recorded validators. Network
  failure returns the item to waiting and stops. A 412 persists a conflict and holds the same
  URL while other URLs proceed. Other failures become failed items with readable errors.
  `retry(id?)` uses the decorated client or latest replay client. Per-item progress is only
  `(0, size)` and successful `(size, size)`; streaming progress is deferred.
- `resolve(id, 'mine')` must freshly HEAD and use its ETag (never wildcard when absent).
  `theirs` drops local state; `both` creates binary `-conflict-<ms>` or RDF ` (copy)` siblings
  before the extension. Failed resolution retains local bytes. Keep-both rejects deletes.
  After resolution, explicitly replay to resume the items held behind the conflict.
- Pass `{ storage, webId, outbox }` to `createOfflineClient` for replay after register and on
  window online. Strip the page-only outbox before posting worker configuration. Enforce an
  exact WebID match, abort replay on close/logout and remove online listeners. Logout keeps
  unsent writes; `outbox.purge()` is explicit. `outbox.close()` releases listeners/delegates and
  aborts guarded requests while retaining persisted changes.
- Broadcast only change/conflict indicators on the WebID-specific channel, then refresh from
  IndexedDB. Browser Web Locks serialize tabs; same-realm locking is the fallback. Do not claim
  exactly-once delivery or cross-tab serialization on browsers lacking Web Locks.

Import `mergeRdf` from `@jeswr/solid-offline/merge`: pure quad-set merge
`(remote − (base − local)) ∪ (local − base)`. Compare terms with `.equals`, preserve original
terms, deduplicate inputs, accept DatasetCore/iterables. Blank nodes compare by label; callers
must skolemise for stable identity across independently labelled inputs. Semantic conflicts
(e.g. functional properties) need domain policy and are outside this helper.

Test outbox behavior over fake-indexeddb and fake StorageClients with no network. Pin replay
ordering, durable failures/conflicts, resolution validators and create-only copy headers,
progress, per-WebID isolation, cross-tab refresh, opt-in behavior and logout races. Update the
API report after rebuilding both new entry points.
