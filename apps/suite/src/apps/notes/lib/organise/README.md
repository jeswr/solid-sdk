<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Notes organisation (NOT-L3)

Import from `./index`. These helpers consume plain TypeScript projections; callers own
storage, clocks, HTML-to-text projection, filtering by location, and the label registry.
The existing `../state` location-only reducer remains compatible.

`reduceNoteOrganisation(state, action)` accepts `active` (boolean pin), `archived`
(always unpinned), or `trashed` (unpinned, with a saved live location and pin). Every state
also has `labels`. Actions are `pin`, `unpin`, `archive`, `unarchive`, `trash`, `restore`,
`add-label` and `remove-label` (the latter two carry `label`). Archive clears the pin;
unarchive preserves an active pin and returns archived notes unpinned. Repeated trash
preserves the original snapshot. Restore recovers the saved pin and location, retaining
current labels so bulk label edits in trash are not undone. Editing a trashed note or
pinning an archived note fails with `NotesError("invalid-transition")`.

`renameLabel(notes, from, to)`, `mergeLabels(notes, from, into)` and
`deleteLabel(notes, label)` operate across every supplied note, preserving order and
additional fields. Labels use exact string identity: no trimming, case folding or Unicode
normalisation. Rename rejects an existing destination; merge explicitly resolves collisions
at the first resulting destination position. Other labels keep their order and duplicates.
Identical names and missing sources are no-ops. Results have a new array; unchanged notes
retain their identity. All inputs are validated before any transformation.

`rankNotes(notes, query)` requires title, projected plain-text body, labels and safe integer
`updatedAt` epoch milliseconds. It returns `{ note, match, score }` hits:

| Match | Score | Rule |
| --- | --- | --- |
| `phrase` | 3 | Contiguous complete query words in one field |
| `prefix` | 2 | Contiguous query words with only the final word matched as a prefix |
| `token` | 1 | All query words occur exactly, in any order across fields |

Title, body and each individual label are separate, equally weighted fields. Relevance
precedes recency descending; complete ties preserve input order. Repetition does not boost
relevance. Query words follow `src/lib/search`'s existing Unicode word segmentation, default
case folding, compatibility normalisation and mark removal; punctuation and emoji separate
words. This is plain text search with no operator syntax. Empty or wordless queries return
`[]`. Search does not parse rich text, load content, inspect pins or filter note locations.

Malformed text (including ill-formed UTF-16), labels, timestamps, states and actions fail
with typed `NotesError` codes; messages do not echo content. Search requires `Intl.Segmenter`
and reports `segmenter-unavailable` if absent. Inputs are never mutated.
