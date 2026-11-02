// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Claude Opus 5.5 (Phase S generated flip: build/parse over ./generated/)
/**
 * The scheduling **Task** model — the FACADE over the model GENERATED from this
 * package's scheduling profile (`./generated/`, via `@jeswr/federation-codegen` →
 * the audited `@jeswr/model-runtime`). The generated composite owns the `sched:Task`
 * core and its `sched:RecurrenceRule` node: datatype, cardinality, http(s) and
 * enum guards, and the fail-closed required `sched:summary` / `sched:frequency`.
 * This file keeps the package's public surface and adds what SHACL cannot express:
 *
 *  1. **Cross-sector by construction (D2).** Every task is ALSO a `wf:Task` from
 *     `@jeswr/solid-task-model` on the same `#it` subject, built by its `buildTask`
 *     (federation edge: "assigned to me" in the Pod Manager) and read back through
 *     `parseTask`, whose IRIs are http(s)-filtered here.
 *  2. **Unified completion.** `completed` / `completedAt` / `wf:Open|Closed` /
 *     `prov:endedAtTime` are one notion: a timestamp implies completion, an explicit
 *     `completed: false` wins, and a closed task without a timestamp stamps now.
 *  3. **Labels and reminders.** `dct:subject` labels and any number of
 *     `sched:hasReminder` nodes (`#reminder0`, …) go through the typed views in
 *     `./nodes.ts`; a composite link projects exactly one child, so reminders are not
 *     generated.
 *  4. **Frequency normalisation.** A frequency is trimmed and uppercased before the
 *     generated enum sees it; a recurrence with no known frequency is dropped whole.
 */

import { sanitizeText } from "@jeswr/model-runtime";
import {
  buildTask,
  parseTask,
  type TaskData,
  type TaskPriority,
} from "@jeswr/solid-task-model/task";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { entities, type TaskData as GeneratedTaskData } from "./generated/model.js";
import { assertResourceUrl, httpIriOrUndefined, isResourceUrl } from "./iri.js";
import { Reminder, SchedulingTask } from "./nodes.js";
import { PREFIXES } from "./vocab.js";

// Re-export the shared priority type so a consumer needn't import task-model too.
export type { TaskPriority } from "@jeswr/solid-task-model/task";
// Re-exported so the `.` entry point keeps exposing the untrusted-input filter.
export { isHttpIri } from "./iri.js";
export { RecurrenceRule, Reminder, SchedulingTask } from "./nodes.js";

const generatedTask = entities.Task;

/** A recurrence rule (a repeating task — Vikunja's real repeating tasks). */
export interface RecurrenceData {
  /** `sched:frequency` — DAILY / WEEKLY / MONTHLY / YEARLY (uppercased on write). */
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  /** `sched:interval` — every N frequency units (a positive integer). */
  interval?: number;
  /** `sched:count` — total number of occurrences (a positive integer). */
  count?: number;
  /** `sched:until` — the last date/time the rule may produce an occurrence. */
  until?: Date;
}

/** A reminder/alarm attached to a task. */
export interface ReminderData {
  /** `sched:triggerTime` — the absolute time the reminder fires. */
  triggerTime?: Date;
  /**
   * `sched:triggerOffset` — a relative ISO-8601 duration offset from the entry's
   * start (e.g. `-PT15M` for 15 minutes before). Dropped if not a well-formed
   * `xsd:duration`.
   */
  triggerOffset?: string;
}

/**
 * A scheduling task as a plain, serialisable object — the shape a Vikunja→Solid
 * fork's importer works with. `summary` is the one load-bearing field; everything
 * else is optional. The federation fields (`assignee`, `priority`, `position`,
 * `parent`, `blockedBy`, `relatesTo`, `duplicateOf`) round-trip through the shared
 * `wf:Task` shape so they read identically in the Pod Manager / solid-issues.
 */
