<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# VTODO exchange

Pure TypeScript, without network, hooks, RDF, time-zone defaults, generated IDs, or clock reads.
`index.ts` exports `parseVTodo`, `serializeVTodo`, `toTaskData`, the exchange types, and
`VTodoError` (with a stable `code`; messages never include calendar contents).

```ts
const calendar = parseVTodo(ics);
const todo = calendar.tasks[0]!;
const projection = toTaskData(todo, {
  resourceIds: new Map([["parent@example.org", "https://example.org/tasks/parent.ttl#it"]]),
  // Required only for a date-only DUE: midnight in the account's time zone.
  allDayDueInstant: new Date("2026-11-01T04:00:00Z"),
});
const exported = serializeVTodo(calendar);
```

The parser accepts a complete `VCALENDAR` containing one or more `VTODO`s, `VERSION:2.0`,
`PRODID`, and optionally `CALSCALE:GREGORIAN`. Each task needs `UID`, UTC `DTSTAMP`, and a
nonblank `SUMMARY`, because the task model requires a title. Input uses RFC 5545 CRLF,
including the final CRLF. Output folds at 75 UTF-8 octets, including the continuation space,
without splitting Unicode code points. Import unfolds SP/HTAB; TEXT escapes backslash,
comma, semicolon, and newline, and preserves whitespace and Unicode without normalization.
Property/parameter names and enumerated values are case insensitive. Export canonicalizes
names, numeric spellings, defaults, property order, and redundant VALUE parameters.

| iCalendar | Exchange / task-model mapping |
| --- | --- |
| SUMMARY, DESCRIPTION | `title`, `description` (preserves absent vs empty description) |
| DUE, DTSTART | `due`, `start`: `{kind:'date', value:'YYYY-MM-DD'}` or `{kind:'utc', value:Date}` |
| COMPLETED | `endedAt` (UTC, whole seconds) |
| STATUS | Exact optional `status`; COMPLETED/CANCELLED → `state:'closed'`, others → open |
| PRIORITY | Exact optional `icalPriority`; 0 → absent model priority, 1–4 → high, 5 → medium, 6–9 → low |
| PERCENT-COMPLETE | Optional integer `percentComplete` in 0–100; no inferred lifecycle changes |
| RRULE | Opaque `rrule`, with lexical framing checked and DTSTART required; no recurrence evaluation |
| RELATED-TO | One `parentUid`; absent RELTYPE defaults to PARENT; explicit PARENT is supported |

`toTaskData` returns `{task, dueDay?}`. `task` structurally matches the relevant shared
`TaskData` fields (including `Date` values); `dueDay` is the `sched:dueTime` xsd:date marker
from tasks spec §5.3. This function clones dates, resolves parent UIDs through the caller's
explicit map, and needs a caller-supplied UTC instant for an all-day due date. It never
interprets a UID as an RDF resource IRI. Parent resources must be absolute HTTP(S) URLs
without credentials. Keep the exchange DTO for export: start, exact status/priority,
progress, recurrence, identity and timestamp are exchange metadata rather than shared
`TaskData` fields. In particular, raw RRULE must not be written as the structured
`sched:RecurrenceRule` from §5.4. RDF persistence is the caller's responsibility.

Export accepts the same task fields plus exchange metadata. If only a model priority is
provided it writes 1/5/9; if `icalPriority` is supplied its band must agree with `priority`.
A closed task without STATUS or COMPLETED exports `STATUS:COMPLETED`. With only COMPLETED,
import derives closed state and export preserves the absence of STATUS. Explicit open
statuses with COMPLETED, and CANCELLED with COMPLETED, are rejected as ambiguous for the
binary model. No missing completion instant is invented.

Unsupported components (including nested alarms), properties, parameters, floating/TZID
times, leap seconds, mixed start/due types, duplicate singleton fields/UIDs, self-parent
links, non-increasing DUE relative to DTSTART, and invalid dates/escapes are rejected
atomically with typed errors. External parent UIDs can be preserved and exported; model
projection rejects unresolved parents. RRULE contents are passed through unchanged and
are not a claim of recurrence support. No partial calendar is returned on failure.

Reference: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html), especially §§3.1,
3.3.4–5, 3.3.11, 3.6.2, and 3.8. Conservative boundary choices are recorded in
the lane's root `QUESTIONS.md`.
