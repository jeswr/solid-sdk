<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Chat timeline

Pure TypeScript. Import from `./index`; no React, RDF, storage, clock or network.

```ts
import { buildTimeline, unreadCountsByRoom, aggregateReactions } from "./index";

const room = {
  roomId: "https://example.org/chat/book-club/",
  lastRead: null,
  messages: [{
    id: "https://example.org/chat/book-club/2026/10/26.ttl#message-1",
    roomId: "https://example.org/chat/book-club/",
    senderId: "https://example.org/people/mira#me",
    timestamp: Date.parse("2026-10-26T12:00:00Z"),
    content: "A fictional book discussion",
  }],
};
const timeline = buildTimeline(room, {
  timeZone: "Europe/London",
  groupWithinMinutes: 5,
});
const counts = unreadCountsByRoom([room]); // Map(roomId → 1)
const reactions = aggregateReactions([
  { emoji: "👍", actorId: "https://example.org/people/mira#me" },
], "https://example.org/people/mira#me"); // [{ emoji: "👍", count: 1, reactedByMe: true }]
```

- Messages sort ascending by integer Unix milliseconds, then by unique ID using
  locale-independent UTF-16 order. The original generic message payloads are retained.
  Neither input arrays nor objects are mutated; output arrays are fresh.
- `buildTimeline` emits `day-divider`, `unread-marker` and `message-group` items.
  Each occupied local Gregorian day starts with a `YYYY-MM-DD` divider. Days are
  derived through `Intl` in the explicitly supplied viewer zone, including DST and
  date-line changes. A divider is a civil date, not a UTC instant or a fixed 24 hours.
- Groups contain consecutive same-sender messages with adjacent elapsed gaps ≤ N
  minutes. N is explicit, nonnegative and must resolve to a safe integer number of
  milliseconds. Zero groups equal-time messages; fractional minutes are supported.
  Day dividers and the unread marker always split a group.
- `lastRead: null` means never read. A message is unread exactly when its timestamp
  is strictly newer than last-read, regardless of sender. Equal timestamps are all
  read or all unread; an ID tie-break does not change receipt semantics. The one
  unread marker precedes the first unread message, after its day divider if present.
  Empty/all-read timelines have no unread marker. Future receipts yield no unread.
- `unreadCountsByRoom` retains zero-count rooms, rejects duplicate room IDs and
  counts only supplied messages. Paged snapshots produce counts for that page;
  complete room counts require complete input. Neither API advances receipts.
- `aggregateReactions` accepts one message's **active reaction snapshot**, not an
  event log. Counts are distinct actors per exact emoji token; duplicates are
  idempotent. Results sort by token in UTF-16 order. Tokens are opaque nonblank
  strings from the typed data layer: no emoji allowlist, Unicode normalisation,
  skin-tone merging, or add/remove-event replay. IDs also remain exact strings.
- Invalid room/message/reaction shapes, blank IDs, duplicate message IDs, mixed
  rooms, invalid zones/options and unsupported timestamps throw `TimelineError`
  with a typed `code`. Error text does not echo inputs. Timestamps must be numeric
  integer milliseconds within UTC years 0001–9999; timeline local dates must also
  remain in years 0001–9999. No string/Date coercion or missing-receipt fallback.

See root `QUESTIONS.md` for the conservative readings of unspecified boundaries.
`pnpm --filter @jeswr/app-suite run test` enforces 100% coverage per TypeScript file
in this directory (statements, branches, functions and lines).
