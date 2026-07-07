# Design decisions — @jeswr/solid-scheduling

<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

Rationale for the scheduling (task / calendar) model, and the machine-readable
`fedcon:Proposal` candidates it surfaced. Recorded per the suite
proceed-without-greenlight rule: the maintainer reviews + steers after the fact.

## D1 — Mint nothing; reuse the scheduling sector verbatim

A calendar/task is exactly what the `@jeswr/solid-federation-vocab` **scheduling
sector** (`sched:`, `https://w3id.org/jeswr/sectors/scheduling#`) already models: a
`sched:Task` (a `core:Activity`), a `sched:CalendarEvent` (a `core:Event`), grouped
by a `sched:Calendar`, made repeating by a `sched:RecurrenceRule`, annotated by a
`sched:Reminder`, with RSVP coded values in the sector's `AttendanceScheme`. So the
model reuses those terms and **mints no new IRI**. This keeps the Vikunja fork on
the federation's canonical spine rather than a second dialect, and makes the
deliverable's real value the **gap list** (D6) plus the cross-serialisation (D2).

## D2 — Cross-serialise every `sched:Task` as a shared `wf:Task` (the federation demo)

**The load-bearing decision.** A `sched:Task` written here ALSO carries the
published `@jeswr/solid-task-model` **`wf:Task`** shape on the **same `#it`
subject**. `buildSchedulingTask` first builds the `wf:Task` store (via task-model's
`buildTask`), then layers the `sched:` triples on top; both subject IRIs are
`${resourceUrl}#it` (a cross-app test asserts `schedulingTaskSubject === taskSubject`).
The payoff: a task written by a Vikunja→Solid fork surfaces **"assigned to me" in
the Pod Manager / solid-issues** with no adapter — it is the first external app on
the shared task model, the concrete demonstration of the data-federation vision.

The field mapping (scheduling → the shared `wf:Task`):

| Scheduling field | wf:Task field | Predicate |
|---|---|---|
| `summary` | `title` | `dct:title` |
| `description` | `description` | `wf:description` (+ `dct:description`) |
| `completed` | `state` (open/closed) | `rdf:type wf:Open`/`wf:Closed` |
| `completedAt` | `endedAt` | `prov:endedAtTime` |
| `organizer` | `creator` | `dct:creator` |
| **`assignee`** | **`assignee`** | **`wf:assignee`** (the federation edge) |
| `calendar` | `project` | `wf:tracker` |
| `dueTime` | `dueDate` | `wf:dateDue` |
| `priority` | `priority` | `schema:priority` |
| `position` | `rank` | `schema:position` |
| `parent` / `blockedBy` / `relatesTo` / `duplicateOf` | same | `dct:isPartOf`/`dct:requires`/`dct:relation`/`dct:isReplacedBy` |

`buildTask` owns the untrusted http(s) filtering of the WebID/relation IRIs and the
`wf:Open`/`wf:Closed` + `prov:endedAtTime` state management, so this package never
re-implements that security-sensitive logic. The task-model dependency is pinned by
git SHA (`git+https://github.com/jeswr/solid-task-model.git#9d9c2ae…`) so a
dependency bump is an intentional, reviewable diff.

### Why `assignee` lives only on the `wf:Task`

The scheduling sector has **no task-assignee term** — `sched:organizer` is who set
the entry up, and `sched:attendee` is event-participation, neither of which is "the
agent this to-do is assigned to". So the assignee is carried by the shared
`wf:assignee` only. That is not a workaround: `wf:assignee` **is** the federation's
"assigned to me" predicate, so carrying the assignee there is exactly right. The
sector's lack of a native task-assignee term is noted under the task-relations
proposal (D6.3).

## D3 — Native `sched:` fields kept, even where they duplicate `wf:`

`summary`/`dueTime`/`completed` are written to BOTH vocabularies (e.g. `sched:summary`
AND `dct:title`). This is intentional dual-encoding, not redundancy: a **native
scheduling** consumer (a Calendar app that only knows `sched:`) reads the document
correctly WITHOUT the `wf:` overlay, and a **federation** consumer (the Pod Manager)
reads the `wf:` view. Neither is second-class. On read, `parseSchedulingTask` reads
the `sched:` copies for the native fields and pulls the wf-only federation fields
(assignee/priority/position/relations) back through task-model's `parseTask`, so a
round-trip agrees byte-for-byte with what the Pod Manager sees.

## D4 — The reified recurrence + reminder nodes; typed datatypes

A repeating task (Vikunja has real repeating tasks) is a `sched:RecurrenceRule`
node (`<#recurrence>`) linked via `sched:recurrence`; reminders are `sched:Reminder`
nodes (`<#reminderN>`) linked via `sched:hasReminder`. `sched:interval`/`sched:count`
are written as `xsd:positiveInteger` (via a datatype tuple, not `LiteralFrom.integer`
which would type them `xsd:integer` and fail the sector's `xsd:positiveInteger`
range), and `sched:triggerOffset` as `xsd:duration`. The build validates before
writing: an interval/count that is not a positive integer is dropped, an unknown
frequency drops the whole recurrence, a `triggerOffset` that is not a well-formed
ISO-8601 duration is dropped.

## D5 — Owner-private schedules; a focused, additive SHACL shape

