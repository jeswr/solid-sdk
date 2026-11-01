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

## Runner and app wiring

`runner.ts` (framework-free) maps the cache snapshot to `ReminderTask`s: only visible views
(hidden pending-delete and removed tasks are already absent), open, dated, with reminders;
all-day markers are kept and unreadable reminder data is reported. Each task also carries an
`identity` (creation time + title). Moves between projects keep both, but not the URL or the
anonymous trigger ids. The collector claims an identity key after the URL key, so a reminder
that fired before a move does not fire again. Tasks without `dct:created` have no identity.

`runReminderTick` claims, then hands each event (`tag` = task URL + fire time, `body` = due
text) to a notifier, and returns `{ delivered, errors, undelivered }` without throwing.
Claimed events whose delivery failed, or that the scheduler stopped before delivering, are
retried by the next tick while the task is still due and within the 24-hour window.
`startReminderScheduler` ticks once every project load has settled, every 5 minutes and on
`visibilitychange` to visible. Ticks run serially. `canDeliver` false skips a tick before it
claims. `fallbackFiredStore` keeps reminders firing, deduplicated per tab only, when IndexedDB
claims fail, and reports the first failure only.

`state/reminders.ts` mounts it from the Tasks chrome with `useReminderScheduler`. It shares
one fired store per tab (IndexedDB when available, else memory), so a strict-mode remount
cannot deliver twice. A hidden tab claims only when notification permission is `granted`;
otherwise a visible tab, or the visibility tick, picks the reminder up. Delivery shows a system
notification only when permission is already `granted`: through the controlling service
worker's registration when one exists (the worker handles the click via `data.taskUrl`), else
via `new Notification`, whose click opens `?task=<ref>`. It always shows a "Reminder: <title>"
toast that persists until dismissed and has an "Open" action. The app never prompts on load:
saving a reminder (detail pane or composer) offers "Allow notifications" once per session.
The offer appears only while permission is `default` and a service worker or the
constructor can notify. Dev fixture builds (`NEXT_PUBLIC_DEV_FIXTURES=1`) expose
`window.tasksReminderTestHook.{setNow, tick}` for Playwright. `tick` resolves to the delivered
count, or -1 when it skipped (tasks still loading, or a hidden tab without permission).
