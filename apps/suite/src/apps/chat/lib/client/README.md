<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Chat client

`new ChatClient(fetch, storageUrl, webId, publicFetch = globalThis.fetch, displayName?)` is the framework-free application facade.
All RDF operations delegate to `../model`. Room and day transport stays inside
the storage origin and path and refuses redirects. LDN discovery/delivery uses the session fetch
through pod-access’s public-HTTPS, redirect-refusing guard;
preference transport is isolated in `preferences-store.ts` until the SDK preference API lands.

- Joined room failures remain navigable error rows. Day pages retain tombstone placeholders
  and expose the backwards UTC cursor. Authorship checks use the client's previously loaded
  messages; unknown subjects fail closed before any edit/delete request.
- Appends use stable IDs and retry exactly one 412 after reading the winning document.
  The Chat outbox uses `@jeswr/solid-offline`'s WebID-scoped IndexedDB queue in Chat's own
  `chat` namespace (its own database, BroadcastChannel and Web Locks replay), so Chat never
  replays the shell's queued writes and the shell's sync sheet never lists chat intents. Its
  guard policy covers only day documents under the pod's `chat/` container. Composer drafts
  remain in guarded localStorage envelopes keyed by WebID and room. Restored entries retain
  their stable IDs and timestamps; any active Chat tab flushes waiting sends after hydration on
  mount, on `online`, and whenever the queue changes with entries waiting or left mid-send by a
  closed tab. Offline failures stay "Sending…" until reconnection; any failure while online
  (including 5xx, 429, fetch errors and pod discovery) fails the row, which waits for Retry or
  Discard. The pod client is created once per connection. Without a working IndexedDB (no
  factory, a failed open, or a failed enqueue) rows are kept in memory and sent directly, with
  the same Retry and Discard. Legacy localStorage queues are imported once (including failed
  status); a rejected entry is skipped, and every processed per-room key, including empty,
  invalid or non-array ones, is removed. Successful and timeline-acknowledged entries are pruned
  from IndexedDB.
  A resend reporting `ChatModelError("duplicate")` confirms delivery. Web Locks serialize
  replay across tabs; without them the SDK serializes within a realm, and the model's duplicate
  check and conditional day writes protect stable message identities during competing replays.
  Discard removes the queued intent across tabs. A request already in flight in another tab
  may still post the message; discard does not retract a message from the room.
- Messages expose `reactions` aggregated by distinct actor and emoji, with `reactedByMe`
  for the current WebID. `react(room, messageId, emoji)` reads the current day and toggles
  one Like on, or appends Undos for all matching active Likes by that WebID (re-reading the
  document when a PATCH response carries no strong ETag). Other
  participants' Likes remain intact; deleted messages are refused. Timeline chips and
  the keyboard-accessible eight-emoji picker invalidate messages after successful writes.
- DMs have an empty name, exactly two members and a deterministic SHA-256 slug. Existing
  joined DMs reopen. Colliding DM creators load and verify the winner's exact membership,
  with bounded retries while its index is being written; they never suffix a DM.
  Named rooms fold to ASCII slugs with collision suffixes.
- Newly created rooms and DMs send a pod-access AS2 `Offer` to each distinct member except
  the creator, after ACL, index and owner join succeed. The object is the room **container URL**,
  matching `Room.url`, `inviteLink` and `join`; incoming `index.ttl#it` subjects normalize to that
  container. `createRoom({ name, members, signal? })` and `createDirect(webId, { signal? })`
  return `Room & { invitations: { webId, delivered, reason? }[] }`. Delivery uses the session
  fetch, at most four active recipients, and no retries. Failures (including cancellation after
  creation) are values. Once writes start, cancellation cannot interrupt ACL/index/join;
  leaving the form lets delivery finish and failures still reach the global toast, while
  late navigation is fenced. Copy-link fallback is offered only for recipients within this
  pod's credential boundary. Reopened and competing DMs never re-invite; a resumed,
  interrupted DM invites its peer after its index and owner join complete.
