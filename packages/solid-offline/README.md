<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/solid-offline

An offline-first service-worker layer for Solid apps with stale-while-revalidate caching, bounded
warming, notification invalidation, and optional React hooks.

> Experimental. Cached pod data is never authoritative and must be revalidated against the pod.

## Install

```sh
npm install github:jeswr/solid-offline#main
```

Requires Node.js 22 or newer for package tooling. Install `react` separately only when using the
`@jeswr/solid-offline/react` entry.

## Minimal usage

```ts
import { createOfflineClient } from '@jeswr/solid-offline';
import { createPodClient } from '@jeswr/storage-client';

declare const authenticatedFetch: typeof fetch; // Supplied by your Solid session.

const { storage } = await createPodClient({
  storage: 'https://alice.example/',
  fetch: authenticatedFetch,
});
const offline = createOfflineClient({
  storage,
  webId: 'https://alice.example/profile/card#me',
  fetch: authenticatedFetch,
  warm: { seeds: 'auto' },
  notifications: true,
  workerUrl: '/solid-offline-worker.js',
});

await offline.register();

// Mandatory when this identity signs out.
await offline.logout();
```

Put the following in a separate worker source file and configure your build to emit it as
`/solid-offline-worker.js` on the same origin and scope as the app:

```js
import '@jeswr/solid-offline/worker';
```

## Key API

- Page client: `createOfflineClient`, `createStatusSurface`, `createWarmController`, `warm`.
- Invalidation and reconciliation: `handleNotification`, `resyncSweep`.
- Identity cleanup: `purgeForWebId`; `offline.logout()` purges both Cache API and IndexedDB data.
- Worker entry: `@jeswr/solid-offline/worker`.
- React entry: `useOfflineStatus` and `useOfflineResource` from `@jeswr/solid-offline/react`.

The service worker stores no credentials. Authenticated warming happens in the page through the
transport already injected into `storage`, and cache state is scoped by WebID.

Warming uses `storage.head`, `read`, and paginated `listAll`; explicit `warm.seeds` are
combined with profile/type-index seeds inside the storage boundary. For a WebID outside
that boundary, supply explicit seeds (or a pre-fetched profile to the low-level warmer).
Large binary members remain lazy. Existing SW cache names and metadata schemas are retained.

Notifications use `@jeswr/pod-notifications` for transport selection, polling, scope checks,
and reconnect. Pass an existing `notificationsClient` to share the app's client; otherwise
one is created from `storage` and the authenticated `fetch`. Changes invalidate resources
and membership listings; `resync` performs fresh HEAD observations and conditionally reads
changed entries. Backoff is owned by pod-notifications; the old socket/discovery helpers and
backoff config fields are removed. The worker receives `storageRoot` and cloneable backend
identity, never either client or the authenticated fetch. It uses page-side backend evidence
or discovers its own credential-free StorageClient when that evidence is absent.

HTTP cache policy remains authoritative: invalidation retains original response headers at
the worker transport boundary. A low-level injected storage without that HTTP evidence
conservatively evicts changed bytes instead of inventing cacheable responses.
React/status surfaces, BroadcastChannel updates, and `purgeForWebId` retain their contracts.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Revalidation status

Background SWR reads, forced `Cache-Control: no-cache` reads, notification updates,
container-listing refreshes, and reconnect sweeps broadcast on `solid-offline` (or the
configured channel). Every started attempt emits `{ url, event: 'revalidating', attemptId }`, followed
by exactly one terminal message:

| Event | Meaning | Status for a tracked URL |
| --- | --- | --- |
| `revalidating` | Revalidation started | `pending` |
| `revalidated` | A conditional 304 or matching sweep HEAD confirmed the existing bytes | `fresh`, preserving an unread `updated` |
| `updated` | Replacement, deletion, revocation, or a purge completed | `updated`; re-read |
| `revalidate-failed` | Network/offline, storage, or non-authoritative HTTP failure | Retain settled freshness, including manual marks |

Messages contain only `url`, `event`, and an opaque random `attemptId` shared by the start
and its terminal message; no response bytes, headers, credentials, or error details.
`OfflineEvent` includes all messages. `UpdatedEvent` and `offline.onUpdated`
remain available; its optional `etag` field remains type-compatible but is not emitted.
Direct delete purges also emit balanced `revalidating` / `updated` events (or
`revalidate-failed` if the purge fails), without fetching. Offline cache hits,
ETag notification short-circuits, and skipped SWR validations emit no lifecycle events.
An unsolicited 304 on an unconditional listing refresh fails confirmation.

The status surface updates only URLs already tracked by `markFresh`, `markStale`, or
`markPending`. Parallel observed attempts keep a URL pending until all settle. Attempt IDs
ensure a completion whose start predates subscription cannot settle newer observed work,
including when `offline.status` is created lazily. Older senders without IDs retain URL-based
counting; they cannot provide this subscription-race guarantee. Settled freshness
records manual marks made during those attempts, so failures preserve the latest observation.
An unread `updated` survives later 304 confirmations until the consumer marks its read.
`markFresh` acknowledges a fresh read, including during pending work. `forget` drops its status history.
Manual `markPending` calls still count toward pending work.

```ts
import { useOfflineStatus } from '@jeswr/solid-offline/react';

const { syncing, pending, online } = useOfflineStatus(offline.status);
// syncing === (pending > 0); use it to render a “Syncing…” indicator.
```

## Links

- [Source](https://github.com/jeswr/solid-offline)
- [Issues](https://github.com/jeswr/solid-offline/issues)
- [Service Worker API](https://developer.mozilla.org/docs/Web/API/Service_Worker_API)

## License

MIT © Jesse Wright
