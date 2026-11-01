/**
 * Vocabulary IRIs for the scheduling model (the data model a
 * [Vikunja](https://vikunja.io)→Solid fork writes to a pod).
 *
 * **This package MINTS NOTHING of its own.** A calendar/task is exactly what the
 * `@jeswr/solid-federation-vocab` **scheduling sector**
 * (`sched:`, `https://w3id.org/jeswr/sectors/scheduling#`) already models: a
 * `sched:Task` (a `core:Activity`), a `sched:CalendarEvent` (a `core:Event`),
 * grouped by a `sched:Calendar`, made repeating by a `sched:RecurrenceRule`, and
 * annotated by a `sched:Reminder`. So the model REUSES the sector's terms
 * verbatim. Where real Vikunja task data needs a field the sector LACKS (kanban
 * bucket/board position, first-class labels, task-relations, percent-done) the
 * gap is written up as a `fedcon:Proposal` CANDIDATE (see
 * `scheduling.proposals.ttl` / `DECISIONS.md`) — the sector `.ttl` is NEVER edited
 * here. Real fork usage drives sector evolution.
 *
 * **The federation cross-serialisation (load-bearing).** A `sched:Task` written to
 * a pod ALSO carries the shared **`wf:Task`** shape from the published
 * `@jeswr/solid-task-model` on the SAME subject, so a Vikunja task surfaces
 * "assigned to me" in the Pod Manager / solid-issues. Those `wf:`/`dct:`/`schema:`
 * /`prov:` terms are owned by `@jeswr/solid-task-model` (see `./task.ts`); this
 * module only declares the `sched:`/`core:` spine.
 *
 * **Reused terms (nothing minted here):**
 * - **`sched:` — the scheduling sector** (`https://w3id.org/jeswr/sectors/scheduling#`):
 *   the classes `sched:Task`, `sched:CalendarEvent`, `sched:Calendar`,
 *   `sched:RecurrenceRule`, `sched:Reminder`, `sched:AttendanceStatus`; the
 *   properties `sched:summary`, `sched:description`, `sched:startTime`,
 *   `sched:endTime`, `sched:dueTime`, `sched:completed`, `sched:completedAt`,
 *   `sched:organizer`, `sched:inCalendar`, `sched:recurrence`, `sched:frequency`,
 *   `sched:interval`, `sched:count`, `sched:until`, `sched:hasReminder`,
 *   `sched:triggerTime`, `sched:triggerOffset`; and the RSVP coded values.
 * - **`core:` — the gUFO-rebased Solid Core** (`https://w3id.org/jeswr/core#`): the
 *   spine `sched:*` sub-properties root in (referenced by the shape).
 * - **`dct:` — Dublin Core Terms**: `dct:subject` (task labels — reuse-before-mint,
 *   see `DECISIONS.md`).
 * - **`skos:` — SKOS**: the RSVP `sched:AttendanceScheme` concept scheme root.
 * - **`acl:` / `rdf:` / `foaf:` / `xsd:`** — WAC (the owner-only ACL helper),
 *   `rdf:type`, `foaf:Agent` (ACL negative tests), and the XSD datatypes.
 *
 * **PERSISTENT-ID NOTE.** The `sched:`/`core:` IRIs are historically minted under
 * `w3id.org/jeswr` — LEGACY identifiers that re-mint to the maintainer's live
 * `jeswr.org` persistent-ID layer per the staged migration (charter prose only;
 * minted IRIs in code/specs are not hand-edited). `fedcon:`
 * (`https://jeswr.org/fedcon#`) is already `jeswr.org`-rooted. This package mints
 * no NEW persistent identifier.
 */
