<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- // AUTHORED-BY Codex GPT-6 -->

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
- Durable writes: `createOutbox`, `withOutbox`, `Outbox`, `OutboxItem`, `ConflictRecord`, and
  `QueueingStorageClient` from `@jeswr/solid-offline/outbox`.
- RDF merge: `mergeRdf` from `@jeswr/solid-offline/merge`.
- Worker entry: `@jeswr/solid-offline/worker`.
- React entry: `useOfflineStatus` and `useOfflineResource` from `@jeswr/solid-offline/react`.

The service worker stores no credentials. Authenticated warming happens in the page through the
transport already injected into `storage`, and cache state is scoped by WebID.

Warming uses `storage.head`, `read`, and paginated `listAll`; explicit `warm.seeds` are
combined with profile/type-index seeds inside the storage boundary. For a WebID outside
that boundary, supply explicit seeds (or a pre-fetched profile to the low-level warmer).
Large binary members remain lazy. Pod bodies and metadata now share the account-scoped IndexedDB database; the Cache API remains for public app-shell assets.

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

## Native page cache (MOB-P3e)

```ts
import { createPageCache } from '@jeswr/solid-offline';

const offline = createPageCache({
  webId: account.webId,
  storageRoot: account.storageUrl,
  fetch: authenticatedFetch,
  usable: () => isCurrentLiveAccount(account),
  onEvent: event => { /* Re-read views on event.event === 'updated'. */ },
});
await offline.start(); // Optional built-in pod-notifications subscriptions.
const response = await offline.fetch(resourceUrl);
// On logout or account switch, fence immediately and await shared cleanup:
const purge = await offline.logout();
if (purge.dbBlocked || purge.errors.length) { /* Surface incomplete cleanup. */ }
```

This driver needs IndexedDB and no service worker or Cache API. It uses the worker's
`handleFetch`, cache policy, canonical keys, metadata builder, notification handler,
ETag sweep and `purgeForWebId`; it does not implement a second cache policy.
Native reads are network-first with conditional ETag validation. The existing worker
keeps its default stale-while-revalidate delivery mode over the same engine and store.
Offline or a transport TypeError may return provisional bytes marked
`X-Solid-Offline-Cache: stale` and `X-Offline: stale`. HTTP failures, cancellation,
session errors and explicit freshness requests never become stale successes.
`no-store` bypasses reads and writes even offline. HEAD stays a network passthrough;
mutations, ranges, auth endpoints and requests outside the storage boundary bypass caching.
Redirected, opaque, credential-varying, private and no-store responses are not stored.
Neither request credentials nor sensitive response headers are persisted.

`usable()` is mandatory: pass the session's live account/generation fence, including
changes React has not committed. It is checked around network and disk awaits and before
delivery. `close()` permanently fences this adapter and releases subscriptions/DB handles,
but retains its reads for reopening by the same identity. `logout()` fences synchronously,
then deletes the same database (bodies and metadata) as the worker; it retains the outbox.
The database namespace includes the full encoded WebID, so 32-bit hash collisions cannot
cross accounts. Old hash-only databases and Cache API copies are also purged on logout.
Old stores are not migrated or served; the first online read populates the new namespace.

`start()` watches the root plus up to 49 read resources using pod-notifications; resource
subscriptions cover edits that Solid container subscriptions cannot observe. It reconciles
on setup, first-live and resync. Call it again on reconnect if initial setup failed/offline.
You may instead feed normalized changes through `notify(frame)` and call `resync()` yourself.
`indexedDB`, `isOnline`, `now` and `notificationsClient` are injectable test seams. Individual bodies are limited to 25 MiB (declared and streamed); larger reads stay
network-only. Cache storage failure preserves an available network answer; offline disk failures fail closed.
Actual WebView persistence and service-worker lifecycle still require device/browser checks.

## Response cache provenance

For readable pod GET responses inside the configured storage root, the worker sets
`X-Solid-Offline-Cache` (`CACHE_PROVENANCE_HEADER`):

| Value | Meaning |
| --- | --- |
| `miss` | Network bytes, stored when HTTP cache policy permits. Includes readable `no-store`/`private` responses and network fallbacks. |
| `hit` | Cached bytes confirmed by a synchronous conditional 304, or a cached 403/404 still within its bounded negative TTL (including offline). |
| `stale` | Provisional cached bytes served offline or immediately while background revalidation is pending, skipped, or fails. |

An immediate SWR response stays `stale` even if its background revalidation later succeeds;
its header describes the bytes at serving time. Ordinary offline positive-cache reads remain
`stale`. The legacy `X-Offline: stale` marker is retained on those offline reads.
Headers are added to cloned responses; stored entries are never tagged or mutated.
Out-of-scope requests, HEAD, and app-shell responses are unchanged. Opaque/opaque-redirect
and status-zero responses pass through unchanged because browsers hide their headers.

