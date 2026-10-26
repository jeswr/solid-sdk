<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Notes / Docs shared JSON profile

`notesToDocs(unknown)` and `docsToNotes(unknown)` validate and deep-copy the
intersection of the two editor profiles. Both use TipTap's ProseMirror JSON
names, so conversion preserves the JSON exactly (including omitted versus empty
content/attrs, text whitespace, mark order, ordered-list starts and checked
flags). The exported `DocsDocument` type describes this shared subset, not the
entire Docs schema. There is no HTML parsing, resource move, persistence or UI.

Supported nodes: `doc`, `paragraph`, `heading` (levels 1–3), `text`, `bulletList`,
`orderedList`, `listItem`, `taskList`, `taskItem`. Marks: `bold`, `italic`, `link`.
Lists must be nonempty; list/task items start with a paragraph and may contain
further paragraphs, headings or nested lists. Task-list nesting is limited to
three levels, following 05-docs §4.7. Overall node depth is limited to 64;
cyclic input is rejected by this bound with a typed error.

Attributes: heading `level` (required), ordered-list `start` (optional, positive
safe integer; omitted means the editor default), task-item `checked` (required
boolean), link `href` (required) and optional nullable `target`, `rel`, `class`,
`title`. Other nodes and non-link marks accept only absent/empty attrs. Links
accept absolute http(s)/mailto URLs or suite-absolute nonempty paths, rejecting
whitespace, controls, backslashes, protocol-relative links and unknown schemes.
All strings must be well-formed Unicode. Link spelling is never normalised.
Rendering remains responsible for the spec's `noopener noreferrer` policy.

Unknown nodes/marks/attributes, wrong parent-child relationships, duplicate mark
types, malformed attrs, empty text nodes, sparse arrays, non-data properties and
non-JSON objects fail with `NotesConversionError`. Its `code` discriminates
`invalid-input`, `unsupported-node`, `unsupported-mark`, `unsupported-attribute`,
`invalid-structure`, `invalid-index` and `limit-exceeded`; messages never include
private content. Unsupported Docs features are rejected on reverse conversion.
There is no best-effort flattening or dropping of data.

Checklist transforms operate on the existing NOT-L1 `ChecklistItem` shape
(`{ text: string, checked: boolean }`), validating every item before acting.
Extra fields are rejected. Empty text is retained for an in-progress item.

- `toggleChecklistItem(items, at)` flips one flag.
- `reorderChecklistItems(items, from, to)` removes and reinserts one item;
  zero-based `to` is its final index. Both indices must address an existing item.
- `moveCheckedToBottom(items)` stably partitions unchecked before checked.
- `uncheckAll(items)` sets every checked flag to false, retaining array order.

All operations return fresh arrays and leave inputs untouched. Unchanged items
retain their object identity; changed flags produce new item objects. Empty bulk
operations return empty arrays; indexed operations reject empty arrays.
