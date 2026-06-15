# solid-offline

> ⚠️ **Experimental — AI-agent-generated.** This package was created by an AI coding agent (Claude Opus 4.8, @jeswr's PSS agent) and is under active development. It is not yet production-hardened — review before relying on it.

Offline-first drop-in layer for Solid apps. A service worker intercepts `fetch`,
caches the user's documents **never-authoritatively**, and (in later phases)
proactively warms the cache and subscribes to change notifications so app reads
usually hit the pre-fetched cache.

Built strictly to the canonical design
(`prod-solid-server/docs/offline-first-architecture.md`). **This package
currently implements P0 (scaffold + SW registration), P1 (read cache), P2
(page-driven proactive warmer), P3 (notification-driven invalidation), and P5
(React/vanilla DX hooks + status surface + WebID-scoped cache + mandatory
logout-purge).** In-place viewer (P4) and offline writes (v2) are **not** built
yet.

## Install

```sh
npm install solid-offline n3
```

## Use (page client)

```ts
import { createOfflineClient } from 'solid-offline';

const offline = createOfflineClient({
  webId: 'https://alice.example/profile/card#me',
  // P2: page-driven warmer. Defaults: 500 resources / 50 MB / depth 6 / concurrency 4.
  warm: { seeds: 'auto', budget: { maxResources: 500, maxBytes: 50_000_000 } },
  // Pass your DPoP-decorated fetch so the warmed reads are authenticated.
  // The service worker itself NEVER authenticates (design decision 1).
  fetch: session.fetch,
  // P3: page-side WebSocketChannel2023 client. `true` derives topics from the
  // warmed containers; pass an object to set explicit containers/resources/caps.
  notifications: true,
  workerUrl: '/solid-offline-worker.js',
});

await offline.register(); // also schedules the first warm on idle + starts notifications

// Or trigger / await a warm explicitly:
const result = await offline.warm();
// → { warmed, visited, bytes, pruned, budgetHit, visits }

// React to background cache updates (the SW broadcasts these after revalidation):
offline.onUpdated(({ url, etag }) => {
  // re-render the view of `url` — it changed on the server
});

// P5 (§7): MANDATORY on sign-out — purge this WebID's Cache API + IndexedDB.
await offline.logout();
```

## What P3 does (notification invalidation, §5 of the design)

Live correctness without polling, joined to the server via the change frame's
ETag (`state`).

- **The WebSocket lives in the PAGE, never the SW** (decision 5: the SW is
  event-driven and terminated, so it can't hold a socket). The page discovers the
  subscription service (the `storageDescription` Link rel → `notify:subscription`,
  with a `/.well-known/solid` fallback), subscribes **per-container** (capped by
  `maxChannels`) + **per-resource** for hot resources, opens the `receiveFrom`
  socket, and `postMessage`s each change frame to the SW. The page holds the auth;
  the SW only invalidates.
- **Invalidation pipeline (in the SW).** On a frame, the SW looks the resource up
  in the P1 metadata store and:
  - **ETag short-circuit** — if `frame.state` equals the ETag we already hold, the
    change is one *we* caused; it's a free no-op (no fetch, no broadcast).
  - else **revalidate** with `If-None-Match` (`Create`/`Update`) or **re-fetch the
    container listing** (`Add`/`Remove`, where membership can't be confirmed by a
    bare ETag), or **purge** (`Delete`/403/404), then update Cache + metadata and
    `BroadcastChannel` `{url, event:'updated'}` to every tab.
- **Reconnect = exponential backoff + re-subscribe** (channels are one-shot). While
  disconnected the SW slow-polls the warmed set with `If-None-Match`; on every
  (re)connect the page asks the SW to run **one ETag-resync sweep** — a flat
  conditional-GET pass over the whole warmed set (mostly cheap `304`s) that catches
  up on frames missed while down.

The SW's invalidation/resync GETs are **unauthenticated** (the SW holds no key).
For a private resource a resync GET may `401`/`403` and purge the entry; the
page's own authenticated read/warm then re-populates it. A SharedWorker token
authority (v2 / P6) removes this asymmetry.

The page client (`createNotificationsClient`, `discoverSubscriptionUrl`,
`subscribe`, `parseFrame`, `backoffDelay`) and the SW pipeline
(`handleNotification`, `resyncSweep`) are exported and unit-tested with a fake
WebSocket + fake fetch + the real `fake-indexeddb` metadata store.

## What P5 does (DX hooks + status + WebID-scoping + logout-purge, §7)

DX surface for app code, plus the §7 privacy controls.

### WebID-scoped cache (a different identity never reads another's cache)

Both persistent stores are namespaced by a short, stable hash of the WebID:

- the IndexedDB metadata DB → `solid-offline:<webId-hash>`
- the Cache API bytes cache → `solid-offline-cache:<webId-hash>`

(See `scope.ts`; `dbNameForWebId` / `cacheNameForWebId` are exported.) The hash is
a *namespacing discriminator*, not a security boundary — origin isolation is the
real boundary. Scoping by identity on top of that lets two identities share a
device/origin without observing each other's bytes or metadata, and lets purge
target exactly one identity.

### Mandatory logout-purge

On sign-out you **must** drop everything the offline layer cached for that
identity (parallels the credential wipe):

```ts
await offline.logout(); // deletes the Cache API cache + IndexedDB DB for this WebID, then close()s
```

Or call the primitive directly: `purgeForWebId(webId, { caches, indexedDB })`.
It is best-effort but total: a missing store is a success, and a failure on one
half does not stop the other (the outcome is reported back).

### Status surface (offline / stale / pending) — framework-agnostic

```ts
const status = offline.status; // or createStatusSurface({ channelName })
status.subscribe(() => render(status.getSnapshot()));
// snapshot: { online, pending, stale, updated, resources: { [url]: 'fresh'|'stale'|'pending'|'updated' } }
status.markPending(url); status.markStale(url); status.markFresh(url);
```

It listens to the same `BroadcastChannel` the SW broadcasts `updated` on, so any
tab's revalidation flips status in every tab. It is a plain `subscribe`/
`getSnapshot` store (referentially stable snapshots) so it drives
`useSyncExternalStore` directly.

### React hooks (`solid-offline/react`) — optional

`react` is an **optional peer dependency**; the core imports nothing from React.

```tsx
import { useOfflineStatus, useOfflineResource } from 'solid-offline/react';

function Connectivity() {
  const { online, pending, stale } = useOfflineStatus(offline.status);
  return <span>{online ? 'online' : 'offline'} · {pending} pending · {stale} stale</span>;
}

function Doc({ url }: { url: string }) {
  // Reads THROUGH your fetch (so the SW caches it), re-reads on an `updated`
  // broadcast for `url`, and surfaces stale/pending/outdated.
  const { data, pending, stale, outdated, reload } = useOfflineResource(url, {
    fetch: session.fetch,
    select: (r) => r.text(),
  });
  // ...
}
```

Both hooks are THIN (`useSyncExternalStore` over the BroadcastChannel — tear-free
under React 18 concurrency); they own no caching/fetch policy — that stays the
SW's job. Unit-tested in `jsdom` with real React + `@testing-library/react`.

## What P2 does (page-driven warmer, §3 of the design)

After login, on idle (`requestIdleCallback`, with a `setTimeout` fallback), the
**page** crawls the user's documents and pulls them through its own
(DPoP-decorated) `fetch`, so the P1 service worker intercepts and caches them.
**The SW never authenticates** (decision 1) — the warmer just *causes* the right
authenticated reads to flow through it.

- **Seeds, in priority order:** WebID profile → `pim:storage` root →
  **Type Index** (public + private) → ACLs → inbox. **Type-Index-first**
  (decision 6) so the index-named resources warm before generic BFS expansion.
- **Bounded BFS over `ldp:contains`** with dedup (cycles can't loop).
- **ACL-aware.** It reads `WAC-Allow` on listings; a subtree the user can't read
  is pruned without wasted fetches, and a `403`/`404` on a child is **caught,
  negative-cached, and its subtree pruned — never surfaced as an error**.
- **Budget (decision 6 defaults):** `maxResources: 500`, `maxBytes: 50_000_000`,
  `maxDepth: 6`, `concurrency: 4`. The crawl stops cleanly at any limit.
- **Large binaries** (`image/*`, `video/*`, …, or `Content-Length` over ~5 MB)
  are **listing/metadata-warmed only** — their bytes are fetched lazily on first
  real read.
- **Reconnect (refactored in P3).** When notifications are enabled, an `online`
  event runs the dedicated **ETag-resync sweep** (a flat conditional-GET pass over
  the warmed set) instead of re-issuing the full BFS — the gap P2 flagged. Without
  notifications it falls back to the P2 full re-warm.

The warmer's pure logic (seed derivation, BFS + dedup, budget enforcement, ACL
pruning + negative-cache, Type-Index-first ordering, concurrency cap) is
exported (`warm`, `createWarmController`, `deriveSeeds`, …) and exhaustively unit
tested with a URL-routed mock fetch + Turtle fixtures.

## Use (service worker — P0/P1)

Ship a one-line worker at the path you passed as `workerUrl` (it must be served
from your origin so its scope covers your pod reads):

```js
// /solid-offline-worker.js
import 'solid-offline/worker';
```

(Or bundle `solid-offline/worker` into a standalone classic worker if you don't
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

- **Verified headlessly** (`npm test`, 103 unit tests via `vitest` +
  `fake-indexeddb` + Cache/fetch/WebSocket mocks): the cacheable/never-cache
  classifier, cache-key/varyKey computation, the full SWR decision tree
  (hit→serve+revalidate, 304 vs 200, offline→stale, miss→network+store,
  never-cache passthrough), negative-cache TTL for 403/404, opaque-response skip,
  the IndexedDB metadata store, **the P2 warmer** (seed derivation +
  Type-Index-first ordering, BFS + dedup, budget enforcement, ACL/WAC pruning +
  negative-cache, large-binary skip, concurrency cap, ACL Link-header derivation,
  idle/reconnect triggers), and **the P3 notifications + invalidation**: endpoint
  discovery (Link rel + `/.well-known/solid` fallback), the subscribe POST →
  `receiveFrom`, frame parsing, message→SW forwarding, the **ETag short-circuit**
  no-op, Update→revalidate→broadcast (200 vs 304), Add/Remove→listing re-fetch,
  Delete/403/404 purge, reconnect backoff + re-subscribe, disconnected slow-poll,
  and the reconnect ETag-resync sweep (incl. URL dedup + negative-entry skip).
- **Assumed / not verified headlessly:** the real ServiceWorker lifecycle
  (`install`/`activate`/`claim`/`fetch`/`message` events), the Cache API against a
  real browser, `navigator.serviceWorker.register`, and a **live
  WebSocketChannel2023 socket** against a real prod-solid-server (discovery /
  subscribe / frame delivery are exercised against a fake socket + fake fetch
  only). `src/worker.ts` and `src/index.ts` are thin adapters over the tested
  decision logic; a full end-to-end run needs a real browser (or Playwright) and a
  live pod — integration work deferred to the later phases.

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