```ts
import { cacheProvenance, CACHE_PROVENANCE_HEADER } from '@jeswr/solid-offline';

const provenance = cacheProvenance(response); // 'hit' | 'miss' | 'stale' | null
const fromCache = provenance === 'hit' || provenance === 'stale';
const stale = provenance === 'stale';
// null means the response has no recognized marker; the body remains unread.
```

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Write outbox

```ts
import { createOutbox, withOutbox } from '@jeswr/solid-offline/outbox';

const webId = 'https://alice.example/profile/card#me';
const outbox = createOutbox({ webId });
await outbox.ready; // Hydrate the synchronous pending()/conflicts() snapshots.
const queuedStorage = withOutbox(storage, outbox);
const offline = createOfflineClient({ storage, webId, outbox });
await offline.register(); // Replay now, then on window online events.

await queuedStorage.write(documentUrl, bytes, {
  contentType: 'text/turtle',
  ifMatch: documentEtag,
  offline: 'queue',
});
const unsubscribe = outbox.on('change', () => renderQueue(outbox.pending()));
// Later: unsubscribe(); offline.close(); outbox.close();
```

`write`, `writeRdf`, `create`, and `delete` queue only with `offline: 'queue'`, when the
browser reports offline or the operation fails with a network error. Other failures still
throw. A queued write/create returns `{ url, etag: null, created: false, queued: true }`;
`delete` continues to return void. Calls without the option pass through to storage.
`patch` and `move` remain unqueueable in v1. Bodies, including streams, are captured before
an opted-in attempt, so a failed upload cannot consume the only local copy. This buffers
the complete body in memory. Queued `writeRdf` bodies retain Turtle or expanded, context-free JSON-LD as requested.
Named graphs require JSON-LD. Serialization validates RDF/JS term fields and does not trust
private N3 IDs; prefixes are omitted from queued Turtle because they affect only presentation.
Creates without a name receive a stable `offline-<uuid>` name. Named Solid creates use
`If-None-Match: *`; LWS retains its server-assigned identifier behavior.

`pending()` includes waiting, replaying, failed and conflicted items, ordered by creation time
with FIFO ties. `replay(storage, { onProgress, signal })` sends sequentially with the original
validators. Network failure leaves the current item waiting and stops the pass; other errors
mark it failed with a readable error. A 412 records a conflict and holds all items for that
URL while other URLs continue. `retry(id?)` requeues one or all failed items and replays using
the client supplied by `withOutbox` or the most recent `replay`. Progress is reported per item
in bytes at start `(0, size)` and successful completion `(size, size)`; streaming upload
progress is a later improvement. Deletes have size zero.

`conflicts()` returns metadata; `await localBody(conflictId)` retrieves the local bytes without
putting bodies in snapshots or broadcasts. `resolve(id, 'mine')` HEADs for a current ETag and
conditionally overwrites (or deletes); an absent ETag or a failed request retains the conflict.
`'theirs'` discards the local change. `'both'` creates a sibling: binary `photo-conflict-<ms>.jpg`,
RDF `note (copy).ttl`, preserving the extension. A name collision retains the conflict rather
than replacing an existing copy. Keep-both does not apply to deletions. Resolution removes
only the conflicted item; call `replay(storage)` to resume items held behind it.

The queue and its BroadcastChannel use the full WebID in a separate namespace. Reopen the same
WebID's outbox to recover unsent changes; `await outbox.purge()` explicitly discards them.
**Logout purges read caches but retains the outbox.** `offline.close()`/`logout()` removes online
listeners and aborts replay; instantiate/register the next client only for its active session.
The configured queue's WebID must match `createOfflineClient`'s WebID. `outbox.close()` releases
its listeners without purging persisted items. Browser Web Locks serialize replay across tabs;
without Web Locks, only same-realm instances are serialized. Cross-tab changes refresh snapshots
and emit `change`/`conflict` events without broadcasting bodies, credentials, URLs or ETags.
Network failures after a server commits a mutation remain ambiguous; the queue does not promise
exactly-once delivery, especially for LWS creates.

`mergeRdf(base, local, remote)` accepts RDF/JS datasets or quad iterables and returns a deduplicated
quad array using `(remote − (base − local)) ∪ (local − base)`. It compares all four terms with
`.equals` and preserves the input terms. It does not detect vocabulary-level conflicts such as
two values for a functional property. Blank nodes compare by their supplied labels; skolemise
first if independently parsed documents do not share stable labels.

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
