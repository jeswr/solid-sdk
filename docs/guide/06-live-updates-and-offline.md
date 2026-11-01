<!-- AUTHORED-BY Claude Opus 5.5 -->

# 6. Live updates, offline and collaboration

Several apps, tabs and devices can change the same pod. This chapter covers how to notice, how to
keep working without a connection, and how to edit a document together.

## Notice changes

`@jeswr/pod-notifications` gives you one `subscribe()` for every way a server can push changes:
Solid's WebSocket and streaming HTTP channels, LWS subscriptions, and polling when nothing else
works. The package skill, [pod-notifications](../../packages/pod-notifications/SKILL.md), has the
full contract.

```ts
import type { PodAuth } from '@jeswr/pod-auth';
import { createNotifications } from '@jeswr/pod-notifications';
import type { StorageClient } from '@jeswr/storage-client';

declare const auth: PodAuth;
declare const storage: StorageClient;
declare const container: string;
declare function refresh(url: string): void;
declare function relistEverything(): Promise<void>;

const notifications = createNotifications({ fetch: auth.fetch, storage });
const subscription = await notifications.subscribe([container], { depth: 'members' });

subscription.on('change', (event) => refresh(event.object));
subscription.on('resync', () => void relistEverything());
subscription.on('state', (state) => console.log('live updates:', state));

// When the view closes, or on logout:
await subscription.close();
```

The rule: **a notification means "this changed, go and look"**. Do not use the event's contents as
the new data. Re-read the resource through `storage`.

- `depth: 'members'` watches a container's members; `'recursive'` asks for the whole tree, where
  the server supports it. Neither watches edits inside every member on every server. Put the few
  resources the user is looking at right now in `hot`.
- `resync` fires after a gap, such as a dropped connection, when events may have been missed.
  Re-list then.
- `state` is `'live'`, `'degraded'` (polling, or reconnecting), `'connecting'` or `'closed'`.
  Show a quiet indicator when degraded; do not block the user.
- `notifications.plan()` tells you which channel it will use, without any network traffic.

## Keep the interface fast

Do not make the user wait for the pod. Update the screen first, write in the background, show a
small "Saving…" indicator, and roll back only the fields that failed. The
[solid-optimistic-ui skill](../../skills/solid-optimistic-ui/SKILL.md) covers the details that are
easy to get wrong, such as a late failure undoing a newer edit.

## Work offline

`solid-offline` adds a service-worker cache for pod data, scoped to the signed-in WebID and purged
on logout. Cached data is never the source of truth: it is shown straight away, marked stale when
offline, and checked against the pod when the connection returns.

- [solid-offline](../../packages/solid-offline/SKILL.md) is the package API.
- [solid-offline-patterns](../../skills/solid-offline-patterns/SKILL.md) covers app patterns:
  showing the last snapshot on start-up, and never mixing cached data between accounts.

A write queue for offline edits (an "outbox") is **not ready yet**. Until then, disable editing
controls when offline, or keep unsaved edits in local state and save them on reconnect.

## Edit together

For documents several people edit at once, such as text, drawings or spreadsheets, use Yjs with
`@jeswr/y-solid`. It stores a document as an append-only log of Yjs updates in a pod container and
compacts the log safely. Any change event for that container means "fetch the new updates".

Real-time sync through a server is advertised as `features.realtimeCollab`. When it is not
`'available'`, y-solid still works by reading and writing the update log.

See the [y-solid skill](../../packages/y-solid/SKILL.md).

Next: [sharing and permissions](07-sharing.md).
