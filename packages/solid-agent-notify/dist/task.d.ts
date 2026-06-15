/**
 * task.ts — the shared federation TASK model on top of the AS2.0 notification.
 *
 * The headline cross-pod use case is a "task assigned" / "task state changed"
 * notification: app A POSTs an `as:Announce` to agent B's inbox whose `as:object`
 * IS a `wf:Task` (the SolidOS workflow-ontology task/issue, the same shape
 * solid-issues + Pod Manager read/write). This module builds + reads that shape
 * using the SHARED federation vocab terms pinned at https://w3id.org/jeswr/task
 * (re-used `wf:` + `dct:` + `as:` — NOT new terms), via TYPED `@rdfjs/wrapper`
 * accessors over an n3 `Store` (house rule: never hand-concat / hand-build RDF
 * triples).
 *
 * Layering: a {@link TaskDoc} is the typed view of one `wf:Task` subject;
 * {@link buildTaskNotification} embeds a task into the AS2.0 activity dataset from
 * {@link buildActivity}; {@link parseTaskFromNotification} reads it back. The
 * higher-level send helpers ({@link notifyTaskAssigned},
 * {@link notifyTaskStateChanged}) discover + deliver the result. SSRF posture is
 * unchanged — every fetch still goes through the same DNS-pinned `guardedFetch`.
 */
import { TermWrapper } from "@rdfjs/wrapper";
import { type Store } from "n3";
import { type ActivityNotification } from "./activity.js";
import type { NotifyOptions } from "./discover.js";
import { type NotifyAgentArgs, type SendResult } from "./send.js";
/** Lifecycle state of a `wf:Task` (`rdf:type wf:Open` | `wf:Closed`). */
export type TaskState = "Open" | "Closed";
/**
 * The plain shape of a federation task (no RDF terms) callers build / consume —
 * the `wf:Task` the ecosystem agrees on. All IRI fields must be absolute http(s).
 */
export interface TaskNotification {
    /** The task's own IRI (e.g. a pod resource `#it`); the subject of the `wf:Task`. */
    task: string;
    /** Lifecycle state → `rdf:type wf:Open|wf:Closed` (defaults to `Open`). */
    state?: TaskState;
    /** `dct:title` — the human-readable task title. */
    title?: string;
    /** `dct:description` — the longer task body. */
    description?: string;
    /** `wf:assignee` — the WebID a task is assigned to (the federation "assigned to me" key). */
    assignee?: string;
    /** `dct:creator` — the WebID of who created the task. */
    creator?: string;
    /** `dct:created` — when the task was created (defaults to now on build). */
    created?: Date;
}
/**
 * Typed `@rdfjs/wrapper` view of one shared `wf:Task` subject (read + write). The
 * predicates are the OWNING vocabularies the federation task model re-uses, so the
 * written data resolves against the real `wf:` / `dct:` ontologies.
 */
export declare class TaskDoc extends TermWrapper {
    /** `rdf:type` values of this subject (carries `wf:Task` + the `wf:Open|wf:Closed` state). */
    get types(): Set<string>;
    /** Stamp `rdf:type wf:Task` (idempotent — a Set). */
    markTask(): this;
    /**
     * Lifecycle state — `"Open"` / `"Closed"` from the `wf:Open` / `wf:Closed`
     * rdf:type, or `undefined` if NEITHER (or, fail-closed, BOTH) is present. A task
     * is Open XOR Closed: a hostile/malformed graph asserting both is AMBIGUOUS, and
     * RDF statement order must never be the tie-breaker — so both-present resolves to
     * `undefined` rather than an arbitrary first-match.
     */
    get state(): TaskState | undefined;
    /**
     * Set the lifecycle state — adds the `wf:Open|wf:Closed` rdf:type and removes the
     * opposite one (a task is Open XOR Closed; never both at once).
     */
    setState(state: TaskState): this;
    get title(): string | undefined;
    set title(v: string | undefined);
    get description(): string | undefined;
    set description(v: string | undefined);
    /** `wf:assignee` — the assigned agent's WebID (object property). */
    get assignee(): string | undefined;
    set assignee(v: string | undefined);
    /** `dct:creator` — the creator's WebID (object property). */
    get creator(): string | undefined;
    set creator(v: string | undefined);
    get created(): Date | undefined;
    set created(v: Date | undefined);
}
/**
 * Write a federation `wf:Task` into an existing dataset (typed accessors only).
 * Used by {@link buildTaskNotification} but also exposed for callers composing
 * their own graph. Only http(s) IRIs are written for assignee/creator (never
 * coerce arbitrary text into a NamedNode). Returns the same store for chaining.
 */
