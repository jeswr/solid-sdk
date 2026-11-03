<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Chat client

`new ChatClient(fetch, storageUrl, webId, publicFetch = globalThis.fetch)` is the framework-free application facade.
All RDF operations delegate to `../model`. The authenticated transport permanently stays inside
the storage origin and path; room and day fetches refuse redirects;
preference transport is isolated in `preferences-store.ts` until the SDK preference API lands.

- Joined room failures remain navigable error rows. Day pages retain tombstone placeholders
  and expose the backwards UTC cursor. Authorship checks use the client's previously loaded
  messages; unknown subjects fail closed before any edit/delete request.
- Appends use stable IDs and retry exactly one 412 after reading the winning document.
  The React outbox serializes sends per room and retains failed drafts for Retry/Discard.
  Pending sends and composer drafts persist in guarded localStorage envelopes keyed by WebID and
  room. Remounting restores their stable IDs and timestamps; sends flush on mount and `online`.
- Messages expose `reactions` aggregated by distinct actor and emoji, with `reactedByMe`
  for the current WebID. `react(room, messageId, emoji)` reads the current day and toggles
  one Like on, or appends Undos for all matching active Likes by that WebID. Other
  participants' Likes remain intact; deleted messages are refused. Timeline chips and
  the keyboard-accessible eight-emoji picker invalidate messages after successful writes.
- DMs have an empty name, exactly two members and a deterministic SHA-256 slug. Existing
  joined DMs reopen. Colliding DM creators load and verify the winner's exact membership,
  with bounded retries while its index is being written; they never suffix a DM.
  Named rooms fold to ASCII slugs with collision suffixes.
- `chat.lastRead` lives in `settings/chat-preferences.json`, with schema validation,
  conditional writes and one conflict merge using monotonic markers. Unread counts cover
  the newest seven-day page, excluding own messages, deletions and edit revisions.
  Read markers advance only to confirmed messages rendered in the timeline.
- Own messages become tasks using the existing same-subject overlay and `wf:dateDue`.
  Somebody else's message becomes a linked personal task under `tasks/`, since room members
  with Read/Append cannot rewrite the original day. Edit/Delete and the composer edit shortcut
  are available only to the room creator for this cut. Joining records a room locally and
  never grants remote posting rights.
- Profiles are parsed by the model and cached per client. Profiles outside the storage path
  use the separately injected public transport with credentials omitted and redirects refused.
  Message URLs are linkified;
  preview metadata, images and arbitrary link destinations are never fetched.
- `search(source, { days = 30, maxRooms = 50, timeZone })` searches only joined rooms,
  in their listed order, with four room reads at a time. Positive integer budgets default to
  30 UTC day shards and 50 rooms; callers can choose smaller or larger budgets, with days
  capped at the model's 366-shard maximum. At most 200 ranked results are returned. `truncated`
  reports omitted rooms, older day pages or results. `searchedRooms` counts successful room
  loads; unavailable indexes/day pages appear in `skipped` without discarding other rooms.
  `in:` accepts an exact room URL or an exact, case-insensitive joined room name (quote
  names with spaces, e.g. `in:"Book club"`). Duplicate names resolve to the first listed room;
  negated room filters follow the same rule. Filters never discover or join other rooms.
  Author names use already cached profiles, falling back to WebIDs; search fetches no profiles.
  Foreign notes without authors/timestamps use “Unknown author”/the Unix epoch. Deleted
  notes and tombstones are excluded. Attachments and reply relations are not yet represented
  by this client, so `has:attachment` and `is:thread` do not match; text link/mention filters
  use the pure engine. Query and zone failures propagate as its typed `SearchError`.

`test/chat-client*.test.ts` exercises the facade against the demo pod, including LongChat,
UTC midnight, competing writers and preference conflicts. The client and model retain
100% per-file coverage. Hook, outbox and DOM behavior are covered by `chat-state`,
`chat-outbox` and `chat-components` tests; `e2e/chat/chat.spec.ts` supplies all six browser projects.
