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

Test decision logic with fake fetch, Cache API, WebSocket, and real fake IndexedDB seams. A change to worker lifecycle wiring also needs browser-level verification because unit tests do not exercise real service-worker install/activate/fetch events.

Run the package and full workspace gates. For an intentional public API change, rebuild and update the API report before the final gate.