export declare function writeTask(store: Store, task: TaskNotification): Store;
/**
 * Build a cross-pod task notification: an `as:Announce` (default) whose `as:object`
 * is the task IRI, with the full `wf:Task` shape embedded in the same dataset. This
 * is the shape solid-issues / Pod Manager emit + read for "task assigned" /
 * "task state changed" federation events.
 *
 * The activity verb defaults to `Announce` (the agreed federation verb). The
 * activity's `as:object` is set to the task IRI automatically; the activity
 * subject is the conventional relative `#it` (the inbox assigns the final IRI).
 *
 * @param task     the federation task to embed.
 * @param activity optional AS2.0 activity overrides (`actor`, `type`, `summary`,
 *                 `content`, `published`); `actor` is the SENDER WebID. `object`
 *                 is forced to the task IRI.
 */
export declare function buildTaskNotification(task: TaskNotification, activity: Partial<Omit<ActivityNotification, "object">> & {
    actor: string;
}): Store;
/**
 * Read the `wf:Task` referenced by a notification's `as:object` back into a plain
 * {@link TaskNotification}, or `undefined` if the activity carries no task object
 * or the referenced subject is not a `wf:Task`.
 *
 * @param activitySubject the activity subject IRI (e.g. from
 *   `findActivitySubject`); we follow its `as:object` to the task.
 * @param dataset         the parsed notification dataset.
 */
export declare function parseTaskFromNotification(activitySubject: string, dataset: import("@rdfjs/types").DatasetCore): TaskNotification | undefined;
/**
 * Read a `wf:Task` subject from a dataset into a plain {@link TaskNotification}, or
 * `undefined` if the subject does not carry `rdf:type wf:Task`.
 *
 * SECURITY/ROBUSTNESS. The dataset is attacker-influenced (it came off a peer's
 * inbox), so the read fails CLOSED on every axis: the task IRI must itself be an
 * absolute http(s) URL; the lifecycle state is Open XOR Closed (both → ambiguous →
 * absent, see {@link TaskDoc.state}); every single-valued field is read with strict
 * cardinality ({@link singleObject} — MULTIPLE distinct values → ambiguous → absent,
 * never an arbitrary first); `assignee`/`creator` surface only as http(s) IRIs
 * (matching the write side — never a `mailto:`/literal/blank-node WebID); and a
 * malformed `dct:created` that is not a valid `xsd:dateTime` is dropped, not thrown.
 */
export declare function parseTask(taskIri: string, dataset: import("@rdfjs/types").DatasetCore): TaskNotification | undefined;
/** Arguments for {@link notifyTaskAssigned}. */
export interface NotifyTaskArgs extends Omit<NotifyAgentArgs, "object" | "type"> {
    /** The federation task to embed in the notification. */
    task: TaskNotification;
    /** Activity verb; defaults to `Announce` (the federation event verb). */
    type?: NotifyAgentArgs["type"];
}
/**
 * Notify an agent that a task has been assigned to them: discover the recipient's
 * inbox from their WebID, then deliver an `as:Announce` carrying the `wf:Task`.
 *
 * Convenience over {@link buildTaskNotification} + the discover/send path. The
 * recipient is `recipientWebId`; the task's `wf:assignee` is set to that WebID
 * unless the task already carries one (so "assigned to you" is self-describing).
 *
 * @throws NoInboxError          the recipient advertises no inbox.
 * @throws NotificationSendError the inbox refused the POST.
 */
export declare function notifyTaskAssigned(args: NotifyTaskArgs, opts?: NotifyOptions): Promise<SendResult>;
/**
 * Notify an agent of a task's state change (Open ↔ Closed): discover + deliver an
 * `as:Announce` carrying the `wf:Task` at its new {@link TaskState}.
 */
export declare function notifyTaskStateChanged(args: NotifyTaskArgs & {
    state: TaskState;
}, opts?: NotifyOptions): Promise<SendResult>;
//# sourceMappingURL=task.d.ts.map