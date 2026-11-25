<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Calendar compound recovery

`applySeriesPlan` sends replacement creation and the conditional master update or deletion
through `createEventOutbox().compound`. Before the first pod write, `SeriesJournal` stores
the full plan, operation scope, account, pod, master ETag and replacement URL. Checkpoints
retain the replacement ETag, an attempted master write, rollback and completion. Ordinary
occurrence/following deletions only change the master and remain single outbox writes.

Calendar and Contacts use `DurableJournal` from `@jeswr/solid-offline/journal`: one localStorage key per operation,
account and normalized collection/pod URL, Web Locks across tabs, and shared memory fallback
across provider remounts. Records contain event data and ETags, never authentication material.
Storage failures warn that recovery cannot survive a reload. Corrupt records remain stored
and show a warning without causing pod writes.

On mount, reconnection, pod notification and journal storage events, pending recovery runs
before the ordinary outbox drains. Replay adopts an existing identical replacement after an
unacknowledged create, then updates/deletes the master with its original `If-Match`. A changed
master instead rolls back the replacement using its recorded ETag. When the create response
was lost, only identical full RDF with a strong current ETag can be adopted for rollback.
A changed or unguarded replacement is kept with a duplicate-occurrence warning. A lost master
response is recognized by identical intended RDF or a missing deletion target. Offline or
unreadable operations stay journaled; repeated replay is serialized and idempotent.

Compound steps never enter the ordinary outbox. Pending recovery prevents overlapping edits,
and unfinished recovery retains queued writes for a later retry. After flushing recovery,
a foreground save checks the master ETag again before creating a replacement, so retrying
a stale editor cannot repeat the recovered edit. Successful recovery and
compensation show a non-blocking toast; conflicts and unfinished recovery show warning toasts.

Legacy WebID-only envelopes (`suite:calendar:intents:<webId>`) are migrated before replay.
The account-wide handoff is locked across pod namespaces. Valid records retain their full
writes and checkpoints under stable imported IDs; retries preserve newer checkpoints. The
old envelope is retired only after durable copies succeed. Invalid records are discarded,
mixed-pod writes are rejected, and valid records wholly belonging to other pods remain in
the legacy envelope for those pods. Legacy UI scope was not recorded, so migration infers
this/following from replacement recurrence without changing the saved write plan.

Fallback snapshots learn persistent deletions, including those observed after a quota failure,
without replacing dirty checkpoints with old storage values. An ordinary save queued during
a compound edit waits for a new recovery-ordered drain after the compound settles.
