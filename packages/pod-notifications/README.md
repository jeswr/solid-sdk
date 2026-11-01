<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-notifications

> **Experimental — AI-agent-generated.** Core subscriptions, polling and WebSockets (T-040/T-041).

One storage-scoped change API for Solid and LWS. Private at version 0.1.0; Node.js >=24.
Design of record: SDK core `ADR-005-live-updates.md` and ADR-001 D4.

```ts
import { createNotifications } from '@jeswr/pod-notifications';

// storage is the public StorageClient returned by createPodClient().
const notifications = createNotifications({ fetch: authenticatedFetch, storage });
const subscription = await notifications.subscribe([storage.root], {
  hot: [noteUrl], // Observe this resource's ETag as well as container membership.
  pollIntervalMs: 30_000,
  signal: abortController.signal,
});
const unsubscribe = subscription.on('change', (event) => {
  // An invalidation hint: re-read event.object with your storage client.
  console.log(event.type, event.object);
});
// Alternatively: for await (const event of subscription) { ... }
unsubscribe();
await subscription.close();
```

`plan()` selects the first advertised usable channel: WebSocket, SSE, LWS webhook with a
configured relay, legacy WebSocket, then polling. It reads `storage.features.liveUpdates`
without I/O; unavailable/unknown features cannot select push. Advertised WebSockets now use
the push adapters. SSE, webhook relay and legacy WebSocket implementations remain reserved
for T-042/T-043; those preferences still use polling in this cut. `channel` reports the
actual transport (`websocket`, `poll`, or `null` when polling is disabled).

WebSocket channels rediscover through the storage-client public `createPodClient` API with
a fresh metadata cache on each attempt. Solid sends an authenticated `application/ld+json`
POST per topic, using the notifications context and the advertised WebSocketChannel2023 IRI.
LWS sends one `application/lws+json` WebSocketSubscription with all deduplicated topics and
a 24-hour expiry. Optional Solid `state`, `rate` and `endAt` fields are omitted. The
returned `receiveFrom` opens a plain WebSocket without a subprotocol or auth headers.
LWS `subscription` URLs are retained and DELETEd on disconnect/close, best effort; `close()`
awaits outstanding deletions. A late subscribe response after cancellation is also cleaned up.

HTTP endpoints must use HTTPS and sockets must use WSS. `receiveFrom` and LWS subscription
URLs must have the same host (including port) as the storage or discovered subscription
service. Credentials, fragments, controls and backslashes are rejected; redirects are refused.
Set `allowInsecureLoopback: true` only for local development: HTTP/WS then require both storage
and destination to be literal loopback (`localhost`, `127.0.0.0/8`, or `[::1]`). Socket URLs
may carry short-lived tokens and are never logged.

The subscription becomes `live` once every topic socket opens. Close/error or 90 seconds
without a message (including a ping) closes the sockets and enters `degraded`/`reconnecting`.
Connection attempts also have a 90-second socket deadline. Retries sample full jitter from
an exponential ceiling starting at one second and capped at 60 seconds, applying the ADR's
one-second minimum; opening all sockets resets the retry count. Each retry rediscovers and
POSTs for fresh channel URLs. Successful reconnection emits `resync(sinceLastFrame)` so the
consumer can reconcile missed changes; the initial uninterrupted connection does not emit it.
With several sockets, the resync timestamp is the earliest last-frame time, preserved through
partial reconnects so a busy topic cannot hide a silent sibling's missed changes.
If one Solid topic fails, the subscription reconnects all topics together. Polling does not
run alongside WebSockets. Browser offline events abort requests and suspend sockets/retries;
online schedules immediate rediscovery. Any discovery/subscribe 403 closes with `forbidden`.

Polling starts on the next timer turn with a quiet HEAD/listAll baseline, then repeats every
30 seconds by default. Changed non-null ETags produce `Update`; complete membership diffs
produce `Create` with `target` and `Delete` with `origin`. Missing ETags do not imply updates;
listings still detect membership changes. A failed page never commits a partial snapshot.
Every polling HEAD and listing page requests HTTP cache revalidation through the storage API.
Polling is serial across topics and ticks, without overlapping requests. The public storage
client owns authentication, scope checks and pagination. No direct backend calls are used.

Polling and Solid container channels cover membership; LWS push subscriptions retain the
server's recursive container semantics. `depth` is best effort and does not introduce client
traversal. Add individual resources through `hot` to observe Solid content edits. Topics and
hot resources must be within the storage and are deduplicated. A zero poll interval disables
the polling fallback (`degraded`, reason `polling-disabled`, channel `null`) while still allowing
advertised WebSockets. Intervals must be integers between zero and 2,147,483,647 ms.

`navigator.onLine === false` suspends polling and aborts in-flight work. The browser's `online`
event starts immediate reconciliation; successful reconciliation emits `resync` with the offline
start time. Without browser connectivity globals, polling proceeds normally. Network/list
failures retry at the next interval; forbidden responses close with reason `forbidden`.
A HEAD reporting `not-found` (404/410) records absence and permits resync. Container listings
still emit membership deletions; a reappearing target establishes a fresh quiet baseline.
`close()` and signal abort release timers/listeners, abort requests and settle iterator waiters.
Observers can unsubscribe; observer exceptions are isolated so they cannot interrupt cleanup
or other consumers. Iterators observe changes from their creation, independently; iterator
return detaches only that iterator.

The internal `createChangeNormalizer({ storageId, isWithinStorage, via, now? })` returns a stateful function
accepting decoded Solid AS2 or LWS Notification objects. Use the description's canonical
`id` for `storageId`, which may differ from its LWS root. LWS activities may be an object or
array; a foreign storage id drops the envelope. Objects, targets and origins must be absolute,
credential-free, scoped HTTP(S) URLs. Unknown verbs/malformed activities are ignored; optional
foreign target/origin values are omitted. Compact and expanded AS2 verbs are accepted.
`published` defaults to the injected clock; invalid supplied dates are dropped. The normalizer
preserves the raw message and ETag `state`, synthesises missing ids, and deduplicates accepted
ids for exactly five seconds. Create a normalizer per subscription.

`./testing` exports `FakeTimers` (`now`, async `advanceBy`, `pending`), `FakeWebSocket` and
`FakeEventSource`. The transports expose explicit open/message/error/close events, listener
counts, socket sent frames and SSE event ids. Inject factories, `timers`, `now`, and `random`
through `createNotifications`. `./channels/poll` exposes the low-level `createPollChannel`
adapter; `./channels/websocket2023` and `./channels/lws-websocket` expose
`createWebSocket2023Channel` and `createLwsWebSocketChannel` with `WebSocketChannelOptions`.
Event-source factories remain reserved for the later SSE task. The solid-offline notification
implementation remains intact until T-062.

```sh
pnpm --filter @jeswr/pod-notifications run lint
pnpm --filter @jeswr/pod-notifications run build
pnpm --filter @jeswr/pod-notifications run typecheck
pnpm --filter @jeswr/pod-notifications run test
```

Behavioral/adversarial tests enforce 100% statement, branch, function and line coverage.
