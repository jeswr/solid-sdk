<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Local reminder collection

`collectDueReminders(tasks, now, store, windowMs?)` returns `{ due, errors }`. Deliver every
event in `due`, even when `errors` contains failed items. Failed claims and invalid reminders
are isolated per reminder; unclaimed triggers can retry on the next tick. Invalid clocks or
windows reject the call. The default scan covers `(now - 24 hours, now]` on every tick,
including after reload. A custom window can narrow the scan, and is capped at 24 hours.

`FiredReminderStore.claim(key): Promise<boolean>` atomically records a fire key and returns
true only for the first caller. The IndexedDB implementation reads and writes in one
readwrite transaction, resolving after commit, so independent tabs/connections deduplicate.
The memory implementation uses a Set scoped to its instance. Keys use the model's trigger
identity and fire time, allowing the next recurrence to fire. IndexedDB claims expire after
30 days.
