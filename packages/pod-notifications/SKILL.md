---
name: pod-notifications
description: Work on @jeswr/pod-notifications, storage-scoped change normalisation, WebSocket lifecycle, subscription state and polling across Solid and LWS.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-notifications

T-040 implements the ADR-005 contracts, `createNotifications`, internal `createChangeNormalizer`,
subscription lifecycle/async iteration, `./channels/poll`, and `./testing` fakes. T-041 adds
`./channels/websocket2023` and `./channels/lws-websocket`: Solid subscribes per topic, LWS
batches all topics. T-042 adds `./channels/streaming-http`, `./channels/lws-sse` and
`./channels/legacy-ws`. `plan()` reports advertised preference; WebSocket/SSE/legacy run push,
and T-043 adds `./channels/webhook-relay` for registered LWS webhook delivery over relay SSE. The subscription's `channel` is the
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

T-043 registers the canonical storage id using `relay.getIdToken(signal)` and a separate
`relay.fetch` (default global fetch). Never send pod access tokens through the relay
transport. Relay base URLs are explicit origins; validate scheme/credentials/controls,
returned id/token, and the exact inbox path before subscribing. The relay stream URL is
constructed locally. Reuse native SSE retry/Last-Event-ID and terminal rediscovery behavior.
Webhook subscriptions batch all topics, select the WebhookSubscription service even when
another push service is preferred, retain DELETE cleanup, and report `webhook-relay` as via.
A relay registration 403 closes forbidden. The optional ID-token callback preserves existing
`plan()` configuration, but an actual webhook subscription requires it.
