---
name: solid-scheduling
description: Use when reading or writing Solid tasks, calendars or Suite Calendar documents and events through @jeswr/solid-scheduling, changing its SHACL or vocabulary use, or maintaining its sched:Task to wf:Task cross-serialisation.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Solid scheduling model

Tasks (`sched:Task`), calendars (`sched:Calendar`), recurrence rules and reminders from
the federation scheduling sector; the package mints no IRIs. Task and calendar
build/parse run on a model generated from `codegen/` (codegen Phase S, bead sst-ild.7.5):
`src/task.ts` and `src/calendar.ts` are facades over `src/generated/model.js`. Never edit
`src/generated/`; change `codegen/scheduling.shapes.ttl` or `codegen/codegen.config.json`,
then run `pnpm run codegen --update-lock`. The drift test (`test/codegen.test.ts`) and
the divergence pins (`test/compatibility.test.ts`, README "Exact divergences") must pass.

The generated composite covers the `sched:Task` core and its one `sched:RecurrenceRule`.
The facade adds what SHACL cannot express: the `wf:Task` overlay, unified completion,
frequency normalisation on write, `dct:subject` labels, and any number of
`sched:hasReminder` nodes through the typed views in `src/nodes.ts`.

Load-bearing behaviour (`DECISIONS.md` D2): every `sched:Task` is also written as the
shared `wf:Task` from `@jeswr/solid-task-model` on the same `#it` subject.
`buildSchedulingTask` builds the `wf:Task` store with task-model's `buildTask`, which owns
build-side http(s) IRI filtering and the `wf:Open`/`wf:Closed` state, then layers the
`sched:` triples. Do not re-implement that logic here. task-model's `parseTask` does not
filter IRIs and throws on a wrong term kind, so `parseSchedulingTask` guards that read and
http(s)-filters every `wf:` IRI it returns. The completion timestamp is computed
once and written to both `sched:completedAt` and `prov:endedAtTime`; an explicit
`completed: false` wins over a supplied `completedAt`.

`src/suite-calendar.ts` is the Suite Calendar facade over the generated `CalendarDocument`
and `CalendarEvent` entities, on the app's exact `jsched:`/schema.org/`dct:` IRIs. It adds
only the second event class (`schema:Event`). Event dates, `jsched:summary`,
`jsched:inCalendar`, recurrence and reminders stay in the Suite app (README "Suite Calendar"
says why); its divergences are pinned in `test/suite-calendar-compatibility.test.ts`.

`scheduling.shacl.ttl` is the published package profile (Task, RecurrenceRule, Reminder,
Calendar); `codegen/scheduling.shapes.ttl` is the generation input derived from it, with
the differences listed in its header;
`src/shape.test.ts` validates it with rdf-validate-shacl. `scheduling.proposals.ttl` holds
`fedcon:Proposal` candidates for sector gaps; do not edit the sector from here.

From the workspace root:

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-scheduling
```
