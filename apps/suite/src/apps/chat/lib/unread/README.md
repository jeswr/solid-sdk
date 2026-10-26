<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Chat unread state

Pure TypeScript; import from `./index`. No React, RDF, network, storage, or clock.
Message identity and timestamp fields match `../timeline`.

```ts
import { advanceReadMarker, countUnread, decideNotification } from "./index";

const roomId = "https://example.org/chat/fictional-book-club/";
const viewerId = "https://example.org/people/mira#me";
const message = {
  id: `${roomId}2026/10/26.ttl#one`,
  roomId,
  senderId: "https://example.org/people/noel#me",
  timestamp: 1793016000000,
  mentionIds: [viewerId],
};
const marker = { roomId, lastRead: null };
countUnread({ ...marker, messages: [message] }, viewerId);
// { unreadCount: 1, mentionCount: 1 }
decideNotification({ type: "create", message }, { marker, viewerId, muted: true });
// { notify: true, reason: "mention" }
advanceReadMarker(marker, { roomId, lastRead: message.timestamp });
// { roomId, lastRead: 1793016000000 }
```

- Markers are scoped to one exact room ID. Merge same-room markers with
  `advanceReadMarker`: the maximum timestamp wins, regardless of arrival order.
  `null` explicitly means never read and cannot reset an existing timestamp.
  The function returns a fresh marker and never mutates inputs. Callers persist
  the result in account-scoped preferences and merge concurrent updates through
  the same function; this library does not provide storage concurrency control.
- A message is unread exactly when its original creation timestamp is strictly
  greater than the marker, or the marker is `null`. All messages at the marker's
  timestamp are read; there is no message-ID cursor. Own messages count, matching
  the timeline library. Muting does not alter counts.
- `mentionCount` counts unread messages containing the viewer's exact identity in
  `mentionIds`, once per message even when recipients repeat. Mention recipients
  must be resolved by the data layer; text, handles and display names are never
  interpreted. Identity strings are opaque, nonblank and compared literally, with
  no trimming, URL rewriting, Unicode normalisation or case folding.
- Counts describe only the supplied live snapshot. Full-room totals require the
  full list. Input order is irrelevant. Duplicate message IDs, revision logs and
  mixed-room inputs are rejected; the caller removes tombstones and resolves
  revisions before calling. Edits retain the original creation timestamp and do
  not add unread messages. Current mention recipients determine mention counts.
- Notification rule order: edits → own messages → already-read messages → mention
  override → mute → ordinary message. The first three always suppress. Mentions
  override conversation mute only. `reason` explains the result. The caller must
  explicitly classify events as `create` or `edit`; an edit that introduces a
  mention cannot notify. Eligibility is deterministic and stateless: the caller
  handles transport replay/delivery deduplication, permissions and global settings.
- Unsupported input throws `UnreadError` with a typed `code` and static error
  text. Validation includes even read, own and edited messages. Missing markers,
  missing mention lists, unknown event kinds, non-boolean mute flags, malformed
  lists (including holes), duplicate IDs and cross-room events fail closed.
  Timestamps must be numeric integer Unix milliseconds within UTC years
  0001–9999, matching the timeline. Date/string coercion never occurs.

See root `QUESTIONS.md` for the spec boundaries used here. Unit tests enforce
100% statements, branches, functions and lines for every TypeScript file in this
directory through the app's coverage configuration.
