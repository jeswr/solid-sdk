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
