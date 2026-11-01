---
name: pod-notifications
description: Use when watching Solid or LWS pod changes with @jeswr/pod-notifications, reconciling missed events, selecting push or polling, or managing subscription cleanup.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-notifications

## Quick reference

Create the client with `auth.fetch` from [pod-auth](../pod-auth/SKILL.md) and the `storage`
returned by [createPodClient](../storage-client/SKILL.md). It is scoped to one storage.
Notifications invalidate cached data; re-read through the storage API for authoritative state.

```ts
import { createNotifications } from '@jeswr/pod-notifications';
import type { StorageClient } from '@jeswr/storage-client';

export async function watchCollection(
  fetch: typeof globalThis.fetch,
  storage: StorageClient,
  hotResource: string,
  invalidate: (url: string) => void,
  reconcile: (since: Date) => void | Promise<void>,
  reportError: (error: unknown) => void,
) {
  const notifications = createNotifications({ fetch, storage });
  const subscription = await notifications.subscribe([storage.root], {
    depth: 'recursive',
    hot: [hotResource],
    pollIntervalMs: 30_000,
  });
  const stopChanges = subscription.on('change', event => {
    const affected = new Set([event.object]);
    if (event.type !== 'Update') {
      affected.add(storage.root);
      if (event.target) affected.add(event.target);
      if (event.origin) affected.add(event.origin);
    }
    for (const url of affected) invalidate(url);
  });
  let closed = false;
  let closing: Promise<void> | undefined;
  let reconciliation = Promise.resolve();
  const reconcileSerially = (since: Date) => {
    reconciliation = reconciliation.then(() => {
      if (!closed) return reconcile(since);
    });
    return reconciliation;
  };
  const reconcileAfterEvent = async (since: Date) => {
    try {
      await reconcileSerially(since);
    } catch (error) {
      await close();
      throw error;
    }
  };
  const stopResync = subscription.on('resync', since => {
    void reconcileAfterEvent(since).catch(reportError);
  });
  let sawLive = subscription.state === 'live';
  const stopState = subscription.on('state', state => {
    if (state === 'live' && !sawLive) {
      sawLive = true;
      void reconcileAfterEvent(new Date(0)).catch(reportError);
    }
  });
  const close = () => {
    if (!closing) {
      closed = true;
      stopChanges();
      stopResync();
      stopState();
      closing = subscription.close().finally(() => reconciliation.catch(() => {}));
    }
    return closing;
  };
  try {
    // Seed immediately; polling resync and first live cover their setup gaps.
    await reconcileSerially(new Date(0));
  } catch (error) {
    await close();
    throw error;
  }
  return close;
}
```

Membership changes (`Create`, `Delete`, `Move`, `Add`, `Remove`) invalidate the object,
normalized `target`/`origin` containers and the watched root. The root covers missing
container hints; URL-keyed listings must refresh even when container ETags are absent.
`Update` invalidates its object. Each affected URL is invalidated once per event.

Own the returned async cleanup in the application lifecycle, including logout. `subscribe`
also accepts an abort signal. Alternatively iterate the subscription with `for await`; ending
an iterator detaches that iterator, so still close the subscription itself.
Cleanup fences queued reconciliation and waits for any running read to settle, even if closing
the subscription fails. Await it before clearing application state on logout.

`subscribe()` can return while push is still connecting. The first `live` transition does
not emit `resync`, so refresh again then to cover changes during setup. Polling emits a full
`resync(new Date(0))` after its first successful baseline to cover the polling setup gap.
Initial reconciliation is awaited and failures close the subscription before rejecting
`watchCollection`. Later
reconciliation failures also close it and call the application's non-throwing `reportError`
handler; use that handler to show an error or arrange a retry. Initial, first-live and resync
reconciliations share a serial queue so an older read cannot overwrite a newer snapshot.

`plan()` is an I/O-free advertised preference, while `subscription.channel` reports the actual
transport. Supported push adapters are Solid WebSocketChannel2023 / StreamingHTTP, LWS
WebSocket / SSE, and NSS `Updates-Via`. Webhook relay is still a stub: even with `relay`, an
advertised webhook plan currently polls. Missing push support also polls; `pollIntervalMs: 0`
disables that fallback and leaves the subscription degraded. Observe `state` for
`connecting`, `live`, `degraded` or terminal `closed`; polling is degraded by design.

`depth` is best effort, not a recursive crawler. LWS push retains server-recursive container
semantics. Solid container subscriptions and all polling observe direct membership; add
individual resources with `hot` to observe edits. Reconcile on `resync` after interruptions;
it supplies a timestamp, not a durable replay cursor. Polling establishes a quiet baseline
and missing ETags do not produce changes. See [LWS differences](../../skills/lws-vs-solid/SKILL.md).