export interface SchedulingTaskData {
  /** `sched:summary` (+ `dct:title` on the `wf:Task`) — the title; the one required field. */
  summary: string;
  /** `sched:description` (+ `wf:description`) — the body. */
  description?: string;
  /** `sched:startTime` — clock start. */
  startTime?: Date;
  /** `sched:dueTime` (+ `wf:dateDue`) — when the task is due. */
  dueTime?: Date;
  /** `sched:completed` (+ `wf:Open`/`wf:Closed`) — whether the task is done. */
  completed?: boolean;
  /**
   * `sched:completedAt` (+ `prov:endedAtTime`) — completion time. A valid value
   * is preserved and IMPLIES completion (the task is treated as closed) unless
   * `completed` is an explicit `false`, which drops it. When a task is closed but
   * no timestamp is supplied, it defaults to now. The same instant is written to
   * both the `sched:` graph and the `wf:Task` overlay, so they never diverge.
   */
  completedAt?: Date;
  /** `sched:organizer` (+ `dct:creator`) — the owner/organiser WebID. */
  organizer?: string;
  /**
   * `wf:assignee` — the assigned agent's WebID. **The federation edge**: this is
   * the predicate the Pod Manager reads for its "assigned to me" gate. The
   * scheduling sector has no task-assignee term (see `DECISIONS.md` / the
   * proposals), so this is carried via the shared `wf:Task` only.
   */
  assignee?: string;
  /** `sched:inCalendar` (+ `wf:tracker`) — the calendar / project the task belongs to. */
  calendar?: string;
  /** `schema:priority` (via `wf:Task`) — high / medium / low. */
  priority?: TaskPriority;
  /**
   * `schema:position` (via `wf:Task`) — the kanban bucket/board ORDER; lower sorts
   * first. Carried through the shared model because the scheduling sector has no
   * ordering term (a `fedcon:Proposal` gap — see `DECISIONS.md`).
   */
  position?: number;
  /**
   * `dct:subject` — free-text task labels. Reuse-before-mint: the sector has no
   * label term, so labels reuse `dct:subject` (see the proposals / `DECISIONS.md`).
   */
  labels?: string[];
  /** `dct:isPartOf` (via `wf:Task`) — the parent task (this is a subtask of it). */
  parent?: string;
  /** `dct:requires` (via `wf:Task`) — tasks that must be done first (blocked by). */
  blockedBy?: string[];
  /** `dct:relation` (via `wf:Task`) — non-blocking relates-to links. */
  relatesTo?: string[];
  /** `dct:isReplacedBy` (via `wf:Task`) — the canonical successor (duplicate-of). */
  duplicateOf?: string;
  /** `sched:recurrence` — a recurrence rule (repeating task). */
  recurrence?: RecurrenceData;
  /** `sched:hasReminder` — reminders/alarms. */
  reminders?: ReminderData[];
}

/** The conventional subject IRI for the task (`sched:Task` + `wf:Task`) at `resourceUrl`. */
export function schedulingTaskSubject(resourceUrl: string): string {
  return `${assertResourceUrl(resourceUrl)}#it`;
}

/** The conventional subject IRIs of the nodes in a task document. */
export function schedulingNodeIris(resourceUrl: string): {
  task: string;
  recurrence: string;
} {
  const url = assertResourceUrl(resourceUrl);
  return { task: `${url}#it`, recurrence: `${url}#recurrence` };
}

/** The conventional subject IRI of the i-th reminder in a task document. */
export function reminderIri(resourceUrl: string, index: number): string {
  return `${assertResourceUrl(resourceUrl)}#reminder${index}`;
}

