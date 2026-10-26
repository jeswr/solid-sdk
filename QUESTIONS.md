<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-epya / NOT-L1 questions and conservative readings

1. **Mixed ordering keys** — NOT-L1 in `specs/apps/tasks.json` and
   `10-pure-libraries-2.md` says “fractional order key or updated desc”; Notes in
   `07-parity-backlog.md` only fixes pinned before other notes. Options: keyed notes
   first, ignore keys for the entire group, or reject mixed keyed/unkeyed groups.
   Implemented: each pinned/unpinned group must be wholly keyed or wholly unkeyed;
   reject mixed groups with a typed error. Keyed groups use SH-L1 binary lexical
   order; unkeyed groups use descending epoch-millisecond `updatedAt`. Ties retain
   input order. Separate pinned groups may use different modes.
2. **Capture grammar** — NOT-L1 specifies checklist prefixes but no title/body
   split or Markdown dialect. Options: first line is title, first prose line is
   title, or require a separate title. Implemented: first line is title unless it
   is a checklist item, in which case title is empty. Remaining prose becomes body;
   checklist lines become ordered items. LF and CRLF are accepted; bare CR,
   malformed Unicode, empty captures/items, indented/nested checkboxes, uppercase
   `[X]`, and alternate bullet checkboxes are rejected. Exact `[ ]`, `[x]`,
   `- [ ]`, and symmetric `- [x]` prefixes are accepted; a space separates item
   text from its marker. Other prose is literal plain text, never HTML/Markdown.
3. **Restore destination and invalid actions** — Notes in `07-parity-backlog.md`
   specifies archive/trash without a transition table. Options: restore to active,
   restore to the previous location, or require an explicit target. Implemented:
   trash remembers active/archive origin and restore returns there; unarchive
   returns archive to active. Repeating archive/unarchive/trash is idempotent;
   restore outside trash and archive/unarchive while trashed are typed errors.
   Pin/label/order metadata is outside this location-only reducer. Purge policy
   and persistence belong to NOT-01 and are outside NOT-L1.
4. **Labels and excerpts** — NOT-L1 leaves label identity, empty selection, and
   excerpt decoration open. Options include normalising labels or exact matching,
   empty union matching nothing or disabling filtering, and automatic ellipsis.
   Implemented: labels are exact nonempty strings (case/whitespace preserved),
   unions/intersections deduplicate in first-seen order; an empty filter returns
   all notes for either mode. Excerpts take already projected plain text and
   return exactly the first N graphemes, with no trimming, HTML stripping,
   line limit, or ellipsis. Invalid limits or unavailable Intl.Segmenter fail
   with a typed error. This keeps the later UI free to apply the six-line card
   clamp from `07-parity-backlog.md` without conflating lines and graphemes.