A person's schedule is behavioural data (what you're doing, when, with whom), so
every task/calendar is owner-private: the `buildOwnerOnlyAcl` / `writeOwnerOnlyAcl`
helper (shared design with `@jeswr/solid-listening` / `@jeswr/solid-health-diary`)
writes a fail-closed owner-only ACL — no public / `acl:agentClass` grant, throwing
on a non-http(s) owner WebID or a fragment/query-bearing resource URL.

The shipped `scheduling.shacl.ttl` is a DOWNSTREAM, additive profile checking the
task/calendar wire contract (a `sched:Task` MUST have a `sched:summary`; a
`sched:RecurrenceRule` MUST have a known frequency; optional fields validate their
datatype when present). It deliberately does **not** constrain the co-located
`wf:Task` triples — the `@jeswr/solid-task-model` shape governs those, and each
vocabulary validates against its own shape (open-world: extra `wf:`/`dct:` triples
never fail this profile).

## D6 — Untrusted-input hardening

Pod data is untrusted. Every optional read is `tryRead`-guarded so a malformed
foreign literal (a wrong-datatype value, a non-date `xsd:dateTime`) drops the field
rather than aborting the parse; every IRI-valued field (organizer, calendar, and —
via task-model — assignee and the relation IRIs) passes through the http(s)-only
filter so a hostile `javascript:`/`data:` value is never surfaced;
`sched:interval`/`sched:count` are dropped unless positive integers; a
`triggerOffset` is dropped unless a well-formed `xsd:duration`; a recurrence with an
unknown frequency is dropped whole. `parseSchedulingTask` returns `undefined` for
anything that is not a `sched:Task` with a summary.

---

## The scheduling-sector extension needs (fedcon:Proposal candidates)

Modelling real Vikunja task/kanban data surfaced five decisions/gaps in the
scheduling sector. Each is written up as a `fedcon:Proposal` **candidate** in
[`scheduling.proposals.ttl`](./scheduling.proposals.ttl) — NOT filed to any
registry, and the sector `.ttl` is **never edited here**. Real fork usage drives the
sector's evolution through the registry contribution lifecycle
(`fedcon:` = `https://jeswr.org/fedcon#`).

### 1. Kanban board / bucket / position (ordering)

**Gap.** Vikunja's core view is a kanban board: a Calendar/project shows ordered
**buckets** (columns), each holding tasks in an explicit user-set **order**. The
sector has `sched:inCalendar` but no board, bucket, or position. Deriving order from
`dueTime`/`priority` is wrong (a user drags cards freely). This package carries the
ordinal via the shared `wf:Task`'s `schema:position`, but a native scheduling
consumer sees nothing.

**Proposal (Extend).** `sched:Bucket` (⊑ `sched:Calendar`), `sched:inBucket`
(task → bucket), `sched:boardPosition` (an `xsd:integer` ordinal).

### 2. First-class task labels (reuse vs mint)

**Gap.** Vikunja tasks carry coloured **labels**. The sector has no label term.

**Decision + open question.** This package **reuses `dct:subject`** as free-text
label literals (reuse-before-mint — federates cleanly with any `dct:subject`
consumer). The sector should pick ONE alignment rather than let producers diverge:
(a) endorse `dct:subject`, (b) recommend a managed `skos:Concept` scheme (shared
controlled values across a federation), or (c) mint `sched:label` with a colour/name
shape (the string form drops Vikunja's hex colour).

### 3. Task relations (subtask / blocks / precedes / duplicate)

**Gap.** Vikunja has a rich relation-kind set. The `wf:`/`dct:` model this package
cross-serialises to covers parent/blocked-by/relates-to/duplicate-of (which is why
they federate), but (a) the **scheduling sector itself declares no task-relation
term** — a native consumer sees none without the `wf:` overlay; and (b) neither
model has `precedes`/`follows` (temporal sequencing, distinct from blocking).

**Proposal (Extend).** The sector adopt the `wf:`/`dct:` relation set as its task-
relation alignment, and add `sched:precedes` / `sched:follows`.

### 4. Percent-done (partial completion)

**Gap.** Vikunja tracks `percent_done` (0..100). The sector has only the boolean
`sched:completed` — it cannot express partial progress, and this package currently
**drops** percent-done rather than invent a term (mint-nothing).

**Proposal (Extend).** `sched:percentComplete` (a `[0,1]` `xsd:decimal`, or a 0..100
integer — decided at filing) on `sched:Task`, complementing `sched:completed`.

### 5. Reconcile `sched:CalendarEvent` with the dav-bridge's `schema:Event`

**Gap.** `@jeswr/solid-dav-bridge` imports CalDAV events as `schema:Event` (+ `ical:`
for fields schema.org lacks), while the scheduling sector models the same concept as
`sched:CalendarEvent` (a `core:Event`, aligned to `schema:Event` + iCalendar in the
sector's `scheduling-alignments.ttl`). Two producers, two class IRIs for one
concept — a **federation-visible decision** the registry must settle, not a silent
per-package choice. (This package models tasks, not events, so it does not itself
write CalendarEvents — but it flags the decision.)

**Proposal (Reconcile).** Recommendation: `sched:CalendarEvent` is canonical (it
carries the gUFO rooting + the alignment already), and the dav-bridge grows a
`sched:CalendarEvent` projection alongside its `schema:Event` output. Alternatives:
`schema:Event` canonical with `sched:CalendarEvent` as an alignment/subclass; or both
stand with a required `owl:equivalentClass` / a registry materialisation rule.
