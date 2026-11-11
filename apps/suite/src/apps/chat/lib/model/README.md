<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Chat model (CHT-00)

Pure RDF model and injected-fetch I/O for CHT-01. Ported from pod-chat's typed
room/message model and Pod Manager's append discipline, using solid-chat-interop
for AS2 and LongChat messages. No hooks, React, shell or suite-sdk imports.

- `buildRoom` / `readRoom`: `index.ttl#it`, canonical `pc:ChatRoom` +
  `as:Collection`, `vcard:hasMember`; reads legacy `pc:participant` and
  `as:attributedTo` membership too. `joinRoom` / `saveJoinedRoom` only update
  the caller's `chat/rooms.ttl#it` collection; they confer no remote access.
- `dayUrl`, `dayPage`: UTC `yyyy/mm/dd.ttl`, inclusive backwards date cursor,
  explicit lower bound and bounded number of days. Missing days are empty;
  errors other than 404 propagate. Each returned document keeps its validator.
- `appendMessage`: caller supplies a stable ID, timestamp and author. Returns
  a copy, rejects duplicate subjects. `sendMessage` creates missing year/month
  containers, creates a missing day with If-None-Match, or PATCHes only the new
  subject with INSERT DATA and a strong If-Match. No unconditional writes,
  overwrite fallback or automatic conflict retry. A 412 must be re-read by hooks.
- `editMessage`, `tombstoneMessage`, `turnIntoTask`: copy-on-write operations
  retaining other subjects and metadata. Edits update AS2 and LongChat body
  aliases; tombstones erase bodies and task overlay, preserving author/time/id.
  Task overlays use the SAME message subject and existing wf:Task vocabulary.
  The corresponding I/O functions re-read the original day and conditionally PUT.
- `appendReaction` / `appendUndo`: return only a new `as:Like` / `as:Undo`
  subject in the target message's day, retaining the sanitised emoji in `as:content`.
  Reactions are emoji only (`isReactionEmoji`: at most 32 UTF-16 units). `appendUndo`
  returns `null` when the same author already undid the Like, so a race with
  another tab is not an error. `readReactions(dataset, document)` ignores
  malformed, non-emoji and cross-document events, and events stored in any
  document other than `document`, and subtracts only Undos from the Like's author.
  `#reaction-`/`#undo-` subjects, and Like/Undo subjects not also typed as a
  message, never appear in `readMessages`; adding `a as:Like` to a message does
  not hide it.
  In v1 rooms, authorship is what the writer claims in `as:attributedTo`: a member with Append
  can write Likes or Undos in another member's name, as with message authorship.
  The author check holds between honest clients only; the timeline caps chips at
  `MAX_REACTION_CHIPS` per message.
  In v1, `react` / `unreact` use only PATCH INSERT DATA with the day's strong If-Match,
  re-reading and retrying one 412. Missing or deleted messages cannot be reacted to.
- `createRoom`: creates parents, then a new room, its advertised WAC
  root ACL, `members/`, each member container and its advertised ACL, then the
  index last (the ready marker). Owner gets Read/Write/Control throughout; v2 members
  get Read at the root and Read/Write in their own container, with defaults. No public
  grants. It does not auto-join the owner or send
  invitations. Failed multi-resource creation may leave an empty/partial room;
  errors propagate, and a retry never overwrites that room or an existing ACL.
  WAC ACL URLs are discovered from Link; unsupported/missing ACL links fail closed.
- `readMessages` delegates to the interop hub, accepting arbitrary named message
  subjects, sorting by publication and ID, and including tombstones for reconciliation.
  Named graphs cannot override fields in the default graph. LongChat's native
  `sioc:content`, `foaf:maker`, `dct:created` and task overlays are supported.
- `parseChat` / `serializeChat`: sanctioned parser/shared Writer; remote JSON-LD
  contexts refused, unsafe serialization IRIs and named graphs rejected.
- `readPreferencesSchema`, `markRoomRead`: preference payload and monotonic read
  markers under `chat.lastRead`; existing pure `countUnread` is re-exported.
  Hooks supply live snapshots (exclude tombstones/revisions), with resolved sender,
  timestamp and mention IDs. Preference transport remains SDK/hook work.

Callers explicitly select the room/storage and inject the authenticated fetch.
All requests refuse redirects and stay in that scope. The server remains the permission authority.

## Room layout v2 (sst-l5s6, sst-tgk5)

New rooms and direct messages use `<room>/members/<key>/yyyy/mm/dd.ttl`, where
`key` is the first 32 lowercase hex characters of SHA-256 of the exact WebID,
computed with Web Crypto. UTC dates and message fragments retain the v1 rules.
`buildRoomV2` adds the layout; asynchronous `readRoomLayout` validates hash paths
and owners. The synchronous `buildRoom`/`readRoom` retain the v1 metadata API.
An index with `sioc:space_of` is v2 even if all listed containers are rejected;
it never falls back to reading or writing shared root days.

| Term | Mapping |
| --- | --- |
| `sioc:Container` | A member's write container |
| `sioc:has_owner` | That member's WebID (must be a `vcard:hasMember` or the room creator) |
| `sioc:has_space` | The room's `index.ttl#it` |
| `sioc:space_of` | Room-to-member-container discovery |

SIOC already describes LongChat content and supplies the container/space relation;
no vocabulary terms are minted. Only the exact computed URL with one owner and
the declared room space is accepted. Readers check every author claim, including
LongChat `foaf:maker`, and bind subjects to the fetched document. An authorless
message inherits its container owner; malformed or mismatched claims are dropped.
The page's `dropped` counter reports rejected messages and events for debugging,
without UI. Fetches fan out across member days with at most six concurrent reads;
404 is empty, other failures propagate. Merge order remains publication time then ID.
Search, unread counts and history use those same pages. Files are discovered inside
validated member containers and their date containers, with six concurrent walks.

Send, own edit/delete and task overlays write only the actor's member day. Likes
and Undos live in the reactor's container on the target message's day (not the
reaction's wall-clock day). A Like may point to another member's message in that
same room/day. `readReactions` takes validated containers and known message subjects
for v2: the actor must own the event's container and an Undo must share the Like's
document and actor. Creating a missing reaction day uses If-None-Match; subsequent
events use conditional INSERT DATA with one conflict retry. Edits/tombstones use
copy-on-write PUT with a strong If-Match. `removeMessage` is the explicit owner
moderation operation and preserves the original author.

In v2, authorship is bound by the pod server's access control as configured by the
room owner. The owner can write in any member container for moderation and is the
trust root. A member cannot forge another member's messages or reactions under
these ACLs. LongChat/SolidOS clients do not read v2 member containers (v1 paths were
already not SolidOS-shaped). Existing v1 rooms retain shared days, member
Read/Append, owner-only client edit/delete, and claimed authorship: client-side
author checks hold only between honest v1 clients.
