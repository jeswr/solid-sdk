<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Google Tasks JSON import

`parseGoogleTasksJson(json, options?)` parses Takeout's `Tasks.json`
(`kind: "tasks#taskLists"`, lists in `items`, tasks in each list's `items`).
It also accepts a single Google Tasks API `tasks.list` response
(`kind: "tasks#tasks"`); `options.singleListName` supplies its project name,
defaulting to "Imported tasks". Empty or omitted `items` arrays work. One
leading BOM is accepted. There is no IO, RDF, React, clock or identity lookup.

The result is `{ projects, warnings }`. Each list becomes a project with a
trimmed `name`, local `id`, empty `sections`, flat `tasks` and its own `warnings`.
`ProjectImportDraft` and `TaskImportDraft` are exported shared consumer types:
both the existing Todoist drafts and Google Tasks drafts are assignable to
them. The Todoist parser and its required priority remain unchanged. Google
drafts omit priority, add `state: "open" | "closed"` and optional UTC ISO
`completedAt`, and retain the other Todoist fields with empty defaults.
Completed tasks without a completion timestamp remain closed, with no invented
date. A completion timestamp on an open task fails with `INVALID_DATA`.

Local IDs use zero-based source list/task indices, including skipped records:
`project-0`, `task-0-2`. Each task also retains its original Google ID as `sourceId`
for deterministic import resource URLs scoped to the destination project.
Parent IDs resolve within their source list only. Output
tasks are parent-first, with siblings sorted by ordinary string comparison of
Google's zero-padded `position`, without converting to numbers. Ties retain
source order. Numeric `orderKey` is the zero-based output index; compatible
`line` is the one-based source task ordinal within its list, not a JSON line.
`indent` is 1 for roots and 2 for children. The current app supports one child
level (06-tasks §4.6); deeper descendants become children of their original root,
and the resulting siblings are sorted by position. Cycles, including self-parenting,
fail with `INVALID_HIERARCHY` instead of producing incomplete drafts.

Titles are trimmed; notes and link text remain literal. Descriptions join notes
and each link's `description: url` on newlines, omitting empty notes. No URLs are
followed, interpreted or rendered. No label or natural-language tokenisation runs.
Due timestamps become all-day Todoist-compatible values:
`{ kind: "date", date: "2026-11-05", dateTime: "2026-11-05T00:00:00.000Z", timeZone: "UTC" }`.
The source calendar date is retained regardless of its time/offset; Google stores
date-only deadlines at midnight UTC. Completion timestamps are normalised to UTC.
RFC 3339 values require a valid Gregorian date, seconds and a known offset
(`Z` or numeric); fractional seconds beyond milliseconds are truncated. Lowercase
`t`/`z` work. Leap seconds, year zero, unknown `-00:00` offsets and UTC instants
outside four-digit years are rejected with `INVALID_DATE`.

Warnings contain only `code` and one-based source `list` / `task` ordinals:

- `DELETED_TASK`: skipped, even when its remaining fields are absent.
- `HIDDEN_COMPLETED`: kept with its completion state and date.
- `UNKNOWN_PARENT`: absent, deleted or other-list parent; task becomes a root.
- `DEPTH_FLATTENED`: descendant moved under its root to fit the supported depth.

The exported limits are 4 MiB of UTF-8 including BOM
(`MAX_GOOGLE_TASKS_JSON_BYTES`), 1,000 lists (`MAX_GOOGLE_TASKS_LISTS`), 20,000
total source tasks including deleted ones (`MAX_GOOGLE_TASKS_TASKS`), and 32
nested JSON objects/arrays (`MAX_GOOGLE_TASKS_JSON_DEPTH`). Bytes and nesting are
checked before `JSON.parse`; count limits precede draft construction. Ancestor
walks are iterative and memoised. Records are read through own-property checks;
unknown fields including `__proto__` are ignored and IDs use `Map`/`Set`.

Malformed JSON, non-object roots, invalid fields, duplicate list/task source IDs,
and limits throw `GoogleTasksImportError`. Its `code` is one of `INVALID_JSON`,
`INVALID_DATA`, `INVALID_DATE`, `INVALID_HIERARCHY`, `JSON_TOO_LARGE`,
`JSON_TOO_DEEP`, `TOO_MANY_LISTS`, `TOO_MANY_TASKS`. Messages contain only a fixed
prefix and code, never file contents or parser diagnostics. Unsupported metadata
(`updated`, link type, API pagination tokens, etc.) is ignored; API callers must
collect all task pages before importing a complete list.
