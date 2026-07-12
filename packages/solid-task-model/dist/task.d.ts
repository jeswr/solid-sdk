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
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
export { isHttpIri } from "./iri.js";
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
export declare const PRIORITIES: readonly TaskPriority[];
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
    /** `prov:wasDerivedFrom` — the single original this task was cloned from. */
    clonedFrom?: string;
}
/**
 * Typed `@rdfjs/wrapper` view of a single task subject. Each accessor reads/writes
 * through the vetted mappers — no quad is ever hand-built. Construct it on the
 * task subject IRI (conventionally `${resourceUrl}#it`).
 */
export declare class Task extends TermWrapper {
    /** The task subject IRI. */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `wf:Task`. Idempotent; returns `this` for chaining. */
    mark(): this;
    /** Whether this subject is a `wf:Task`. */
    get isTask(): boolean;
    get title(): string | undefined;
    set title(value: string | undefined);
    /**
     * The body. The two existing producers DIVERGE on the predicate — solid-issues
     * writes `wf:description`, the Pod Manager writes `dct:description` — so the
     * shared model must read BOTH or it would silently drop a PM-written body on a
     * cross-app read. The getter prefers `wf:description` and falls back to
     * `dct:description`; the setter writes BOTH (and clears both on undefined) so a
     * consumer querying either predicate finds it. This is the convergence point:
     * once apps adopt this package they all read/write the same pair.
     */
    get description(): string | undefined;
    set description(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
    get modified(): Date | undefined;
    set modified(value: Date | undefined);
    /** `prov:endedAtTime` — completion time. Set automatically by {@link state}. */
    get endedAt(): Date | undefined;
    set endedAt(value: Date | undefined);
    get creator(): string | undefined;
    set creator(value: string | undefined);
    /** `wf:assignee` — the assigned agent's WebID. */
    get assignee(): string | undefined;
    set assignee(value: string | undefined);
    /** `wf:tracker` — the project / tracker document. */
    get project(): string | undefined;
    set project(value: string | undefined);
    /** `wf:dateDue` — the due date (stored as xsd:dateTime; well-formed + round-trips). */
    get dueDate(): Date | undefined;
    set dueDate(value: Date | undefined);
    /** `schema:priority` — high/medium/low, as a string literal. */
    get priority(): TaskPriority | undefined;
    set priority(value: TaskPriority | undefined);
    /** `schema:position` — backlog rank; lower sorts first. */
    get rank(): number | undefined;
    set rank(value: number | undefined);
    /** `dct:isPartOf` — the parent issue. */
    get parent(): string | undefined;
    set parent(value: string | undefined);
    /** `dct:isReplacedBy` — the canonical successor (close-as-duplicate). */
    get duplicateOf(): string | undefined;
    set duplicateOf(value: string | undefined);
    /** `prov:wasDerivedFrom` — the single original this task was cloned from. */
    get clonedFrom(): string | undefined;
    set clonedFrom(value: string | undefined);
    /** `dct:requires` — issues this one is blocked by (live set of IRIs). */
    get blockedBy(): Set<string>;
    /** `dct:relation` — non-blocking, symmetric relates-to links (live set of IRIs). */
    get relatesTo(): Set<string>;
    /**
     * Lifecycle state, read from / written to `rdf:type wf:Open` / `wf:Closed`.
     * Setting `closed` stamps `prov:endedAtTime` (once — preserved on re-close);
     * setting `open` clears it. Always keeps `wf:Task` typed.
     */
    get state(): TaskState;
    set state(value: TaskState);
    /** Convenience: is this task open? */
    get isOpen(): boolean;
}
/**
 * Conventional task subject IRI for a resource: `${resourceUrl}#it`. Both
 * existing producers root the task at `#it` within its own document, so reading a
 * foreign producer's resource finds the subject there.
 */
export declare function taskSubject(resourceUrl: string): string;
/**
 * Parse a task out of a dataset, or `undefined` if the subject is not a `wf:Task`.
 *
 * @param resourceUrl - the resource document URL; the task subject is
 *   `${resourceUrl}#it` (see {@link taskSubject}).
 * @param dataset     - the parsed RDF (e.g. from {@link parseTaskTtl} or
 *   `@jeswr/fetch-rdf`'s `fetchRdf`).
 */
export declare function parseTask(resourceUrl: string, dataset: DatasetCore): TaskData | undefined;
/**
 * Build a fresh n3 `Store` holding one task rooted at `${resourceUrl}#it`.
 *
 * Object-property fields that are not absolute http(s) IRIs (assignee, creator,
 * project, parent, duplicateOf, and each blockedBy/relatesTo entry) are dropped
 * rather than coerced into a malformed NamedNode — keeping the graph well-formed
 * (pod data is untrusted input). `created` defaults to now; closing a task stamps
 * `prov:endedAtTime` via the {@link Task.state} setter.
 */
export declare function buildTask(resourceUrl: string, data: TaskData): Store;
/**
 * Serialise a task to Turtle (via `n3.Writer`, with the model's prefixes). Builds
 * the store with {@link buildTask}, then writes it — never hand-concatenates RDF.
 */
export declare function serializeTask(resourceUrl: string, data: TaskData): Promise<string>;
/** Serialise any n3 `Store` to Turtle with the model's prefixes. */
export declare function storeToTurtle(store: Store): Promise<string>;
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
export declare function parseTaskTtl(url: string, body: string, contentType?: string | null): Promise<TaskData | undefined>;
/**
 * Does `assignee` name `webId`? An exact IRI match — WebIDs are compared as opaque
 * IRIs (trimmed only). The federation "assigned to me" predicate.
 */
export declare function isAssignedTo(assignee: string | undefined, webId: string): boolean;
/**
 * Sort tasks for display: open before closed; newest-created first within a band.
 * Pure. (The federation provenance/trust gate is the CONSUMER's responsibility —
 * see the Pod Manager's `federation-tasks.ts`; this model carries the data only.)
 */
export declare function sortTasks(tasks: readonly TaskData[]): TaskData[];
//# sourceMappingURL=task.d.ts.map