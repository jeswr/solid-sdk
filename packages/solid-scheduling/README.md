# @jeswr/solid-scheduling

The RDF model for **scheduling** — tasks and calendars, one task per pod resource,
owner-private. The data model a [Vikunja](https://vikunja.io)→Solid fork writes to
a pod, and the 2nd model package of the OSS-forks batch 2.

It **mints nothing.** A task is a `sched:Task`, a calendar a `sched:Calendar`,
repeats are a `sched:RecurrenceRule`, alarms a `sched:Reminder` — all from the
[`@jeswr/solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)
**scheduling sector** — so the model reuses those terms verbatim.

Its load-bearing feature is **cross-sector serialisation**: a `sched:Task` written
here ALSO carries the shared **`wf:Task`** shape from the published
[`@jeswr/solid-task-model`](https://github.com/jeswr/solid-task-model) on the SAME
subject, so a Vikunja task surfaces **"assigned to me" in the Pod Manager /
solid-issues** — the first external app on the shared task model, and the concrete
demo of the data-federation vision.

Beyond that it gives you typed read/write accessors that **never hand-build a
triple** (parse via [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf),
serialise via `n3.Writer`), a focused SHACL shape, an owner-only fail-closed WAC
ACL helper, and — the ontology-test-rig payoff — a set of **`fedcon:Proposal`
candidates** for the scheduling-sector gaps that modelling real Vikunja/kanban data
surfaced.

## Install

GitHub-installable now (no build step — the built `dist/` is committed and the
package sets `ignore-scripts=true`):

```bash
npm install github:jeswr/solid-scheduling#main
```

## The model — one task document (dual-vocab, same subject)

```turtle
<#it>  a sched:Task, wf:Task, wf:Open ;           # BOTH vocabularies, same node
  sched:summary "Ship v1" ;  dct:title "Ship v1" ;              # sched + wf title
  sched:dueTime "2026-07-10T17:00:00Z"^^xsd:dateTime ;
  wf:dateDue    "2026-07-10T17:00:00Z"^^xsd:dateTime ;
  wf:assignee <https://bob.pod/profile/card#me> ;               # the federation edge
  sched:organizer <https://alice.pod/profile/card#me> ;
  dct:subject "backlog", "urgent" ;                             # labels (reuse dct:subject)
  schema:position 3 ;                                           # kanban order (via wf:Task)
  sched:recurrence <#recurrence> ; sched:hasReminder <#reminder0> .
<#recurrence> a sched:RecurrenceRule ; sched:frequency "WEEKLY" ; sched:interval 2 .
<#reminder0>  a sched:Reminder ; sched:triggerOffset "-PT15M"^^xsd:duration .
```

The `sched:*` triples are the **native scheduling** view; the co-located `wf:Task`
/ `dct:` / `schema:` triples are the **federation** view (owned by
`@jeswr/solid-task-model`). Both live on `<#it>`, so a scheduling consumer reads
`sched:Task` and the Pod Manager reads `wf:Task` from the very same resource.

> **Persistent IDs.** The `sched:` / `core:` IRIs are historically minted under
> `w3id.org/jeswr` — legacy identifiers that re-mint to the maintainer's live
> `jeswr.org` persistent-ID layer per the staged migration (minted IRIs in code
> are not hand-edited). `fedcon:` (`https://jeswr.org/fedcon#`) is already
> `jeswr.org`-rooted. This package mints no new persistent identifier.

## Usage

```ts
import {
  buildSchedulingTask,
  serializeSchedulingTask,
  parseSchedulingTask,
  parseSchedulingTaskTtl,
  serializeCalendar,
  writeOwnerOnlyAcl,
} from "@jeswr/solid-scheduling";

// Build + serialise one task to Turtle (BOTH sched:Task and wf:Task on #it)
const ttl = await serializeSchedulingTask("https://alice.pod/vikunja/tasks/42", {
  summary: "Review the PR",
  dueTime: new Date("2026-07-09T12:00:00Z"),
  assignee: "https://bob.pod/profile/card#me",  // → wf:assignee (assigned-to-me)
  organizer: "https://alice.pod/profile/card#me",
  priority: "high",
  position: 2,
  labels: ["review"],
  recurrence: { frequency: "WEEKLY", interval: 1 },
  reminders: [{ triggerOffset: "-PT15M" }],
});

// Parse it back as a scheduling task (native sched: view)
const task = await parseSchedulingTaskTtl("https://alice.pod/vikunja/tasks/42", ttl);
//   → { summary, dueTime, assignee, organizer, priority, position, labels, recurrence, reminders }

// The federation demo — the Pod Manager reads the SAME resource as a wf:Task:
import { parseTask, isAssignedTo } from "@jeswr/solid-task-model/task";
import { parseRdf } from "@jeswr/fetch-rdf";
const wf = parseTask("https://alice.pod/vikunja/tasks/42",
  await parseRdf(ttl, "text/turtle", { baseIRI: "https://alice.pod/vikunja/tasks/42" }));
isAssignedTo(wf?.assignee, "https://bob.pod/profile/card#me"); // → true

// Schedules are owner-private — write an owner-only, fail-closed ACL first
await writeOwnerOnlyAcl("https://alice.pod/vikunja/", "https://alice.pod/profile/card#me", authedFetch);
```

`parseSchedulingTask` returns `undefined` for anything that is not a usable task
(not a `sched:Task`, or no `sched:summary`), and its untrusted-input hardening
drops a hostile / malformed field (a non-http(s) organizer/calendar/assignee IRI, a
malformed date/number literal, an ill-formed duration, an unknown frequency) rather
than aborting the parse.

## The point — scheduling-sector extension needs (fedcon proposals)

This package is an **ontology test rig**: as it maps concrete Vikunja/kanban data
onto the scheduling sector, it discovers fields the sector lacks. Rather than
editing the sector `.ttl`, each gap is written up as a concrete **`fedcon:Proposal`
candidate** — machine-readable in
[`scheduling.proposals.ttl`](./scheduling.proposals.ttl), with the rationale +
alternatives in [`DECISIONS.md`](./DECISIONS.md).

| # | Gap the sector lacks | Proposed additive term(s) / decision | Intent |
|---|---|---|---|
| 1 | Kanban **board / bucket / position** (ordering — the sector has only `sched:inCalendar`) | `sched:Bucket`, `sched:inBucket`, `sched:boardPosition` (order currently carried via `wf:Task`'s `schema:position`) | Extend |
| 2 | First-class **labels / tags** (Vikunja labels have a colour) | reuse `dct:subject` (this package's choice) vs a managed `skos:Concept` scheme vs a minted `sched:label` with colour | Extend |
| 3 | **Task relations** — the sector declares none; `wf:`/`dct:` cover parent/blocks/relates/duplicate but not sequencing | adopt the `wf:`/`dct:` relation alignment on `sched:Task` + add `sched:precedes` / `sched:follows` | Extend |
| 4 | **Percent-done** (the sector has only the boolean `sched:completed`) | `sched:percentComplete` ([0,1] decimal), complementing `sched:completed` | Extend |
| 5 | **Reconcile** `sched:CalendarEvent` with the `@jeswr/solid-dav-bridge`'s `schema:Event` + `ical:` mapping — two producers, two event classes | decide the canonical event class (recommend `sched:CalendarEvent`; dav-bridge grows a projection) | Reconcile |

These are **candidates**, not filed proposals — the sector is never edited here.

## Public API

`./` (main — **browser-safe, no `node:*`**): the task model `SchedulingTask`,
`RecurrenceRule`, `Reminder`, `SchedulingTaskData`/`RecurrenceData`/`ReminderData`,
`schedulingTaskSubject`, `schedulingNodeIris`, `reminderIri`,
`buildSchedulingTask`, `serializeSchedulingTask`, `storeToTurtle`,
`parseSchedulingTask`, `parseSchedulingTaskTtl`, `TaskPriority`; the calendar model
`Calendar`, `CalendarData`, `calendarSubject`, `buildCalendar`, `serializeCalendar`,
`parseCalendar`, `parseCalendarTtl`; the owner-only ACL helpers `buildOwnerOnlyAcl`,
`writeOwnerOnlyAcl`, `aclUrlFor`; the IRI filter `isHttpIri`/`httpIriOrUndefined`;
and the reused vocab constants/builders (`SCHED`, `TASK_CLASS`, `SCHED_SUMMARY`,
`ATTENDANCE_STATUS`, `PREFIXES`, …).

`./shape` (**Node-only** — `readFileSync`s the shipped `.ttl`s):
`schedulingShapeTtl`, `schedulingProposalsTtl`, `SCHEDULING_SHAPE_PATH`,
`SCHEDULING_PROPOSALS_PATH`. Kept off the root so a browser bundle never pulls in
`node:fs`.

Subpath exports: `@jeswr/solid-scheduling/vocab`, `/shape`,
`/scheduling.shacl.ttl`, `/scheduling.proposals.ttl`.

## Develop

```bash
npm run gate   # lint + typecheck + test + build + check:dist + check:lockfile-transport
```

`dist/` is committed and a `check:dist` gate fails if it drifts from a fresh
build — rebuild + commit `dist/` alongside any `src/` change. After any `npm
install` that touches the `@jeswr/solid-task-model` git dependency, run
`npm run fix:lockfile-transport` (the #78 SSH-transport guard's FIX half).

## License

[MIT](./LICENSE) © Jesse Wright
