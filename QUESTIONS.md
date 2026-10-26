<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# CHT-L5 interpretation questions

1. **Combining terms and ranking** (tasks.json CHT-L5; 14-pure-libraries-6):
   alternatives are all positive terms required, or any positive text term with filters
   required. Use the conservative conjunction: every positive term must match and every
   negation must not match. Score counts matched positive query terms once each (including
   filters); consequently a single query's results have equal scores and sort by recency,
   then ascending, locale-independent message ID. Empty input is `EMPTY_QUERY`.
2. **Exclusive date filters** (CHT-L5): alternatives for `after:` are after the named
   day's midnight, or after the entire named local date. Use calendar-date comparisons:
   `before:` and `after:` exclude the named date; `on:` includes its whole local day,
   including DST transitions. `createdAt` is integer Unix milliseconds, like the existing
   chat timeline/unread libraries; no Date/string coercion.
3. **Names, rooms, and text-derived flags** (CHT-L5; 07-parity-backlog Chat):
   records contain no room names or resolved mention list. Match `in:` against the exact
   opaque `roomId`, and HTTP(S) `from:` against the exact `authorWebId`. Other `from:`
   values match name word prefixes. Recognise HTTP(S) links and boundary-delimited
   `@handle` / `@[label](https://example.org/person#me)` mentions in plain text. Do not
   resolve names or infer thread roots: `is:thread` means non-null `inReplyTo`.
4. **Phrase and snippet boundaries** (CHT-L5): use contiguous, case/diacritic-insensitive
   literal phrases with word boundaries, rather than token proximity. Bare terms match
   word prefixes. Snippets include their ellipses within 160 UTF-16 code units, with
   half-open UTF-16 ranges into the displayed snippet. Clip long highlights to the
   visible window; never split a surrogate pair. Filter-only hits show the message prefix.

These choices are implemented and tested; none blocks this lane. No UI is built, so the
mockup/Playwright screenshot instructions do not apply. No browser was launched.
