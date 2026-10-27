<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Chat message search

Pure TypeScript, with no clock, React, storage, RDF, or network access. Import from
`./index`. Callers supply a live message snapshot, already authorised for the viewer.

```ts
import { parseQuery, evaluateQuery, searchMessages } from "./index";

const messages = [{
  id: "https://example.org/chat/garden/day#one",
  roomId: "https://example.org/chat/garden/",
  authorName: "Mira Vale",
  authorWebId: "https://example.org/mira#me",
  text: "Meet at the café gate. @noel https://example.org/plan",
  createdAt: Date.parse("2026-04-03T12:00:00Z"),
  hasAttachment: false,
  inReplyTo: null,
}];
const query = parseQuery('cafe -rain from:mira on:2026-04-03 has:link');
const results = evaluateQuery(query, messages, "Europe/London");
// Equivalent: searchMessages(source, messages, "Europe/London").
// results[0]: { message: messages[0], score: 4,
//   snippet: { text: messages[0].text, ranges: [[12, 16]] } }
```

- All positive terms are required; negations exclude matches. Bare terms search only
  `text`, on Unicode letter/number/underscore word prefixes. Quoted phrases are contiguous
  literals with whole-word boundaries. Both use NFKD, combining-mark removal and lowercase
  folding, including Greek final sigma. Repeated query terms count individually; repeated
  occurrences of a term do not increase score.
- Filters are `from:`, `in:`, `before:`, `after:`, `on:`, `has:link`, `has:attachment`,
  `has:mention`, `is:thread`. Keys and enum values are lowercase. Filters can be negated,
  and values can be quoted. Unknown keys become literal text terms with the colon retained.
  There is no OR, grouping or escape syntax; words such as `OR` remain ordinary words.
  Unsupported quote placement, backslash escapes, empty known values, malformed Unicode,
  and unknown values for `has:` / `is:` throw `INVALID_QUERY`.
- `from:` matches name prefixes or an exact HTTP(S) WebID, and `in:` matches the exact
  `roomId`. IDs are opaque, without URL normalisation. Links are syntactically valid
  HTTP(S) URLs without credentials. Mentions are boundary-delimited `@handle` or
  `@[label](http(s)://…)` text, excluding emails and URL contents. These text flags do not
  resolve people, interpret Markdown/code blocks, or consult a current viewer.
- `createdAt` is an integer UTC Unix timestamp in years 0001–9999. Dates use the supplied
  IANA zone and proleptic Gregorian calendar: `before:` / `after:` exclude the named local
  date, and `on:` includes its whole day. No fixed 24-hour assumption is made, including
  DST, fractional-hour offsets and skipped local dates. Intl validates zone names and
  aliases, including digit-bearing names such as `CST6CDT`, `EST5EDT`, `PST8PDT` and `GMT0`.
  The host must have IANA ICU data.
- Results sort by matched positive term count, then descending timestamp, then ascending
  UTF-16 ID. With conjunction semantics, scores are equal within a query. Every record
  is validated, including nonmatches; malformed records, sparse arrays and duplicate IDs
  throw `INVALID_MESSAGE`. Missing zones, numeric offset zones, and unknown IANA zones
  throw `INVALID_TIME_ZONE`. Inputs are never mutated; results retain the original message.
- Snippets include at most `MAX_SNIPPET_LENGTH` (160) UTF-16 units including `…`. They
  show context around the earliest positive text match, or the prefix for filter-only
  hits. Sorted, merged highlight ranges are half-open UTF-16 offsets into the displayed
  snippet, including its leading ellipsis. NFKD expansions and original combining marks
  retain source offsets. Long highlights clip to the window; no cut splits a surrogate pair.
- `MAX_QUERY_LENGTH` (1,000 UTF-16 units), `MAX_QUERY_TERMS` (32) and `MAX_MESSAGES`
  (100,000) are exported. Query length is checked before scanning, term count during bounded
  tokenisation before AST processing, and message count before parsing/evaluating. AST
  evaluation also checks term count and total value length before folding. Oversize input
  throws `QUERY_TOO_LARGE` / `TOO_MANY_MESSAGES`. Empty or negation-only queries throw
  `EMPTY_QUERY`; unbalanced quotes throw `UNTERMINATED_PHRASE`; impossible/ill-formed
  dates throw `INVALID_DATE`. All failures use exported `SearchError` with a static message
  and machine-readable `code`, without echoing caller data.
- String bounds are exported and measured in UTF-16 units: `MAX_MESSAGE_ID_LENGTH`
  (2,048) covers `id`, `roomId` and non-null `inReplyTo`; `MAX_MESSAGE_FIELD_LENGTH`
  (2,048) covers `authorName` and `authorWebId`; `MAX_MESSAGE_TEXT_LENGTH`
  (1,000,000) covers `text`. The whole snapshot passes type/length preflight before
  Unicode checks, trimming, hashing, projection or highlight sorting. Oversize fields
  throw `INVALID_MESSAGE`. `MAX_TIME_ZONE_LENGTH` (64) is checked before zone regex
  or Intl processing; oversize zones throw `INVALID_TIME_ZONE`.

Root `QUESTIONS.md` records the conservative readings of underspecified behaviour.
The app coverage gate requires 100% statements, branches, functions and lines per file.