/** The scheduling sector namespace — the canonical home of the terms this model reuses. */
export declare const SCHED = "https://w3id.org/jeswr/sectors/scheduling#";
/** The gUFO-rebased Solid Core ontology namespace (`@jeswr/solid-federation-vocab`). */
export declare const CORE = "https://w3id.org/jeswr/core#";
/** Dublin Core Terms — `dct:subject` (labels). */
export declare const DCT = "http://purl.org/dc/terms/";
/** SKOS — the RSVP coded-value scheme root. */
export declare const SKOS = "http://www.w3.org/2004/02/skos/core#";
/** FOAF — referenced by the ACL negative tests (`foaf:Agent`). */
export declare const FOAF = "http://xmlns.com/foaf/0.1/";
/** WAC — the owner-only ACL helper (`acl:Authorization`, `acl:agent`, `acl:mode`, …). */
export declare const ACL = "http://www.w3.org/ns/auth/acl#";
/** RDF — `rdf:type`. */
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema. */
export declare const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — `xsd:dateTime`, `xsd:boolean`, `xsd:positiveInteger`, `xsd:duration`. */
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `sched:` term IRI. */
export declare const sched: (local: string) => string;
/** Build a `core:` term IRI. */
export declare const core: (local: string) => string;
/** Build a `dct:` term IRI. */
export declare const dct: (local: string) => string;
/** Build a `skos:` term IRI. */
export declare const skos: (local: string) => string;
/** Build an `acl:` term IRI. */
export declare const acl: (local: string) => string;
/** Build an `rdf:` term IRI. */
export declare const rdf: (local: string) => string;
/** Build an `xsd:` term IRI. */
export declare const xsd: (local: string) => string;
/** `sched:Task` — a to-do item (a `core:Activity`); the Vikunja task. */
export declare const TASK_CLASS: string;
/** `sched:CalendarEvent` — a scheduled occurrence (a `core:Event`). */
export declare const CALENDAR_EVENT_CLASS: string;
/** `sched:Calendar` — a named collection of entries (the Vikunja project/list). */
export declare const CALENDAR_CLASS: string;
/** `sched:RecurrenceRule` — a specification that makes an entry repeat. */
export declare const RECURRENCE_RULE_CLASS: string;
/** `sched:Reminder` — an alarm attached to an entry. */
export declare const REMINDER_CLASS: string;
/** `sched:Attendance` — the reified RSVP relator. */
export declare const ATTENDANCE_CLASS: string;
/** `sched:AttendanceStatus` — a controlled-vocabulary RSVP value. */
export declare const ATTENDANCE_STATUS_CLASS: string;
/** `sched:summary` — short title/subject of a calendar entry. */
export declare const SCHED_SUMMARY: string;
/** `sched:description` — longer free-text description of an entry. */
export declare const SCHED_DESCRIPTION: string;
/** `sched:startTime` — clock start of an entry (xsd:dateTime). */
export declare const SCHED_START_TIME: string;
/** `sched:endTime` — clock end of an entry (xsd:dateTime). */
export declare const SCHED_END_TIME: string;
/** `sched:dueTime` — when a task is due (xsd:dateTime). */
export declare const SCHED_DUE_TIME: string;
/** `sched:completed` — whether a task has been completed (xsd:boolean). */
export declare const SCHED_COMPLETED: string;
/** `sched:completedAt` — when a task was completed (xsd:dateTime). */
export declare const SCHED_COMPLETED_AT: string;
/** `sched:organizer` — the agent that organises/owns an entry (→ a WebID). */
export declare const SCHED_ORGANIZER: string;
/** `sched:inCalendar` — the calendar an entry belongs to (→ a `sched:Calendar`). */
export declare const SCHED_IN_CALENDAR: string;
/** `sched:recurrence` — the recurrence rule that makes an entry repeat. */
export declare const SCHED_RECURRENCE: string;
/** `sched:frequency` — recurrence frequency (DAILY/WEEKLY/MONTHLY/YEARLY). */
export declare const SCHED_FREQUENCY: string;
/** `sched:interval` — how many frequency units between occurrences (xsd:positiveInteger). */
export declare const SCHED_INTERVAL: string;
/** `sched:count` — total number of occurrences (xsd:positiveInteger). */
export declare const SCHED_COUNT: string;
/** `sched:until` — last date/time the recurrence may produce an occurrence (xsd:dateTime). */
export declare const SCHED_UNTIL: string;
/** `sched:hasReminder` — attaches a reminder/alarm to an entry (→ a `sched:Reminder`). */
export declare const SCHED_HAS_REMINDER: string;
/** `sched:triggerTime` — absolute time a reminder fires (xsd:dateTime). */
export declare const SCHED_TRIGGER_TIME: string;
/** `sched:triggerOffset` — relative offset a reminder fires at (xsd:duration). */
export declare const SCHED_TRIGGER_OFFSET: string;
/** `sched:eventLocation` — the venue of an event (→ a `core:Place`). */
export declare const SCHED_EVENT_LOCATION: string;
/** `sched:attendee` — an agent invited to / participating in an event (→ a WebID). */
export declare const SCHED_ATTENDEE: string;
/** `dct:subject` — a task label (reuse-before-mint; see `DECISIONS.md`). */
export declare const DCT_SUBJECT: string;
/** The `rdf:type` predicate IRI (convenience). */
export declare const RDF_TYPE: string;
/** `xsd:positiveInteger` — the datatype for `sched:interval`/`sched:count` (via a datatype tuple). */
export declare const XSD_POSITIVE_INTEGER: string;
/** `xsd:duration` — the datatype for `sched:triggerOffset` (via a datatype tuple). */
export declare const XSD_DURATION: string;
/** `sched:AttendanceScheme` — the canonical scheme of RSVP status values. */
export declare const ATTENDANCE_SCHEME: string;
/** `sched:Accepted` — the attendee accepted (iCalendar PARTSTAT=ACCEPTED). */
export declare const ATTENDANCE_ACCEPTED: string;
/** `sched:Declined` — the attendee declined (iCalendar PARTSTAT=DECLINED). */
export declare const ATTENDANCE_DECLINED: string;
/** `sched:Tentative` — tentatively accepted (iCalendar PARTSTAT=TENTATIVE). */
export declare const ATTENDANCE_TENTATIVE: string;
/** `sched:NeedsAction` — awaiting response (iCalendar PARTSTAT=NEEDS-ACTION, the default). */
export declare const ATTENDANCE_NEEDS_ACTION: string;
/**
 * The four canonical RSVP status IRIs, keyed by a stable lowercase token — the
 * controlled vocabulary a fork maps its own status onto. Frozen so a consumer
 * cannot mutate the shared table.
 */
export declare const ATTENDANCE_STATUS: Readonly<Record<string, string>>;
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export declare const PREFIXES: {
    readonly sched: "https://w3id.org/jeswr/sectors/scheduling#";
    readonly core: "https://w3id.org/jeswr/core#";
    readonly dct: "http://purl.org/dc/terms/";
    readonly skos: "http://www.w3.org/2004/02/skos/core#";
    readonly rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    readonly xsd: "http://www.w3.org/2001/XMLSchema#";
};
//# sourceMappingURL=vocab.d.ts.map