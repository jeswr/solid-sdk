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
- `createRoom`: creates parents, then a new room, its advertised WAC ACL and
  index, in that order. Owner gets Read/Write/Control, members Read/Append with
  default inheritance. No public grants. It does not auto-join the owner or send
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
All requests refuse redirects and stay in that scope. The server remains the
permission authority: local author checks cannot prevent a malicious client
from rewriting shared data. Read+Append members cannot edit/delete existing
statements without further server permission; see root QUESTIONS.md.
