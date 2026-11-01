---
name: solid-scheduling
description: Use when reading or writing Solid tasks and calendars through @jeswr/solid-scheduling, changing its SHACL or vocabulary use, or maintaining its sched:Task to wf:Task cross-serialisation.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Solid scheduling model

Tasks (`sched:Task`), calendars (`sched:Calendar`), recurrence rules and reminders from
the federation scheduling sector; the package mints no IRIs. The model is still
hand-written: flipping it to a generated core is codegen Phase S (bead sst-ild.7.5), and
the workspace charter now requires new domain models to be generated.

Load-bearing behaviour (`DECISIONS.md` D2): every `sched:Task` is also written as the
shared `wf:Task` from `@jeswr/solid-task-model` on the same `#it` subject.
`buildSchedulingTask` builds the `wf:Task` store with task-model's `buildTask`, which owns
untrusted http(s) IRI filtering and the `wf:Open`/`wf:Closed` state, then layers the
`sched:` triples. Do not re-implement that logic here. The completion timestamp is computed
once and written to both `sched:completedAt` and `prov:endedAtTime`; an explicit
`completed: false` wins over a supplied `completedAt`.

`scheduling.shacl.ttl` is the package profile (Task, RecurrenceRule, Reminder, Calendar);
`src/shape.test.ts` validates it with rdf-validate-shacl. `scheduling.proposals.ttl` holds
`fedcon:Proposal` candidates for sector gaps; do not edit the sector from here.

From the workspace root:

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-scheduling
```
