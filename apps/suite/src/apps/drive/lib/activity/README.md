<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Drive activity

Pure synchronous functions; no IO, SDK subscriptions, hooks or host-clock access.

- `foldActivity(events)` returns a map keyed by stable file identity, retaining deleted histories.
  Events are sorted chronologically, with stream order breaking ties. Every event has a unique
  `id`, stable `fileId`, `type`, current `url`, `kind`, actor URL and integer Unix milliseconds
  `at` (1970–9999). Moves also require `fromUrl` and the actual returned destination URL. Exact
  replays are ignored; conflicting event IDs and inconsistent histories throw `ActivityError`.
  Partial histories may start with any event. A file's kind cannot change, deletion is terminal,
  and a subsequent create at a reused address requires a new file ID. Folder moves need explicit
  events for each child; the library never guesses a child address from a prefix.
- `recentFiles(events, limit = 50)` returns at most 50 live resources, deduplicated by file ID,
  ordered by latest activity (all five event types count), then file ID in code-unit order.
- `setStarred(set, url, boolean)`, `toggleStarred(set, url)` and `moveStar(set, from, to)` return
  fresh sets. Absolute URLs on other pods are allowed. Stars persist until explicitly removed;
  moves re-point only an existing star, merging with an already starred destination.
- `groupActivityByDay(events, timeZone)` returns newest-first Gregorian `YYYY-MM-DD` groups and
  newest-first events within each day, retaining stream order for ties. It validates event shapes
  and replay IDs, without requiring a complete file history. UI labels such as Today belong to
  the consumer. The caller must provide its time zone; DST uses Intl calendar dates.

File URLs must be canonical absolute HTTP(S), without credentials or fragments. Actor URLs may
have fragments. URL normalization, date parsing, missing actors and guessed move identities are
deliberately unsupported. Invalid inputs throw typed errors without echoing supplied data.
Returned records are detached from caller input. The caller owns account scoping and persistence.
