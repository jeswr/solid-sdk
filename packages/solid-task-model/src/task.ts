// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The shared federated Task/Issue model — typed read/write accessors over a
 * single `wf:Task` resource.
 *
 * **One model, many apps.** Every suite app (the Pod Manager, solid-issues, the
 * pod-apps) reads and writes the SAME RDF here, so a task created in one app
 * shows up — title, status, assignee, due date and all — in another. The class
 * is `wf:Task`; state is `rdf:type wf:Open`/`wf:Closed`; metadata is Dublin Core;
 * the assignee is a `wf:assignee` WebID. See {@link ./vocab.ts} for the vocabulary
 * rationale (reused, dereferenceable terms only, per ADR-0013 + R9).
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s `OptionalFrom`/`OptionalAs`/`SetFrom` mappers on an
 * n3 `Store`, mirroring how solid-issues (`Issue` in `src/lib/issue.ts`) and the
 * Pod Manager (`IssueDoc` in `src/lib/issues.ts`) already do it. Serialisation is
 * `n3.Writer`; parsing of a fetched body is `@jeswr/fetch-rdf`'s `parseRdf`.
 */

import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { dct, PREFIXES, prov, rdf, schema, TASK_CLASS, WF_CLOSED, WF_OPEN, wf } from "./vocab.js";

/**
 * The lifecycle state of a task. The wire model is a binary open/closed
 * (`rdf:type wf:Open` / `wf:Closed`) so it federates cleanly: any consumer maps a
 * task to one of these two. An "in-progress" band is an app-local refinement
 * (carried as an extra producer-scoped `rdf:type` subclass) and is NOT part of
 * this shared model — a foreign consumer still sees `wf:Open` and is correct.
 */
export type TaskState = "open" | "closed";

/** Task priority. Optional; carried via `schema:priority` text for cross-app legibility. */
export type TaskPriority = "high" | "medium" | "low";

/** The known priority values, coarsest first. */
export const PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

/**
 * A federated task as a plain, serialisable object — the shape an app's UI works
 * with. Mirrors the union of the fields solid-issues and the Pod Manager already
 * read/write, so this is their common data model, not a third one.
 */
export interface TaskData {
  /** `dct:title` — the one required field. */
  title: string;
  /** `wf:description` — the body. */
  description?: string;
  /** Lifecycle state — `rdf:type wf:Open` / `wf:Closed`. */
  state: TaskState;
  /** `dct:created`. */
  created?: Date;
  /** `dct:modified`. */
  modified?: Date;
  /** `prov:endedAtTime` — completion time, set on close, cleared on reopen. */
  endedAt?: Date;
  /** `dct:creator` — the author's WebID. */
  creator?: string;
  /** `wf:assignee` — the assigned agent's WebID. */
  assignee?: string;
  /** `wf:tracker` — the project / tracker document this task belongs to. */
  project?: string;
  /** `wf:dateDue` — the due date. */
  dueDate?: Date;
  /** `schema:priority` — high/medium/low. */
  priority?: TaskPriority;
  /** `schema:position` — backlog rank; lower sorts first. */
  rank?: number;
  /** `dct:isPartOf` — the parent issue (this is a sub-task of it). */
  parent?: string;
  /** `dct:requires` — issues that must be done first (this is blocked by them). */
  blockedBy?: string[];
  /** `dct:relation` — non-blocking, symmetric relates-to links. */
  relatesTo?: string[];
  /** `dct:isReplacedBy` — the canonical successor (close-as-duplicate). */
  duplicateOf?: string;
}

