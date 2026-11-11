<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Reminders persist a UUID literal as `dct:identifier` on the `sched:Reminder` node.
Claims use this identifier and the trigger time. Text saves, archive/unarchive and
trigger edits preserve the identifier; removing and setting a reminder creates a
new one. Trash removes the reminder.

Legacy reminders without an identifier use the note URL and trigger time, so a
move can cause a repeat notification. Rewriting a legacy reminder persists an
identifier for subsequent saves and moves. Creation metadata is never an identity.

IndexedDB claims are atomic per account across tabs. Retention removes claims
older than thirty days and bounds history to 2,000 entries; an older caller does
not discard a newer timestamp as being in the future. A delivery owner that
unmounts while its claim is pending releases the undelivered claim from durable
storage and page memory, allowing a later mount to deliver it.
