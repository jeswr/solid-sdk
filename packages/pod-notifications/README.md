<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-notifications

> **Experimental — AI-agent-generated.** Core subscriptions and polling (T-040).

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
without I/O; unavailable/unknown features cannot select push. Push transports belong to
T-041/T-042 and their subpaths remain scaffolds in this cut. **Subscriptions currently use
polling even when `plan()` reports an advertised push transport.** `channel` reports the
actual transport (`poll`), and state becomes `degraded` with reason `polling`.

Polling starts on the next timer turn with a quiet HEAD/listAll baseline, then repeats every
30 seconds by default. Changed non-null ETags produce `Update`; complete membership diffs
produce `Create` with `target` and `Delete` with `origin`. Missing ETags do not imply updates;
listings still detect membership changes. A failed page never commits a partial snapshot.
Every polling HEAD and listing page requests HTTP cache revalidation through the storage API.
Polling is serial across topics and ticks, without overlapping requests. The public storage
client owns authentication, scope checks and pagination. No direct backend calls are used.

Containers cover direct membership; `depth` is best effort and does not introduce recursive
traversal. Add individual resources through `hot` to observe their content edits. Topics and
hot resources must be within the storage and are deduplicated. A zero poll interval disables
polling (`degraded`, reason `polling-disabled`, channel `null`). Intervals must be integers
between zero and 2,147,483,647 ms.

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
through `createNotifications`; socket/event-source factories and random are reserved for the
push implementations. `./channels/poll` exposes the low-level `createPollChannel` adapter.

```sh
pnpm --filter @jeswr/pod-notifications run lint
pnpm --filter @jeswr/pod-notifications run build
pnpm --filter @jeswr/pod-notifications run typecheck
pnpm --filter @jeswr/pod-notifications run test
```

Behavioral/adversarial tests enforce 100% statement, branch, function and line coverage.
