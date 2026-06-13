# @solid/offline

Offline-first drop-in layer for Solid apps. A service worker intercepts `fetch`,
caches the user's documents **never-authoritatively**, and (in later phases)
proactively warms the cache and subscribes to change notifications so app reads
usually hit the pre-fetched cache.

Built strictly to the canonical design
(`prod-solid-server/docs/offline-first-architecture.md`). **This package
currently implements P0 (scaffold + SW registration) and P1 (read cache).** The
warmer (P2), notification invalidation (P3), in-place viewer (P4), DX hooks +
logout-purge (P5), and offline writes (v2) are **not** built yet.

## Install

```sh
npm install @solid/offline n3
```

## Use (page client — P0)

```ts
import { createOfflineClient } from '@solid/offline';

const offline = createOfflineClient({
  webId: 'https://alice.example/profile/card#me',
  warm: { seeds: 'auto', budget: { resources: 500, bytes: 50_000_000 } }, // stored; used in P2
  notifications: true, // stored; used in P3
  workerUrl: '/solid-offline-worker.js',
});

await offline.register();

// React to background cache updates (the SW broadcasts these after revalidation):
offline.onUpdated(({ url, etag }) => {
  // re-render the view of `url` — it changed on the server
});
```

The `warm` and `notifications` config is **accepted, validated, and forwarded to
the service worker now** so the wire is ready, but the warmer/notification
behaviour lands in P2/P3.

## Use (service worker — P0/P1)

Ship a one-line worker at the path you passed as `workerUrl` (it must be served
from your origin so its scope covers your pod reads):

```js
// /solid-offline-worker.js
import '@solid/offline/worker';
```

(Or bundle `@solid/offline/worker` into a standalone classic worker if you don't
serve ES-module workers.)

## What P1 does (read cache, §2 of the design)

On a cacheable **GET/HEAD**:

- **Two stores.** Response **bytes** go in the Cache API; a metadata record
  `{url, etag, contentType, fetchedAt, vary, aclStatus, lastState, status}` goes
  in IndexedDB (the queryable, revalidatable client analogue of the server's
  QLever index).
- **Cache key = (url, varyKey).** `varyKey` is computed from the response `Vary`
  against the request headers. RDF reads are normalized to a canonical
  `Accept: text/turtle` so all RDF variants share one entry; `Origin` is ignored
  for keying (same-origin SW).
- **stale-while-revalidate, never-authoritative.**
  - hit + online → serve cached bytes **immediately** and fire a background
    `fetch(url, { If-None-Match: etag })`. `304` confirms (touch `fetchedAt`);
    `200` replaces the entry and broadcasts `{url, event:'updated'}`.
  - hit + offline → serve cached bytes **with `X-Offline: stale`**.
  - miss → network, cache iff cacheable.
- **Never cache:** `Cache-Control: no-store`/`private`; non-GET/HEAD; 4xx/5xx
  **except** a short-TTL negative cache of 403/404 (crawl pruning + no-leak
  parity); auth/token/OIDC/`.well-known`/subscription/WS-upgrade endpoints;
  opaque cross-origin responses (unreadable ETag).

### The never-authoritative invariant

A value served from the cache is **always provisional** — it is only trusted
once a conditional revalidation confirms its ETag. This mirrors the server rule
(`prod-solid-server/CLAUDE.md`: *"the cache is never authoritative; cache by
(key, etag); validate against the ETag."*). It is enforced structurally in
`src/swr.ts`: every online hit fires a conditional revalidation, every offline
hit is tagged `X-Offline: stale`, and the engine never fabricates a response the
cache cannot back.

## Verified vs assumed

- **Verified headlessly** (`npm test`, 49 unit tests via `vitest` +
  `fake-indexeddb` + Cache/fetch mocks): the cacheable/never-cache classifier,
  cache-key/varyKey computation, the full SWR decision tree (hit→serve+
  revalidate, 304 vs 200, offline→stale, miss→network+store, never-cache
  passthrough), negative-cache TTL for 403/404, opaque-response skip, and the
  IndexedDB metadata store.
- **Assumed / not verified headlessly:** the real ServiceWorker lifecycle
  (`install`/`activate`/`claim`/`fetch` events), the Cache API against a real
  browser, and `navigator.serviceWorker.register`. `src/worker.ts` and
  `src/index.ts` are thin adapters over the tested decision logic; they need a
  real browser (or Playwright) to exercise end-to-end. That is expected at P0/P1
  and is covered by the later phases' integration work.

## Scripts

| Script | What |
|---|---|
| `npm run build` | tsup → ESM bundles for `index` + `worker` (+ d.ts) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome |
| `npm test` | Vitest (headless) |
| `npm run test:coverage` | Vitest + v8 coverage |

## License

MIT
