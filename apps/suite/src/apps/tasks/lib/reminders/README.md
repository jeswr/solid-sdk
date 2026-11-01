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
all-day markers are kept and unreadable reminder data is reported. `runReminderTick` claims,
then hands each event (`tag` = task URL + fire time, `body` = due text) to a notifier, and
returns `{ delivered, errors }` without throwing. `startReminderScheduler` ticks once every
project load has settled, every 5 minutes and on `visibilitychange` to visible; ticks run
serially. `fallbackFiredStore` keeps reminders firing, deduplicated per tab only, when
IndexedDB claims fail.

`state/reminders.ts` mounts it from the Tasks chrome with `useReminderScheduler`, sharing one
fired store per tab (IndexedDB when available, else memory) so strict-mode remounts cannot
deliver twice. Delivery shows a Web Notification only when permission is already `granted`
and always a "Reminder: <title>" toast; both open `?task=<ref>`. The app never prompts on
load: saving a reminder (detail pane or composer) offers "Allow notifications" once per
session while permission is `default`. Dev fixture builds (`NEXT_PUBLIC_DEV_FIXTURES=1`)
expose `window.tasksReminderTestHook.{setNow, tick}` for Playwright; `tick` resolves the
delivered count, or -1 while tasks are still loading.
