---
name: y-solid
description: Use when maintaining @jeswr/y-solid, its StorageClient log, YSolidProvider, header ordering, compaction, notifications, or legacy layout compatibility.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Yjs update log persistence

Use only the public StorageClient API in production; backend subpaths are test seams.
Construction takes storage, not fetch. Keep SolidUpdateStore/SolidPersistence and scope
helper exports compatible by name. YSolidProvider supplies auto/log mode; explicit live
mode fails until the separate transport task lands.

Encode JYU1/JYS1 headers as 4 ASCII magic bytes, 8 unsigned big-endian timestamp bytes,
and 4 big-endian random bytes. Resource names are unique conditional-create hints only;
use returned URLs. Replay every snapshot first, then every update by header time/random
and URL tie-break. Preserve headerless v0.1 loading. Never filter updates by snapshot time
or choose only the newest snapshot. Re-list unread members after a 404/410 during loading;
exhausted rounds must reject before synced.

Validate untrusted Yjs payloads on scratch docs before applying generated diffs to the live
doc. Compaction refuses corrupt batches, encodes state only after ingestion, creates a fresh
snapshot within the resource read cap and requires created:true before deleting anything. Delete only folded records,
with their read strong ETags. Missing/weak validators retain originals; never HEAD for a
newer validator or delete with '*'. Prefer compact(merged, StoredUpdate[]) over the legacy
URL-array form so each compactor carries its own exact validators. Concurrent appends survive.

Keep streaming update byte caps, listing Entry-metadata budgets and canonical checked values.
StorageClient owns raw listing parsing/transport byte limits and redirect refusal. Solid
resources stay within the document container; LWS identifiers may be opaque, so preserve the
container spelling and verify resource membership with parentOf inside storage scope.

Debounce local writes for 300 ms; failed batches stay pending and flush rejects. Notifications
are invalidation hints: read Create objects only after scope and logical membership checks;
reconcile other changes, missing Create objects and resync through authoritative listings.
Subscribe before hydration, serialize reconciliation, and generation-fence late responses
across disconnect/destroy. Close subscriptions on teardown without destroying shared clients
or the caller's doc. Regression-test races and fast-check multi-client convergence on both
memory-backend protocols, including compactions and fresh readers.
