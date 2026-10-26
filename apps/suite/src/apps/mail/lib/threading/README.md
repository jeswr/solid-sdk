<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Mail threading

Pure TypeScript; import `buildThreads`, `normalizeSubject`, types and `ThreadingError`
from `./index`. No React, hooks, RDF, clock, storage or network. No added dependencies.

```ts
import { buildThreads } from "./index";

const threads = buildThreads([{
  id: "https://example.org/mail/messages/1",
  messageId: "<one@example.org>",
  subject: "[book-club] Reading plans",
  timestamp: 1793016000000,
  from: "mira@example.org",
  to: ["rowan@example.org"],
  isRead: false,
  text: "Shall we read the fictional Moon Orchard next?",
}]);
```

The input is one mailbox's decoded snapshot, not raw RFC 822/MIME. `id` is a unique
resource identity (distinct from its optional Message-ID); timestamps are integer Unix
milliseconds in UTC years 0001–9999. Subjects must already be decoded and unfolded;
body text must already be plain text. Participant identities are nonblank exact strings
from the caller, including case. The library does not parse display-name addresses or
infer whether two identities name the same person. `from`, `to`, `text`, `subject` and
`isRead` are required; `cc` is optional. Empty subject, text and recipient arrays are valid.

`messageId` and `inReplyTo` accept exactly one angle-bracketed ASCII dot-atom ID;
`references` is an ordered array of such IDs. Comparisons are case-sensitive. Quoted
IDs, comments, domain literals, surrounding whitespace, bare IDs and multiple IDs in
one value throw `ThreadingError("unsupported-message-id")`. These forms require an
importer capable of interpreting them; they are never guessed, discarded or coerced.
Malformed lower-priority headers also fail validation. Missing IDs are allowed.

Threading follows JWZ's container algorithm, as documented by the REFERENCES algorithm
in [RFC 5256 §3](https://www.rfc-editor.org/rfc/rfc5256.html#section-3), with the task's
localized prefix normalization and latest-message thread ordering:

- Process messages by ascending timestamp, then resource ID in UTF-16 order. The first
  occurrence of a Message-ID owns the canonical container. Duplicates get independent
  containers, keep their own ancestry and remain in the result; subsequent references
  target the canonical occurrence. Absent IDs get independent containers as well.
- Nonempty References take precedence over In-Reply-To. Missing references create
  placeholders, filled if their messages arrive later. Preserve an already inferred
  parent unless the message's own headers override it. Skip self-links and links that
  introduce cycles, as JWZ prescribes. This handles these supported anomalies without
  losing messages; it is distinct from rejecting unsupported input syntax.
- Prune empty placeholders and promote children of interior placeholders. Keep a
  missing root with multiple children so orphan siblings remain together. A dummy
  root's subject comes from its earliest direct child.
- Merge only roots sharing a nonempty normalized subject. Prefer dummy roots, then
  an original subject over a reply. A reply joins the original as a child; two original
  roots or two reply roots join under a synthetic parent. Header-linked descendants
  retain their ancestry even when their subjects change.
- Normalization collapses whitespace, lowercases for matching, and repeatedly strips
  leading `Re:`, `Fw:`, `Fwd:`, `AW:`, `SV:` (case-insensitive, optional `[number]`)
  and bracketed list tags. Interior text stays intact. The key is not a display title;
  the untouched original subject is available on every message. This is a documented
  subset of subject conventions, not full RFC base-subject extraction.

Each result contains the tree (`root.message === null` for a synthetic root), all real
`messages` chronologically sorted, normalized `subject`, `latestTimestamp`, sorted
distinct sender/To/Cc `participants`, `unreadCount`, and the latest message's `snippet`
(whitespace collapsed, at most 160 Unicode code points, no ellipsis). Empty latest text
produces an empty snippet. Thread `id` is the smallest member resource ID, a deterministic
snapshot key rather than a persisted conversation identity. Threads sort latest first,
with `id` breaking equal-time ties; sibling messages sort chronologically with ID ties.
Missing ancestors are excluded from summaries. Counts cover only supplied messages.

All input arrays/objects remain untouched, generic payloads retain their original
references, and output arrays/tree nodes are fresh. Traversals are iterative for deep
threads. Invalid shapes, repeated resource IDs, unsupported timestamps, header syntax
and undecoded subjects fail with `ThreadingError` and a typed `code`; messages never
echo mailbox content. See root `QUESTIONS.md` for unspecified-boundary choices.

Vitest enforces 100% statements, branches, functions and lines per TypeScript file in
this directory through the app's coverage glob.
