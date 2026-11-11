<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Reminders persist a UUID literal as `dct:identifier` on the `sched:Reminder` node.
Claims use this identifier and the trigger time. Text saves, archive/unarchive and
trigger edits preserve the identifier; removing and setting a reminder creates a
new one. Trash removes the reminder.

Legacy reminders without an identifier initially use the note URL and trigger time.
Before a text save or move first assigns a UUID, the store copies any existing
claim to the UUID key. It retains the URL claim for pages still showing the old
snapshot. A failed durable migration prevents the save and can be retried.
Creation metadata is never an identity.

IndexedDB keeps one record per reminder key, either pending (owner and a
30-second expiry) or delivered. Only the claim owner can complete or release a
pending record. Cancelled delivery releases the record; abandoned claims expire.
Rejected tabs discard their local reservation and recheck on subsequent ticks.
Migrated pending records settle together under their original owner.

Retention removes delivered records older than thirty days and bounds each
account's history to 2,000 entries. An older caller does not discard a newer
timestamp as being in the future. When IndexedDB is unavailable, page memory
keeps the same state transitions and survives scheduler remounts.