/** True for an absolute http(s) URL usable as a WebID / IRI object. */
export function isHttpIri(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** A known priority, or undefined for any other string. */
function normalizePriority(value: string | undefined): TaskPriority | undefined {
  const v = (value ?? "").toLowerCase().trim();
  return (PRIORITIES as readonly string[]).includes(v) ? (v as TaskPriority) : undefined;
}

/**
 * Typed `@rdfjs/wrapper` view of a single task subject. Each accessor reads/writes
 * through the vetted mappers — no quad is ever hand-built. Construct it on the
 * task subject IRI (conventionally `${resourceUrl}#it`).
 */
export class Task extends TermWrapper {
  /** The task subject IRI. */
  get id(): string {
    return this.value;
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `wf:Task`. Idempotent; returns `this` for chaining. */
  mark(): this {
    this.types.add(TASK_CLASS);
    return this;
  }

  /** Whether this subject is a `wf:Task`. */
  get isTask(): boolean {
    return this.types.has(TASK_CLASS);
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("description"), LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, wf("description"), value, LiteralFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }

  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
  }

  /** `prov:endedAtTime` — completion time. Set automatically by {@link state}. */
  get endedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, prov("endedAtTime"), LiteralAs.date);
  }
  set endedAt(value: Date | undefined) {
    OptionalAs.object(this, prov("endedAtTime"), value, LiteralFrom.dateTime);
  }

  get creator(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("creator"), NamedNodeAs.string);
  }
  set creator(value: string | undefined) {
    OptionalAs.object(this, dct("creator"), value, NamedNodeFrom.string);
  }

  /** `wf:assignee` — the assigned agent's WebID. */
  get assignee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("assignee"), NamedNodeAs.string);
  }
  set assignee(value: string | undefined) {
    OptionalAs.object(this, wf("assignee"), value, NamedNodeFrom.string);
  }

  /** `wf:tracker` — the project / tracker document. */
  get project(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("tracker"), NamedNodeAs.string);
  }
  set project(value: string | undefined) {
    OptionalAs.object(this, wf("tracker"), value, NamedNodeFrom.string);
  }

  /** `wf:dateDue` — the due date (stored as xsd:dateTime; well-formed + round-trips). */
  get dueDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, wf("dateDue"), LiteralAs.date);
  }
  set dueDate(value: Date | undefined) {
    OptionalAs.object(this, wf("dateDue"), value, LiteralFrom.dateTime);
  }

  /** `schema:priority` — high/medium/low, as a string literal. */
  get priority(): TaskPriority | undefined {
    return normalizePriority(
      OptionalFrom.subjectPredicate(this, schema("priority"), LiteralAs.string),
    );
  }
  set priority(value: TaskPriority | undefined) {
    OptionalAs.object(this, schema("priority"), value, LiteralFrom.string);
  }

  /** `schema:position` — backlog rank; lower sorts first. */
  get rank(): number | undefined {
    return OptionalFrom.subjectPredicate(this, schema("position"), LiteralAs.number);
  }
  set rank(value: number | undefined) {
    OptionalAs.object(this, schema("position"), value, LiteralFrom.double);
  }

  /** `dct:isPartOf` — the parent issue. */
  get parent(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("isPartOf"), NamedNodeAs.string);
  }
  set parent(value: string | undefined) {
    OptionalAs.object(this, dct("isPartOf"), value, NamedNodeFrom.string);
  }

  /** `dct:isReplacedBy` — the canonical successor (close-as-duplicate). */
  get duplicateOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("isReplacedBy"), NamedNodeAs.string);
  }
  set duplicateOf(value: string | undefined) {
    OptionalAs.object(this, dct("isReplacedBy"), value, NamedNodeFrom.string);
  }

  /** `dct:requires` — issues this one is blocked by (live set of IRIs). */
  get blockedBy(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      dct("requires"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** `dct:relation` — non-blocking, symmetric relates-to links (live set of IRIs). */
  get relatesTo(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      dct("relation"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /**
   * Lifecycle state, read from / written to `rdf:type wf:Open` / `wf:Closed`.
   * Setting `closed` stamps `prov:endedAtTime` (once — preserved on re-close);
   * setting `open` clears it. Always keeps `wf:Task` typed.
   */
  get state(): TaskState {
    return this.types.has(WF_CLOSED) ? "closed" : "open";
  }
  set state(value: TaskState) {
    const types = this.types;
    types.add(TASK_CLASS);
    if (value === "closed") {
      types.add(WF_CLOSED);
      types.delete(WF_OPEN);
      this.endedAt ??= new Date();
    } else {
      types.add(WF_OPEN);
      types.delete(WF_CLOSED);
      this.endedAt = undefined;
    }
  }

  /** Convenience: is this task open? */
  get isOpen(): boolean {
    return this.state === "open";
  }
}

/**
 * Conventional task subject IRI for a resource: `${resourceUrl}#it`. Both
 * existing producers root the task at `#it` within its own document, so reading a
 * foreign producer's resource finds the subject there.
 */
export function taskSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/**
 * Parse a task out of a dataset, or `undefined` if the subject is not a `wf:Task`.
 *
 * @param resourceUrl - the resource document URL; the task subject is
 *   `${resourceUrl}#it` (see {@link taskSubject}).
 * @param dataset     - the parsed RDF (e.g. from {@link parseTaskTtl} or
 *   `@jeswr/fetch-rdf`'s `fetchRdf`).
 */
export function parseTask(resourceUrl: string, dataset: DatasetCore): TaskData | undefined {
  const doc = new Task(taskSubject(resourceUrl), dataset, DataFactory);
  if (!doc.isTask) return undefined;

  const blockedBy = [...doc.blockedBy];
  const relatesTo = [...doc.relatesTo];
  const data: TaskData = {
    title: doc.title ?? "",
    state: doc.state,
  };
  if (doc.description !== undefined) data.description = doc.description;
  if (doc.created !== undefined) data.created = doc.created;
  if (doc.modified !== undefined) data.modified = doc.modified;
  if (doc.endedAt !== undefined) data.endedAt = doc.endedAt;
  if (doc.creator !== undefined) data.creator = doc.creator;
  if (doc.assignee !== undefined) data.assignee = doc.assignee;
  if (doc.project !== undefined) data.project = doc.project;
  if (doc.dueDate !== undefined) data.dueDate = doc.dueDate;
  if (doc.priority !== undefined) data.priority = doc.priority;
  if (doc.rank !== undefined) data.rank = doc.rank;
  if (doc.parent !== undefined) data.parent = doc.parent;
  if (doc.duplicateOf !== undefined) data.duplicateOf = doc.duplicateOf;
  if (blockedBy.length > 0) data.blockedBy = blockedBy;
  if (relatesTo.length > 0) data.relatesTo = relatesTo;
  return data;
}

/**
 * Build a fresh n3 `Store` holding one task rooted at `${resourceUrl}#it`.
 *
 * Object-property fields that are not absolute http(s) IRIs (assignee, creator,
 * project, parent, duplicateOf, and each blockedBy/relatesTo entry) are dropped
 * rather than coerced into a malformed NamedNode — keeping the graph well-formed
 * (pod data is untrusted input). `created` defaults to now; closing a task stamps
 * `prov:endedAtTime` via the {@link Task.state} setter.
 */
export function buildTask(resourceUrl: string, data: TaskData): Store {
  const store = new Store();
  const doc = new Task(taskSubject(resourceUrl), store, DataFactory).mark();

  doc.title = data.title || undefined;
  doc.description = data.description || undefined;
  doc.created = data.created ?? new Date();
  doc.modified = data.modified;
  // State setter manages wf:Open/wf:Closed + prov:endedAtTime.
  doc.state = data.state;
  if (data.state === "closed") doc.endedAt = data.endedAt ?? doc.endedAt ?? new Date();

  doc.creator = isHttpIri(data.creator) ? data.creator : undefined;
  doc.assignee = isHttpIri(data.assignee) ? data.assignee : undefined;
  doc.project = isHttpIri(data.project) ? data.project : undefined;
  doc.parent = isHttpIri(data.parent) ? data.parent : undefined;
  doc.duplicateOf = isHttpIri(data.duplicateOf) ? data.duplicateOf : undefined;
  doc.dueDate = data.dueDate;
  doc.priority = data.priority;
  doc.rank = data.rank;

  for (const iri of data.blockedBy ?? []) if (isHttpIri(iri)) doc.blockedBy.add(iri);
  for (const iri of data.relatesTo ?? []) if (isHttpIri(iri)) doc.relatesTo.add(iri);

  return store;
}

/**
 * Serialise a task to Turtle (via `n3.Writer`, with the model's prefixes). Builds
 * the store with {@link buildTask}, then writes it — never hand-concatenates RDF.
 */
export async function serializeTask(resourceUrl: string, data: TaskData): Promise<string> {
  return storeToTurtle(buildTask(resourceUrl, data));
}

/** Serialise any n3 `Store` to Turtle with the model's prefixes. */
export function storeToTurtle(store: Store): Promise<string> {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Parse a Turtle / JSON-LD body into a task, dispatching on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted RDF parser — never a bespoke
 * one). Returns `undefined` if the document holds no `wf:Task` at `${url}#it`.
 *
 * @param url         - the resource URL (used as the base IRI for relative refs
 *   and to locate the `#it` subject).
 * @param body        - the raw response body.
 * @param contentType - the `Content-Type` header value (null ⇒ text/turtle, per
 *   the Solid Protocol §5.2 default).
 */
export async function parseTaskTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<TaskData | undefined> {
  // Lazy import keeps the (Node-targeted) fetch-rdf dep out of any pure-parse
  // path a consumer might tree-shake — and matches how the apps import it.
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, contentType, { baseIRI: url });
  return parseTask(url, dataset);
}

/**
 * Does `assignee` name `webId`? An exact IRI match — WebIDs are compared as opaque
 * IRIs (trimmed only). The federation "assigned to me" predicate.
 */
export function isAssignedTo(assignee: string | undefined, webId: string): boolean {
  if (!assignee) return false;
  return assignee.trim() === webId.trim();
}

/**
 * Sort tasks for display: open before closed; newest-created first within a band.
 * Pure. (The federation provenance/trust gate is the CONSUMER's responsibility —
 * see the Pod Manager's `federation-tasks.ts`; this model carries the data only.)
 */
export function sortTasks(tasks: readonly TaskData[]): TaskData[] {
  const rank: Record<TaskState, number> = { open: 0, closed: 1 };
  return [...tasks].sort((a, b) => {
    const r = rank[a.state] - rank[b.state];
    if (r !== 0) return r;
    return (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0);
  });
}
