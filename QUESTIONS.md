<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CHT-L3 conservative readings

1. **Marker ordering and ties** — `12-pure-libraries-4.md` / CHT-L3 specifies monotonic
   markers but no cursor format. Options: timestamp only, or timestamp plus message ID.
   Use the existing chat timeline contract: integer Unix milliseconds, `null` for never
   read, equality means read for every message at that timestamp. Merge only markers for
   the same room, taking the maximum; `null` cannot reset a marker. Persistence and
   cross-account isolation remain the caller's responsibility (00-sdk-assumptions §8 A-22).
2. **Which messages contribute to counts?** — 07-parity-backlog, Chat, specifies counts
   from last-read preferences; CHT-L3 excludes own messages explicitly from notifications
   only. Options: exclude own messages from both, or preserve the existing timeline counts.
   Preserve timeline semantics: all supplied messages newer than the marker count as
   unread. Mention count is the number of those messages whose explicit recipient IDs
   contain the viewer, at most once per message. Muting affects notifications only.
   Counts cover supplied messages; callers must supply the full list for room totals and
   remove tombstones in the typed data layer.
3. **Mention resolution and edit detection** — 07-parity-backlog, Chat, maps mentions to
   `as:tag` but does not define a pure input shape. Options: parse display text, infer edits
   from timestamps, or require resolved recipient IDs and an explicit create/edit event.
   Require exact recipient IDs and an explicit event kind. Never infer recipients from
   handles, names, or message content. Edits always suppress notifications, including edits
   that add a mention. Creates notify only when unread and not authored by the viewer;
   a mention bypasses conversation mute. The caller classifies events and handles delivery
   deduplication; this pure decision function does not keep delivery history.

These choices do not block implementation; they are recorded for integrator review.
