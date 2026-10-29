---
name: solid-offline
description: Use when implementing or changing the solid-offline service-worker cache, proactive warmer, WebSocketChannel2023 invalidation, app-shell precache, WebID-scoped storage, logout purge, status surface, or React offline hooks.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `solid-offline`

Preserve the central invariant: cached pod data is never authoritative. Serve cached bytes quickly, mark offline hits stale, and revalidate online entries against the pod.

## Page-client workflow

```ts
import { createOfflineClient } from "solid-offline";

const offline = createOfflineClient({
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

Import `solid-offline/worker` from an origin-served service-worker entry. Import React-only helpers from `solid-offline/react`; React is an optional peer and must not leak into the core entry point.

## Security and correctness rules

- Keep the service worker credential-free. Authenticated warming happens in the page through the caller-supplied fetch.
- Scope Cache API and IndexedDB state by WebID. Anonymous and authenticated identities must never share a cache namespace.
- Purge both stores on logout. A failure in one purge path must not prevent attempting the other.
- Never cache auth, token, OIDC, notification-subscription, WebSocket-upgrade, opaque, `private`, or `no-store` responses.
- Cache response bytes only for GET. Treat HEAD as a network passthrough that may confirm existing
  metadata freshness when its ETag matches; never pass a HEAD request to `Cache.put()` and never let
  it replace or evict a cached GET body. Keep the bounded negative-cache behavior for 403/404 GETs.
- Respect `Vary`; normalize supported RDF reads to the canonical accept value without collapsing genuinely different variants.
- On an online hit, serve immediately and conditionally revalidate. A `304` refreshes metadata; a changed `200` replaces bytes and broadcasts an update.
- Treat notification `state`/ETag equality as a fast no-op, not a universal correctness assumption. Reconcile after disconnects.
- Bound warming by resource count, bytes, depth, and concurrency. Prune unreadable subtrees and avoid eager caching of large binary bodies.
- Keep app-shell caches versioned and separate from pod-data caches. Cache only explicitly declared public shell URLs.

## Status and React integration

Use `offline.status` or `createStatusSurface()` as a stable `subscribe`/`getSnapshot` store. `useOfflineStatus` and `useOfflineResource` should remain thin `useSyncExternalStore` adapters; caching policy stays in the service worker.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
The worker broadcasts `OfflineEvent` messages containing only URL, event, and an opaque
random `attemptId` shared by an attempt's start and terminal messages: `revalidating` starts an attempt;
exactly one of `updated` (replacement/purge), `revalidated` (confirmed 304), or
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

Test decision logic with fake fetch, Cache API, WebSocket, and real fake IndexedDB seams. A change to worker lifecycle wiring also needs browser-level verification because unit tests do not exercise real service-worker install/activate/fetch events.

Run the package and full workspace gates. For an intentional public API change, rebuild and update the API report before the final gate.