/** Assign `target[key] = value` ONLY when `value` is defined. */
function setIfDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/** Run an untrusted read, returning `undefined` on ANY throw or an `Invalid Date`. */
function tryRead<T>(fn: () => T | undefined): T | undefined {
  try {
    const value = fn();
    if (value instanceof Date && Number.isNaN(value.getTime())) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** A VALID `Date`, else `undefined` (the runtime keeps a malformed literal as `Invalid Date`). */
function validDateOrUndefined(value: Date | undefined): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

/** A finite number, else `undefined` (`NaN`/`Infinity` have no valid `xsd:double` form here). */
function finiteOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The absolute http(s) members of an untrusted IRI list. */
function httpIris(values: readonly string[] | undefined): string[] {
  return (values ?? []).filter((v) => httpIriOrUndefined(v) !== undefined);
}

// A conservative XSD-1.1 `xsd:duration` matcher: an optional leading `-`, `P`,
// then at least one date and/or time component. Rejects the empty `P`, a lone
// `T`, and anything with stray characters — so an untrusted triggerOffset is
// validated before it is written as a typed literal. NB the WEEK form (`nW`) is
// deliberately NOT accepted: XSD 1.1 `xsd:duration` does not permit it, so a
// `P1W` value would be written as an invalid literal — dropped instead.
const ISO_DURATION =
  /^-?P(?=[\dYMDTH.S])(\d+Y)?(\d+M)?(\d+D)?(T(?=[\dHMS.])(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

/** A well-formed `xsd:duration` string (no week form), else `undefined`. */
function durationOrUndefined(value: string | undefined): string | undefined {
  return typeof value === "string" && ISO_DURATION.test(value) ? value : undefined;
}

const FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

/** A known frequency (trimmed, uppercased), else `undefined`. */
function normalizeFrequency(value: string | undefined): RecurrenceData["frequency"] | undefined {
  const v = (typeof value === "string" ? value : "").trim().toUpperCase();
  return FREQUENCIES.has(v) ? (v as RecurrenceData["frequency"]) : undefined;
}

/**
 * Project a {@link SchedulingTaskData} onto the shared `wf:Task` {@link TaskData}
 * shape — the SAME `#it` subject, so a Vikunja task also reads as a federated
 * `wf:Task` ("assigned to me" in the Pod Manager). `buildTask` owns the untrusted
 * http(s) filtering of the WebID/relation IRIs and the wf:Open/wf:Closed +
 * `prov:endedAtTime` state management.
 */
function toWfTaskData(
  data: SchedulingTaskData,
  closed: boolean,
  completedAt: Date | undefined,
): TaskData {
  const wf: TaskData = {
    title: data.summary,
    state: closed ? "closed" : "open",
  };
  setIfDefined(wf, "description", data.description);
  // Single source of truth for the completion timestamp (computed once in
  // buildSchedulingTask): the SAME value is written to prov:endedAtTime (here,
  // via buildTask) and to sched:completedAt, so the two graphs never diverge.
  setIfDefined(wf, "endedAt", completedAt);
  setIfDefined(wf, "creator", data.organizer);
  setIfDefined(wf, "assignee", data.assignee);
  setIfDefined(wf, "project", data.calendar);
  // Validated so an Invalid Date can't reach buildTask's LiteralFrom.dateTime.
  setIfDefined(wf, "dueDate", validDateOrUndefined(data.dueTime));
  setIfDefined(wf, "priority", data.priority);
  setIfDefined(wf, "rank", finiteOrUndefined(data.position));
  setIfDefined(wf, "parent", data.parent);
  setIfDefined(wf, "blockedBy", data.blockedBy);
  setIfDefined(wf, "relatesTo", data.relatesTo);
  setIfDefined(wf, "duplicateOf", data.duplicateOf);
  return wf;
}

/**
 * Build the RDF `Store` for a task: the shared `wf:Task` triples from `buildTask`,
 * then the generated `sched:Task` core (+ recurrence node) on the same `#it`
 * subject, then labels and reminders through the typed views. Invalid dates, non-
 * http(s) organizer/calendar IRIs and non-positive-integer interval/count are dropped
 * by the generated guards; a reminder with neither a valid trigger time nor a
 * well-formed `xsd:duration` offset is skipped.
 */
export function buildSchedulingTask(resourceUrl: string, data: SchedulingTaskData): Store {
  assertResourceUrl(resourceUrl);
  const explicitCompletedAt = validDateOrUndefined(data.completedAt);
  const closed =
    data.completed === true || (data.completed !== false && explicitCompletedAt !== undefined);
  // The ONE completion timestamp, written to BOTH graphs.
  const completedAt = closed ? (explicitCompletedAt ?? new Date()) : undefined;
  // The generated build strips control characters from text; apply the same runtime
  // sanitiser before buildTask so dct:title / wf:description match the sched: values.
  const text: SchedulingTaskData = {
    ...data,
    summary: typeof data.summary === "string" ? sanitizeText(data.summary) : data.summary,
    description:
      typeof data.description === "string" ? sanitizeText(data.description) : data.description,
  };
  const store = new Store([...buildTask(resourceUrl, toWfTaskData(text, closed, completedAt))]);

  let core: GeneratedTaskData = {
    summary: text.summary,
    description: text.description || undefined,
    startTime: data.startTime,
    dueTime: data.dueTime,
    completed: closed ? true : data.completed === false ? false : undefined,
    completedAt,
    organizer: data.organizer,
    calendar: data.calendar,
  };
  // Recurrence fields go in only with a known frequency, so no frequency-less rule
  // node is ever built.
  const frequency = normalizeFrequency(data.recurrence?.frequency);
  if (data.recurrence && frequency !== undefined) {
    const { interval, count, until } = data.recurrence;
    core = { ...core, frequency, interval, count, until };
  }
  for (const quad of generatedTask.build(resourceUrl, core)) store.add(quad);

  const task = new SchedulingTask(schedulingTaskSubject(resourceUrl), store, DataFactory);
  for (const label of data.labels ?? []) {
    const l = typeof label === "string" ? label.trim() : "";
    if (l) task.labels.add(l);
  }
  (data.reminders ?? []).forEach((r, i) => {
    const triggerTime = validDateOrUndefined(r.triggerTime);
    const triggerOffset = durationOrUndefined(r.triggerOffset);
    if (triggerTime === undefined && triggerOffset === undefined) return;
    const iri = reminderIri(resourceUrl, i);
    const rem = new Reminder(iri, store, DataFactory).mark();
    rem.triggerTime = triggerTime;
    rem.triggerOffset = triggerOffset;
    task.reminders.add(iri);
  });
  return store;
}

/** Serialise a `Store` to Turtle with the model's prefixes (pretty output). */
export function storeToTurtle(store: Store): Promise<string> {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/** Build + serialise a task to a Turtle document in one call. */
export function serializeSchedulingTask(
  resourceUrl: string,
  data: SchedulingTaskData,
): Promise<string> {
  return storeToTurtle(buildSchedulingTask(resourceUrl, data));
}

/** Read a {@link ReminderData} from a reminder node, or `undefined` if it carries nothing. */
function parseReminder(iri: string, dataset: DatasetCore): ReminderData | undefined {
  const rem = new Reminder(iri, dataset, DataFactory);
  const reminder: ReminderData = {};
  setIfDefined(
    reminder,
    "triggerTime",
    tryRead(() => rem.triggerTime),
  );
  setIfDefined(reminder, "triggerOffset", durationOrUndefined(tryRead(() => rem.triggerOffset)));
  return reminder.triggerTime === undefined && reminder.triggerOffset === undefined
    ? undefined
    : reminder;
}

/**
 * Read a {@link SchedulingTaskData} back from an RDF dataset (the inverse of
 * {@link buildSchedulingTask}). Returns `undefined` unless the generated model
 * recognises a `sched:Task` with one `sched:summary`. Malformed optional fields drop;
 * the federation fields are read through `parseTask` and http(s)-filtered.
 */
export function parseSchedulingTask(
  resourceUrl: string,
  dataset: DatasetCore,
): SchedulingTaskData | undefined {
  if (!isResourceUrl(resourceUrl)) return undefined;
  const core = generatedTask.parse(resourceUrl, dataset);
  if (core === undefined) return undefined;
  const data: SchedulingTaskData = { summary: core.summary };
  setIfDefined(data, "description", core.description);
  setIfDefined(data, "startTime", validDateOrUndefined(core.startTime));
  setIfDefined(data, "dueTime", validDateOrUndefined(core.dueTime));
  setIfDefined(data, "completed", core.completed);
  setIfDefined(data, "completedAt", validDateOrUndefined(core.completedAt));
  setIfDefined(data, "organizer", core.organizer);
  setIfDefined(data, "calendar", core.calendar);
  if (core.frequency !== undefined) {
    const rec: RecurrenceData = { frequency: core.frequency };
    setIfDefined(rec, "interval", core.interval);
    setIfDefined(rec, "count", core.count);
    setIfDefined(rec, "until", validDateOrUndefined(core.until));
    data.recurrence = rec;
  }

  const task = new SchedulingTask(schedulingTaskSubject(resourceUrl), dataset, DataFactory);
  const labels = (tryRead(() => [...task.labels]) ?? []).filter(
    (l): l is string => typeof l === "string" && l.trim().length > 0,
  );
  if (labels.length > 0) data.labels = labels;
  const reminders = httpIris(tryRead(() => [...task.reminders]))
    .map((iri) => parseReminder(iri, dataset))
    .filter((r): r is ReminderData => r !== undefined);
  if (reminders.length > 0) data.reminders = reminders;

  // parseTask filters IRIs only on build and throws on a wrong term kind, so the read
  // is tryRead-guarded and every IRI it returns is http(s)-filtered here.
  const wf = tryRead(() => parseTask(resourceUrl, dataset));
  if (wf !== undefined) {
    setIfDefined(data, "assignee", httpIriOrUndefined(wf.assignee));
    setIfDefined(data, "priority", wf.priority);
    setIfDefined(data, "position", finiteOrUndefined(wf.rank));
    setIfDefined(data, "parent", httpIriOrUndefined(wf.parent));
    const blockedBy = httpIris(wf.blockedBy);
    if (blockedBy.length > 0) data.blockedBy = blockedBy;
    const relatesTo = httpIris(wf.relatesTo);
    if (relatesTo.length > 0) data.relatesTo = relatesTo;
    setIfDefined(data, "duplicateOf", httpIriOrUndefined(wf.duplicateOf));
  }
  return data;
}

/**
 * Parse a fetched RDF document into {@link SchedulingTaskData}, via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite RDF parse seam). A missing/`null`
 * `contentType` is coalesced to `text/turtle`; the resource URL is the base IRI.
 */
export async function parseSchedulingTaskTtl(
  resourceUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<SchedulingTaskData | undefined> {
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, contentType ?? "text/turtle", { baseIRI: resourceUrl });
  return parseSchedulingTask(resourceUrl, dataset);
}
