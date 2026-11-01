---
name: y-solid
description: Use when maintaining @jeswr/y-solid, its StorageClient log, YSolidProvider, header ordering, compaction, notifications, or legacy layout compatibility.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Yjs update log persistence

Use only the public StorageClient API in production; backend subpaths are test seams.
Construction takes storage, not fetch. Keep SolidUpdateStore/SolidPersistence and scope
helper exports compatible by name. YSolidProvider selects live only for available
features.realtimeCollab advertising the y-protocol-v1 profile; explicit log bypasses it.
Explicit live requires that profile, and live selection requires an injected pod-auth fetch.
Use the public description's matching CrdtSyncService for raw or expanded-IRI roomTemplate.
Expand the canonical store.container as encodeURIComponent, POST {room} for a fresh ticket on
every connection, refuse redirects, bound ticket reads/timeouts, validate future expiry and
room URL binding, require WSS for HTTPS, and keep ticket-bearing errors out of events.

Exchange y-websocket sync (0), awareness (1), auth (2), and awareness-query (3) frames.
Validate incoming updates on scratch docs before applying clean diffs, with the transport as
origin to suppress echoes. The relay owns pod persistence while live; disable SDK compaction
and send local updates over the socket. On loss checkpoint the whole document because the
wire protocol has no per-update durability acknowledgement, then use normal log writes.
Reconcile fallback log state and resync through Yjs step 1/2 on fresh-ticket reconnects;
failed fallback appends must not block live recovery or discard pending updates.
Fence ticket/frame/handshake responses across disconnect/destroy, cancel pending ticket bodies,
release listeners and retries, remove remote awareness on loss, and reannounce local awareness
on reconnect. Own only awareness created by the provider; supplied awareness must use the same
doc and survive provider destruction. Keep log-only awareness lazy to avoid idle timers.
Test with the in-process protocol-compatible relay, including its authoritative log persistence,
two-provider convergence under 500 ms, awareness, lost in-flight edits and fresh log readers.

Encode JYU1/JYS1 headers as 4 ASCII magic bytes, 8 unsigned big-endian timestamp bytes,
and 4 big-endian random bytes. Resource names are unique conditional-create hints only;
use returned URLs. Replay every snapshot first, then every update by header time/random
and URL tie-break. Preserve headerless v0.1 loading. Never filter updates by snapshot time
or choose only the newest snapshot. Re-list unread members after a 404/410 during loading;
exhausted rounds must reject before synced.
Only a 404/410 on the initial container request can mean an empty log. Propagate
continuation-page failures even when all preceding pages were empty.

Validate untrusted Yjs payloads on scratch docs before applying generated diffs to the live
doc. Compaction refuses corrupt batches, encodes state only after ingestion, creates a fresh
snapshot within the resource read cap and requires created:true before deleting anything. Delete only folded records,
with their read strong ETags. Missing/weak validators retain originals; never HEAD for a
newer validator or delete with '*'. Prefer compact(merged, StoredUpdate[]) over the legacy
URL-array form so each compactor carries its own exact validators. Concurrent appends survive.

Keep streaming update byte caps, listing Entry-metadata budgets and canonical checked values.
Pass `maxListingBytes` as `maxBytes` to StorageClient's `listAll`: each raw HTTP page must be
stream-capped before RDF/JSON parsing, including memberless listings. Retain the aggregate
Entry-metadata budget and propagate overflow or continuation failures before returning URLs.
StorageClient owns raw listing parsing, cap enforcement and redirect refusal. Solid
resources stay within the document container; LWS identifiers may be opaque, so preserve the
container spelling and verify resource membership with parentOf inside storage scope.

Debounce local writes for 300 ms; failed batches stay pending and flush rejects. Notifications
are invalidation hints: read Create objects only after scope and logical membership checks;
reconcile other changes, missing Create objects and resync through authoritative listings.
Subscribe before hydration, serialize reconciliation, and generation-fence late responses
across disconnect/destroy. Close subscriptions on teardown without destroying shared clients
or the caller's doc. Regression-test races and fast-check multi-client convergence on both
memory-backend protocols, including compactions and fresh readers.
