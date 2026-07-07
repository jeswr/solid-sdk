// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
export const SCHED = "https://w3id.org/jeswr/sectors/scheduling#";
/** The gUFO-rebased Solid Core ontology namespace (`@jeswr/solid-federation-vocab`). */
export const CORE = "https://w3id.org/jeswr/core#";
/** Dublin Core Terms — `dct:subject` (labels). */
export const DCT = "http://purl.org/dc/terms/";
/** SKOS — the RSVP coded-value scheme root. */
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
/** FOAF — referenced by the ACL negative tests (`foaf:Agent`). */
export const FOAF = "http://xmlns.com/foaf/0.1/";
/** WAC — the owner-only ACL helper (`acl:Authorization`, `acl:agent`, `acl:mode`, …). */
export const ACL = "http://www.w3.org/ns/auth/acl#";
/** RDF — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — `xsd:dateTime`, `xsd:boolean`, `xsd:positiveInteger`, `xsd:duration`. */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `sched:` term IRI. */
export const sched = (local) => `${SCHED}${local}`;
/** Build a `core:` term IRI. */
export const core = (local) => `${CORE}${local}`;
/** Build a `dct:` term IRI. */
export const dct = (local) => `${DCT}${local}`;
/** Build a `skos:` term IRI. */
export const skos = (local) => `${SKOS}${local}`;
/** Build an `acl:` term IRI. */
export const acl = (local) => `${ACL}${local}`;
/** Build an `rdf:` term IRI. */
export const rdf = (local) => `${RDF}${local}`;
/** Build an `xsd:` term IRI. */
export const xsd = (local) => `${XSD}${local}`;
// --- Classes (all reused from the scheduling sector) ---
/** `sched:Task` — a to-do item (a `core:Activity`); the Vikunja task. */
export const TASK_CLASS = sched("Task");
/** `sched:CalendarEvent` — a scheduled occurrence (a `core:Event`). */
export const CALENDAR_EVENT_CLASS = sched("CalendarEvent");
/** `sched:Calendar` — a named collection of entries (the Vikunja project/list). */
export const CALENDAR_CLASS = sched("Calendar");
/** `sched:RecurrenceRule` — a specification that makes an entry repeat. */
export const RECURRENCE_RULE_CLASS = sched("RecurrenceRule");
/** `sched:Reminder` — an alarm attached to an entry. */
export const REMINDER_CLASS = sched("Reminder");
/** `sched:Attendance` — the reified RSVP relator. */
export const ATTENDANCE_CLASS = sched("Attendance");
/** `sched:AttendanceStatus` — a controlled-vocabulary RSVP value. */
export const ATTENDANCE_STATUS_CLASS = sched("AttendanceStatus");
// --- Reused predicates (nothing minted) ---
/** `sched:summary` — short title/subject of a calendar entry. */
export const SCHED_SUMMARY = sched("summary");
/** `sched:description` — longer free-text description of an entry. */
export const SCHED_DESCRIPTION = sched("description");
/** `sched:startTime` — clock start of an entry (xsd:dateTime). */
export const SCHED_START_TIME = sched("startTime");
/** `sched:endTime` — clock end of an entry (xsd:dateTime). */
export const SCHED_END_TIME = sched("endTime");
/** `sched:dueTime` — when a task is due (xsd:dateTime). */
export const SCHED_DUE_TIME = sched("dueTime");
/** `sched:completed` — whether a task has been completed (xsd:boolean). */
export const SCHED_COMPLETED = sched("completed");
/** `sched:completedAt` — when a task was completed (xsd:dateTime). */
export const SCHED_COMPLETED_AT = sched("completedAt");
/** `sched:organizer` — the agent that organises/owns an entry (→ a WebID). */
export const SCHED_ORGANIZER = sched("organizer");
/** `sched:inCalendar` — the calendar an entry belongs to (→ a `sched:Calendar`). */
export const SCHED_IN_CALENDAR = sched("inCalendar");
/** `sched:recurrence` — the recurrence rule that makes an entry repeat. */
export const SCHED_RECURRENCE = sched("recurrence");
/** `sched:frequency` — recurrence frequency (DAILY/WEEKLY/MONTHLY/YEARLY). */
export const SCHED_FREQUENCY = sched("frequency");
/** `sched:interval` — how many frequency units between occurrences (xsd:positiveInteger). */
export const SCHED_INTERVAL = sched("interval");
/** `sched:count` — total number of occurrences (xsd:positiveInteger). */
export const SCHED_COUNT = sched("count");
/** `sched:until` — last date/time the recurrence may produce an occurrence (xsd:dateTime). */
export const SCHED_UNTIL = sched("until");
/** `sched:hasReminder` — attaches a reminder/alarm to an entry (→ a `sched:Reminder`). */
export const SCHED_HAS_REMINDER = sched("hasReminder");
/** `sched:triggerTime` — absolute time a reminder fires (xsd:dateTime). */
export const SCHED_TRIGGER_TIME = sched("triggerTime");
/** `sched:triggerOffset` — relative offset a reminder fires at (xsd:duration). */
export const SCHED_TRIGGER_OFFSET = sched("triggerOffset");
/** `sched:eventLocation` — the venue of an event (→ a `core:Place`). */
export const SCHED_EVENT_LOCATION = sched("eventLocation");
/** `sched:attendee` — an agent invited to / participating in an event (→ a WebID). */
export const SCHED_ATTENDEE = sched("attendee");
/** `dct:subject` — a task label (reuse-before-mint; see `DECISIONS.md`). */
export const DCT_SUBJECT = dct("subject");
/** The `rdf:type` predicate IRI (convenience). */
export const RDF_TYPE = rdf("type");
/** `xsd:positiveInteger` — the datatype for `sched:interval`/`sched:count` (via a datatype tuple). */
export const XSD_POSITIVE_INTEGER = xsd("positiveInteger");
/** `xsd:duration` — the datatype for `sched:triggerOffset` (via a datatype tuple). */
export const XSD_DURATION = xsd("duration");
// --- RSVP coded values (reused from the scheduling sector's AttendanceScheme) ---
/** `sched:AttendanceScheme` — the canonical scheme of RSVP status values. */
export const ATTENDANCE_SCHEME = sched("AttendanceScheme");
/** `sched:Accepted` — the attendee accepted (iCalendar PARTSTAT=ACCEPTED). */
export const ATTENDANCE_ACCEPTED = sched("Accepted");
/** `sched:Declined` — the attendee declined (iCalendar PARTSTAT=DECLINED). */
export const ATTENDANCE_DECLINED = sched("Declined");
/** `sched:Tentative` — tentatively accepted (iCalendar PARTSTAT=TENTATIVE). */
export const ATTENDANCE_TENTATIVE = sched("Tentative");
/** `sched:NeedsAction` — awaiting response (iCalendar PARTSTAT=NEEDS-ACTION, the default). */
export const ATTENDANCE_NEEDS_ACTION = sched("NeedsAction");
/**
 * The four canonical RSVP status IRIs, keyed by a stable lowercase token — the
 * controlled vocabulary a fork maps its own status onto. Frozen so a consumer
 * cannot mutate the shared table.
 */
export const ATTENDANCE_STATUS = Object.freeze({
    accepted: ATTENDANCE_ACCEPTED,
    declined: ATTENDANCE_DECLINED,
    tentative: ATTENDANCE_TENTATIVE,
    "needs-action": ATTENDANCE_NEEDS_ACTION,
});
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export const PREFIXES = {
    sched: SCHED,
    core: CORE,
    dct: DCT,
    skos: SKOS,
    rdf: RDF,
    xsd: XSD,
};
//# sourceMappingURL=vocab.js.map