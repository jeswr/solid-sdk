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

`test/chat-client*.test.ts` exercises the facade against the demo pod, including LongChat,
UTC midnight, competing writers and preference conflicts. The client and model retain
100% per-file coverage. Hook, outbox and DOM behavior are covered by `chat-state`,
`chat-outbox` and `chat-components` tests; `e2e/chat/chat.spec.ts` supplies all six browser projects.