T-040 implements the ADR-005 contracts, `createNotifications`, internal `createChangeNormalizer`,
subscription lifecycle/async iteration, `./channels/poll`, and `./testing` fakes. T-041 adds
`./channels/websocket2023` and `./channels/lws-websocket`: Solid subscribes per topic, LWS
batches all topics. T-042 adds `./channels/streaming-http`, `./channels/lws-sse` and
`./channels/legacy-ws`. `plan()` reports advertised preference; WebSocket/SSE/legacy run push,
while webhook relay still uses polling until T-043. The subscription's `channel` is the
actual transport. Keep that distinction explicit in the README.

Use only the storage-client public API (`features`, `head`, `listAll`, `isWithinStorage`,
`createPodClient`). WebSocket discovery uses a fresh isolated cache per attempt, shared only
within that attempt's resolve/probe calls. Do not reach into backends or add a resolver dependency.
All topics/hot resources must be scoped. Poll serially, establish a quiet baseline, and commit
container snapshots only after all listing pages succeed. Missing ETags are not changes.
Polling containers cover direct membership; LWS push retains recursive server semantics.
Hot resources observe individual edits. Offline pauses
and aborts work; online immediately reconciles. Forbidden closes; transient failures retry.
Close must release timers/listeners and settle pending iterators even when observers fail.
`SubscriptionController`, `runtime.ts` and `channels/push.ts` are internal shared seams; maintain
terminal closed state and idempotent cleanup. Do not run polling and push for the same topic.

WebSocket close/error/90-second inactivity reconnects every topic together, with fresh discovery
and POSTs. Full jitter uses a 1-second floor and a capped exponential ceiling of 60 seconds;
reset only once all sockets open. Emit `resync(sinceLastFrame)` after interruptions, using
the earliest per-socket timestamp and retaining it through partial reconnects. Offline
aborts and suspends; online immediately rediscovers. Any discovery/subscribe 403 closes with
`forbidden`. Detach listeners before closing sockets; ignore stale callbacks/responses and
delete late LWS subscriptions. `close()` awaits best-effort LWS DELETEs already in flight.
Validate all HTTP destinations and returned URLs before I/O: HTTPS/WSS, credential/fragment/
control-free, receive/delete hosts equal storage or subscription service (including port).
`allowInsecureLoopback` defaults false; HTTP/WS requires literal loopback at both ends.
Never print token-bearing channel URLs. Leave solid-offline's implementation intact for T-062.

StreamingHTTP uses one POST and fetch stream per Solid topic. Keep the UTF-8 decoder state
across chunks, parse complete LF/CRLF JSON lines, flush a final unterminated record and bound
records to 1,048,576 UTF-16 code units. Skip blank/malformed JSON; decoding errors, oversize,
EOF and read errors reconnect with fresh discovery and resync. Register reader cancellation
before emitting live; observer-driven close and stale reads cannot leak changes or retries.
LWS SSE batches topics into one SseSubscription and uses native EventSource reconnection:
retain the source on readyState=0 errors so Last-Event-ID survives, degrade until open, then
resync. Factories must implement native auto-retry and id-buffer semantics. On terminal
errors/close, rediscover and re-subscribe with SDK backoff. Close/offline detaches and closes
sources and DELETEs LWS subscriptions. Native EventSource owns recoverable retry timing.
NSS rediscovers Updates-Via, restricts socket hosts to storage, uses solid-0.1 and sends one
sub frame per deduplicated topic. Only exact pub frames for subscribed topics produce Update;
validate topic syntax before constructing frames. Never interpret protocol banners as changes.

Normalisation takes a canonical storage id separately from the URL scope predicate (LWS id
and root may differ). Do not fetch JSON-LD contexts. Scope-filter objects before dedupe and
scope-filter optional target/origin URLs. Never log raw frames or untrusted URL credentials.
Dedupe is per normalizer, by accepted id, expiring at exactly five seconds.

`./testing` provides fake timers, sockets and event sources without network or Node-only
imports. Advance fake timers asynchronously to await complete channel cycles. Keep transport
factories and clocks injectable; WebSockets consume socket/random hooks; LWS SSE consumes
event sources. FakeEventSource.reconnect() models native Last-Event-ID replay without
replacing the instance.

Before implementation, read SDK core ADR-001 D4 and `ADR-005-live-updates.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and
adversarial tests with every behavior change. Keep development tool versions aligned with
the root manifest. The pinned pnpm 10.4.1 with `ignore-scripts` requires local tool declarations
for filtered scripts. Validate with this package's lint, dependency-first build, typecheck and
test scripts, and the repository gate.
