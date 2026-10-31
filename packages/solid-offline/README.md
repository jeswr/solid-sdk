<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
- Cache policy and invalidation: `classifyResponse`, `handleNotification`, `resyncSweep`.
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
backoff config fields are removed. The worker receives only `storageRoot`, never either client
or the authenticated fetch. It resolves its own credential-free StorageClient.

HTTP cache policy remains authoritative: invalidation retains original response headers at
the worker transport boundary. A low-level injected storage without that HTTP evidence
conservatively evicts changed bytes instead of inventing cacheable responses.
React/status surfaces, BroadcastChannel updates, and `purgeForWebId` retain their contracts.

## Links

- [Source](https://github.com/jeswr/solid-offline)
- [Issues](https://github.com/jeswr/solid-offline/issues)
- [Service Worker API](https://developer.mozilla.org/docs/Web/API/Service_Worker_API)

## License

MIT © Jesse Wright
