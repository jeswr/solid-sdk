<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Reminders persist a UUID literal as `dct:identifier` on the `sched:Reminder` node.
Claims use this identifier and the trigger time. Text saves, archive/unarchive and
trigger edits preserve the identifier; removing and setting a reminder creates a
new one. Trash removes the reminder.

The pod is the source of identity. For an external reminder without an identifier,
the scheduler first saves one with If-Match; on 412 it re-reads the winning note.
Other failures fall back to the URL and trigger time for best-effort delivery.
If identification later succeeds for that same trigger, the scheduler copies any
known URL-keyed delivery to the identifier key after the pod write succeeds.
An ordinary save or move that identifies an overdue reminder records it as delivered
locally, without waiting for storage. IndexedDB failures never block pod writes.

IndexedDB keeps one record per reminder key, either pending (owner and a
30-second expiry) or delivered. Only the claim owner can complete or release a
pending record. Ownership and expiry are checked immediately before notification.
Cancelled delivery releases the record; abandoned claims expire.
Rejected tabs discard their local reservation and recheck on subsequent ticks.
Claims granted by the memory fallback validate ownership in memory even if
IndexedDB can still read history but cannot add a claim.

Retention removes delivered records older than thirty days and bounds each
account's history to 2,000 entries. An older caller does not discard a newer
timestamp as being in the future. When IndexedDB is unavailable, page memory
keeps the same state transitions and survives scheduler remounts.