- `invitations({ signal? })` reads the current WebID's LDN inbox through pod-access and the
  session fetch. It reads at most 100 inbox children, keeps Offers with HTTP(S) room containers
  or canonical index subjects, omits joined rooms, and returns at most 50 distinct rooms,
  newest first. With the pod-access reader, a missing inbox and any profile discovery failure
  are empty; inbox listing 5xx/network errors propagate. Concurrent callers (the sidebar and
  drawer copies) share one in-flight scan; each keeps its own cancellation, and the scan is
  aborted only when every caller has left. Scans run one at a time.
  Own-pod rooms are checked during the scan through `room()` (pod scope retained, at most four
  at once), with results cached per room while the inbox still offers it, so neither copy nor a
  focus refresh re-reads an index. Own-pod claims are kept per room and sender before
  de-duplication: a room is listed with the newest claimed sender who is a loaded member, and
  dropped when no claimed sender is. An own-pod room whose index fails with a 4xx (other than
  401, 408 and 429) or holds no room is dropped too, because the owner creates their own rooms
  and is never invited to them. Unreachable and 5xx rooms stay listed under the fallback
  “Room invitation (<slug>)” name with the newest claim. The sidebar routes to the existing Join
  flow; Join requires loaded room membership, and a non-member is told why.
  Actors remain sender claims: labels say “Invitation claims to be from <host>”, with no
  profile requests.
  One normaliser (`apps/suite/src/lib/chat-invitation-room.ts`, wrapped by the model's
  `invitationRoom`) accepts only HTTP(S) `chat/rooms/<slug>/` containers or their canonical
  `index.ttl#it` subjects, with no query. Own-pod paths must be directly under the storage's
  `chat/rooms/`. The shell tray uses the same module without loading Chat's model. The room
  route keeps its earlier pod-scoped container check, so existing rooms elsewhere still open.
  Foreign-pod invitations have no link or metadata fetch; they explain cross-pod support is
  pending, and Dismiss names them by host and room slug. Own-pod and foreign lists each
  collapse behind a count above three; above three shown invitations, “Dismiss all N
  invitations” dismisses every shown row. The heading leaves with the last row once focus moves
  off it.
  Dismissals use the shared account ID set with Chat's key prefix and an identity-checked
  envelope, retaining at most 200 container URLs in guarded localStorage keyed by WebID; inbox
  resources are never deleted. Sidebar and drawer copies synchronize local dismissals.
  A single reader per client retains profile/inbox discovery. Mount, explicit retry/join and
  focus refreshes (30-second throttle)
  expose failures as a small inline retry. A creation's delivery-failure toast is dropped when
  the shell account or session changed while it ran. The demo inbox e2e seeds an Offer at
  fixture level; two-user delivery belongs to sst-rn91.
- `chat.lastRead` lives in `settings/chat-preferences.json`, with schema validation,
  conditional writes and one conflict merge using monotonic markers. Unread counts cover
  the newest seven-day page, excluding own messages, deletions and edit revisions. Rooms
  are counted concurrently under the shared read limiter, behind the open room's timeline.
  Read markers advance only to confirmed messages rendered in the timeline.
- Own messages become tasks using the existing same-subject overlay and `wf:dateDue`.
  Somebody else's message becomes a linked personal task under `tasks/`, since room members
  with Read/Append cannot rewrite the original day. Edit/Delete and the composer edit shortcut
  are available for own messages to members with a validated v2 container, and only
  to the room creator in v1. V2 owners have an explicit “Remove message” action
  (`moderate`) for other members’ messages. Joining records a room locally and
  never grants remote posting rights.
- Profiles are parsed by the model and cached per client. Profiles outside the storage path
  use the separately injected public transport with credentials omitted and redirects refused.
  Message URLs are linkified;
  preview metadata, images and arbitrary link destinations are never fetched.
- `search(source, { days = 30, maxRooms = 50, timeZone, signal? })` searches only joined rooms,
  in their listed order, with four room reads at a time, including metadata discovery. Search
  refreshes joined membership and reuses resolved room metadata when available. Positive integer budgets default to
  30 UTC day shards and 50 rooms; callers can choose smaller or larger budgets, with days
  capped at the model's 366-shard maximum. At most 200 ranked results are returned. `truncated`
  reports omitted rooms, older day pages or results; `truncationReasons` identifies `rooms`,
  `days` and/or `results`, and `searchedDays` gives the actual day budget. Valid creation dates
  stop history reads at the room's first day. `records` identifies the engine's 100,000-record
  snapshot bound separately from the 200-result limit.
  Cancellation reaches discovery and day fetches.
  `searchedRooms` counts successful room
  loads; unavailable indexes/day pages appear in `skipped` without discarding other rooms.
  `in:` accepts an exact room URL or an exact, case-insensitive joined room name (quote
  names with spaces, e.g. `in:"Book club"`). A direct message also matches the other member's
  already-resolved display name. Results and skipped rooms carry `isDirect` and `members`, so the UI
  names a direct message after the other person. Duplicate names resolve to the first listed room;
  negated room filters follow the same rule. Positive `in:` filters load only those rooms,
  including rooms beyond `maxRooms`. Rewritten queries are validated before message reads.
  Filters never discover or join other rooms. Author names use resolved cached profiles,
  falling back to WebIDs; search never waits for pending profiles or fetches new ones. The
  session's display name seeds the current user's name.
  Malformed text/names are repaired to well-formed Unicode and names are bounded to the
  engine's field limit. Records with oversized text/identifiers, invalid timestamps, or IDs
  outside the loading room's HTTP(S) container are counted in `droppedRecords` and excluded.
  Duplicate IDs prefer the most specific owning container, then listed order; failures retain
  listed order regardless of request completion.
  Foreign notes without authors/timestamps use “Unknown author”/the Unix epoch. Deleted
  notes and tombstones are excluded. Attachments and reply relations are not yet represented
  by this client, so `has:attachment` and `is:thread` do not match; text link/mention filters
  use the pure engine. Query and zone failures propagate as its typed `SearchError`.

`test/chat-client*.test.ts` exercises the facade against the demo pod, including LongChat,
UTC midnight, competing writers and preference conflicts. The client and model retain
100% per-file coverage. Hook, outbox and DOM behavior are covered by `chat-state`,
`chat-outbox` and `chat-components` tests; `e2e/chat/chat.spec.ts` supplies all six browser projects.
