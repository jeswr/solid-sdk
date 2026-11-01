<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Chat client

`new ChatClient(fetch, storageUrl, webId)` is the framework-free application facade.
All RDF operations delegate to `../model`. Room and day fetches refuse redirects;
preference transport is isolated in `preferences-store.ts` until the SDK preference API lands.

- Joined room failures remain navigable error rows. Day pages retain tombstone placeholders
  and expose the backwards UTC cursor. Authorship checks use the client's previously loaded
  messages; unknown subjects fail closed before any edit/delete request.
- Appends use stable IDs and retry exactly one 412 after reading the winning document.
  The React outbox serializes sends per room and retains failed drafts for Retry/Discard.
  Offline drafts are kept for the current Chat session and flushed on the `online` event.
- DMs have an empty name, exactly two members and a deterministic SHA-256 slug. Existing
  joined DMs reopen. Named rooms fold to ASCII slugs with collision suffixes.
- `chat.lastRead` lives in `settings/chat-preferences.json`, with schema validation,
  conditional writes and one conflict merge using monotonic markers. Unread counts cover
  the newest seven-day page, including own messages, excluding deletions and edit revisions.
- Own messages become tasks using the existing same-subject overlay and `wf:dateDue`.
  Somebody else's message becomes a linked personal task under `tasks/`, since room members
  with Read/Append cannot rewrite the original day. Joining records a room locally and
  never grants remote posting rights.
- Profiles are parsed by the model and cached per client. Message URLs are linkified;
  preview metadata, images and arbitrary link destinations are never fetched.

`test/chat-client*.test.ts` exercises the facade against the demo pod, including LongChat,
UTC midnight, competing writers and preference conflicts. The client and model retain
100% per-file coverage. Hook, outbox and DOM behavior are covered by `chat-state`,
`chat-outbox` and `chat-components` tests; `e2e/chat/chat.spec.ts` supplies all six browser projects.
