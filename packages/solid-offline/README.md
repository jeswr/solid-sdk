<!-- AUTHORED-BY Codex GPT-5 -->

# solid-offline

An offline-first service-worker layer for Solid apps with stale-while-revalidate caching, bounded
warming, notification invalidation, and optional React hooks.

> Experimental. Cached pod data is never authoritative and must be revalidated against the pod.

## Install

```sh
npm install github:jeswr/solid-offline#main
```

Requires Node.js 22 or newer for package tooling. Install `react` separately only when using the
`solid-offline/react` entry.

## Minimal usage

```ts
import { createOfflineClient } from 'solid-offline';

declare const authenticatedFetch: typeof fetch; // Supplied by your Solid session.

const offline = createOfflineClient({
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
import 'solid-offline/worker';
```

## Key API

- Page client: `createOfflineClient`, `createStatusSurface`, `createWarmController`, `warm`.
- Cache policy and invalidation: `classifyResponse`, `handleNotification`, `resyncSweep`.
- Identity cleanup: `purgeForWebId`; `offline.logout()` purges both Cache API and IndexedDB data.
- Worker entry: `solid-offline/worker`.
- React entry: `useOfflineStatus` and `useOfflineResource` from `solid-offline/react`.

The service worker stores no credentials. Authenticated warming happens in the page through the
caller-supplied fetch, and cache state is scoped by WebID.

## Links

- [Source](https://github.com/jeswr/solid-offline)
- [Issues](https://github.com/jeswr/solid-offline/issues)
- [Service Worker API](https://developer.mozilla.org/docs/Web/API/Service_Worker_API)

## License

MIT © Jesse Wright
