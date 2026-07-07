// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/solid-scheduling` — the scheduling-sector **calendar / task** RDF model
 * (the data model a [Vikunja](https://vikunja.io)→Solid fork writes to a pod).
 *
 * **Mints nothing.** A task is a `sched:Task` and a calendar a `sched:Calendar`
 * (from the `@jeswr/solid-federation-vocab` scheduling sector), with repeats via a
 * `sched:RecurrenceRule` and alarms via a `sched:Reminder`; the model reuses those
 * terms verbatim. Where a real Vikunja task needs a field the sector LACKS (kanban
 * bucket/board position, first-class labels, task-relations, percent-done), the
 * gap is written up as a `fedcon:Proposal` CANDIDATE (`scheduling.proposals.ttl` /
 * `DECISIONS.md`) rather than edited into the sector — real fork usage drives the
 * sector's evolution.
 *
 * **Cross-sector by construction (the federation demo).** A `sched:Task` written
 * here ALSO carries the shared **`wf:Task`** shape from the published
 * `@jeswr/solid-task-model` on the SAME subject, so a Vikunja task surfaces
 * "assigned to me" in the Pod Manager / solid-issues — the first external app on
 * the shared task model. See {@link ./task.ts}.
 *
 * **Browser-safe root.** This entry point pulls in NO `node:*` built-ins — the
 * vocab + the typed model + the owner-only ACL BUILDER run in the browser. The
 * shape/proposals file readers live behind the `@jeswr/solid-scheduling/shape`
 * subpath ONLY (they `readFileSync` the shipped `.ttl`s, so they are Node-only).
 *
 * @packageDocumentation
 */
export { aclUrlFor, buildOwnerOnlyAcl, writeOwnerOnlyAcl, } from "./acl.js";
export { buildCalendar, Calendar, calendarStoreToTurtle, calendarSubject, parseCalendar, parseCalendarTtl, serializeCalendar, } from "./calendar.js";
export { httpIriOrUndefined, isHttpIri } from "./iri.js";
export { buildSchedulingTask, parseSchedulingTask, parseSchedulingTaskTtl, RecurrenceRule, Reminder, reminderIri, SchedulingTask, schedulingNodeIris, schedulingTaskSubject, serializeSchedulingTask, storeToTurtle, } from "./task.js";
// NOTE: the Node-only shape/proposals readers (schedulingShapeTtl,
// schedulingProposalsTtl, *_PATH) are intentionally NOT re-exported here — they
// statically import node:fs/node:url. Import them from the dedicated
// `@jeswr/solid-scheduling/shape` subpath instead.
export { ACL, ATTENDANCE_ACCEPTED, ATTENDANCE_CLASS, ATTENDANCE_DECLINED, ATTENDANCE_NEEDS_ACTION, ATTENDANCE_SCHEME, ATTENDANCE_STATUS, ATTENDANCE_STATUS_CLASS, ATTENDANCE_TENTATIVE, acl, CALENDAR_CLASS, CALENDAR_EVENT_CLASS, CORE, core, DCT, DCT_SUBJECT, dct, FOAF, PREFIXES, RDF, RDF_TYPE, RDFS, RECURRENCE_RULE_CLASS, REMINDER_CLASS, rdf, SCHED, SCHED_ATTENDEE, SCHED_COMPLETED, SCHED_COMPLETED_AT, SCHED_COUNT, SCHED_DESCRIPTION, SCHED_DUE_TIME, SCHED_END_TIME, SCHED_EVENT_LOCATION, SCHED_FREQUENCY, SCHED_HAS_REMINDER, SCHED_IN_CALENDAR, SCHED_INTERVAL, SCHED_ORGANIZER, SCHED_RECURRENCE, SCHED_START_TIME, SCHED_SUMMARY, SCHED_TRIGGER_OFFSET, SCHED_TRIGGER_TIME, SCHED_UNTIL, SKOS, sched, skos, TASK_CLASS, XSD, XSD_DURATION, XSD_POSITIVE_INTEGER, xsd, } from "./vocab.js";
//# sourceMappingURL=index.js.map