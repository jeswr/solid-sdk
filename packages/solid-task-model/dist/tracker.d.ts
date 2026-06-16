/**
 * The shared federated **Tracker** model — typed read/write accessors over a
 * single `wf:Tracker` configuration node.
 *
 * **One tracker model, many apps.** A `wf:Task` ({@link ./task.ts}) links to its
 * tracker via `wf:tracker`; this is the entity on the other end of that link. By
 * extracting the federation-core of solid-issues' own `Tracker` here, the Pod
 * Manager and solid-issues (and every future pod-app) read and write the SAME
 * tracker configuration — title, issue class, workflow, categories, state store,
 * assignee group — so a tracker created in one app is a fully-readable, valid
 * SolidOS issue tracker in the others.
 *
 * **SolidOS-readable by construction.** The SolidOS issue pane THROWS when a
 * tracker is missing `wf:issueClass`, so {@link buildTracker} always writes
 * `wf:issueClass wf:Task`, a `wf:initialState`, and (optionally) `wf:stateStore`
 * — exactly the triples SolidOS needs to render the tracker.
 *
 * **Federation-core only.** App-specific surface (priority/type/label category
 * classes, custom fields, saved views, sprints, the activity log) stays in the
 * consuming app (solid-issues' richer `Tracker`); this package carries only the
 * fields that must agree across apps to federate.
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s mappers on an n3 `Store`, mirroring {@link ./task.ts}
 * and solid-issues' `Tracker`. Serialisation is `n3.Writer`; parsing of a fetched
 * body is `@jeswr/fetch-rdf`'s `parseRdf`.
 *
 * **CLIENT-SAFE.** This module imports no `node:fs` (or any Node built-in), so a
 * client bundler (Next.js / Turbopack) can put it in a browser chunk — the same
 * reason `task.ts` is the client-safe half and `shape.ts` (which reads the shape
 * via `node:fs`) is server-only.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
/**
 * A workflow status. `slug` becomes the `#status-<slug>` class fragment of the
 * tracker doc; `terminal` is the open/closed **resolution** every status carries —
 * a terminal status resolves to `wf:Closed`, a non-terminal one to `wf:Open` — so
 * the SHACL exactly-one-of-{Open,Closed} rule and every state consumer still hold,
 * no matter how many custom statuses a tracker declares.
 */
export interface WorkflowStatus {
    slug: string;
    label: string;
    terminal: boolean;
}
/**
 * A configurable workflow: an ordered list of {@link WorkflowStatus} plus the
 * allowed transition edges (`from slug → set of to slugs`). The first status is
 * the initial state. A status missing from `transitions` (or whose target set is
 * undefined) permits no outbound moves except staying put.
 */
export interface WorkflowDef {
    statuses: WorkflowStatus[];
    /** Allowed transitions keyed by source slug; values are reachable target slugs. */
    transitions: Record<string, string[]>;
}
export type StatusSlug = string;
/**
 * The built-in workflow used when a tracker declares none: To Do → In Progress →
 * Done, the classic three-column Kanban. `done` is terminal (⇒ resolves to
 * `wf:Closed`). Kept as the default so existing trackers are unchanged.
 *
 * **Deep-frozen.** This is a shared module-level constant, so it (and its nested
 * arrays/objects) are `Object.freeze`d — a consumer that reads {@link Tracker.workflow}
 * on a tracker with no declared statuses gets a defensive COPY (see the getter), and
 * any direct mutation of the constant itself throws in strict mode rather than silently
 * corrupting every future caller (roborev finding job 5612d10, Medium).
 */
export declare const DEFAULT_WORKFLOW: WorkflowDef;
/**
 * Whether `to` is reachable from `from` under `workflow` (same-status is always
 * allowed). Both `from` and `to` must name a status declared in `workflow` — a
 * malformed `from` that is not a declared status authorizes no transition (a same-
 * status `from === to` short-circuits to true regardless, the identity move).
 */
export declare function canTransition(workflow: WorkflowDef, from: StatusSlug, to: StatusSlug): boolean;
/** A status of `terminal` disposition resolves to "closed"; otherwise "open". */
export declare function statusState(workflow: WorkflowDef, slug: StatusSlug): "open" | "closed";
/**
 * A federated tracker as a plain, serialisable object — the shape an app's UI
 * works with. The federation-core of a SolidOS issue tracker: the subset every
 * suite app must agree on to share trackers.
 */
export interface TrackerData {
    /** `dct:title` — the one required field. */
    title: string;
    /** `wf:issueClass` — the class the tracker's issues carry (defaults to `wf:Task`). */
    issueClass?: string;
    /** `wf:stateStore` — the container/resource holding the tracker's issue resources. */
    stateStore?: string;
    /** `wf:issueCategory` — declared category/dimension class IRIs (priority/label/type…). */
    categories?: string[];
    /** `wf:assigneeGroup` member WebIDs (the assignable agents). */
    groupMembers?: string[];
    /** The configured workflow (status classes + transitions). Defaults to {@link DEFAULT_WORKFLOW}. */
    workflow?: WorkflowDef;
}
/**
 * Typed `@rdfjs/wrapper` view of a single tracker subject. Each accessor
 * reads/writes through the vetted mappers — no quad is ever hand-built. Construct
 * it on the tracker subject IRI (conventionally `${docUrl}#this` — see
 * {@link trackerSubject}; note the Task roots at `#it`, the Tracker at `#this`,
 * matching both existing producers).
 */
export declare class Tracker extends TermWrapper {
    /** The tracker subject IRI. */
    get id(): string;
    /** The document URL of this tracker (its subject IRI without the fragment). */
    private get doc();
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `wf:Tracker`. Idempotent; returns `this` for chaining. */
    mark(): this;
    /** Whether this subject is a `wf:Tracker`. */
    get isTracker(): boolean;
    get title(): string | undefined;
    set title(value: string | undefined);
    /**
     * `wf:issueClass` — the RDF class the tracker's issues carry. Defaults to
     * `wf:Task` on read when unset (the federation-canonical issue class, and what
     * SolidOS expects). The setter writes the supplied class (or `wf:Task` for an
     * undefined value, so the SolidOS-required triple is never dropped).
     */
    get issueClass(): string;
    set issueClass(value: string | undefined);
    /** `wf:stateStore` — the container/resource where the tracker's issues live. */
    get stateStore(): string | undefined;
    set stateStore(value: string | undefined);
    /** `wf:issueCategory` — the declared category/dimension class IRIs (live set). */
    get categories(): Set<string>;
    /** `wf:assigneeGroup` — the group IRI, or undefined if none is set. */
    get assigneeGroup(): string | undefined;
    /** The conventional assignee-group node for this tracker doc (`#team`). */
    private get groupIri();
    /** The assignee group's members (WebIDs), via `wf:assigneeGroup` → `vcard:hasMember`. */
    get groupMembers(): string[];
    /**
     * Replace the assignee group's membership. Links a `vcard:Group` (`#team`) via
     * `wf:assigneeGroup` and sets its `vcard:hasMember` WebIDs (clearing any prior
     * members). Non-http(s) entries are dropped (pod data is untrusted). Passing an
     * empty list leaves an empty (but typed) group node.
     */
    setGroupMembers(webIds: string[]): void;
    /** The `#status-<slug>` class IRI for a status slug, in THIS tracker's doc. */
    private statusIri;
    /**
     * Define a workflow status class. It is a `wf:State` typed `rdfs:Class` whose
     * open/closed **resolution** is carried as `rdfs:subClassOf wf:Open|wf:Closed`
     * (terminal ⇒ Closed). The persisted `schema:position` records the declared
     * column order; a non-terminal state declares its allowed transition targets
     * via `wf:allowedTransitions`.
     */
    private defineStatus;
    /** Remove a status class and its transition edges. */
    private removeStatus;
    /**
     * Read the tracker's configured workflow. Statuses are the declared `wf:State`
     * classes (`#status-*`) in this document, ordered with `wf:initialState` first
     * then by `schema:position`; transitions come from each state's
     * `wf:allowedTransitions`. A tracker with no declared statuses yields the
     * {@link DEFAULT_WORKFLOW}, so consumers always get a usable workflow.
     */
    get workflow(): WorkflowDef;
    /**
     * Declare (replacing any existing) a custom workflow on the tracker: mint each
     * `#status-<slug>` `wf:State` class with its open/closed resolution and allowed
     * transition edges, and set the first status as `wf:initialState`. Every state
     * resolves to `wf:Open`/`wf:Closed`, so the issue model and SHACL are unchanged.
     * At least one status is required, and exactly one initial state results.
     */
    defineWorkflow(workflow: WorkflowDef): void;
}
/**
 * Conventional tracker subject IRI for a document: `${docUrl}#this`. Both
 * existing producers (solid-issues' `Tracker`, the SolidOS pane) root the tracker
 * config at `#this` within its own document. **Note: the Task uses `#it`, NOT
 * `#this` — the two fragments are intentionally distinct; do not unify them, or a
 * cross-app read silently misses the subject.**
 */
export declare function trackerSubject(docUrl: string): string;
/**
 * Parse a tracker out of a dataset, or `undefined` if the subject is not a
 * `wf:Tracker`.
 *
 * @param docUrl  - the tracker document URL; the subject is `${docUrl}#this`
 *   (see {@link trackerSubject}).
 * @param dataset - the parsed RDF (e.g. from {@link parseTrackerTtl} or
 *   `@jeswr/fetch-rdf`'s `fetchRdf`).
 */
export declare function parseTracker(docUrl: string, dataset: DatasetCore): TrackerData | undefined;
/**
 * Build a fresh n3 `Store` holding one tracker rooted at `${docUrl}#this`.
 *
 * **SolidOS-readable defaults.** Always writes `wf:issueClass wf:Task` and a
 * workflow with a `wf:initialState` (defaulting to {@link DEFAULT_WORKFLOW}),
 * plus `wf:Open` reachability — the triples the SolidOS issue pane requires (it
 * THROWS without `wf:issueClass`). A `stateStore` is written when supplied.
 *
 * Object-property fields that are not absolute http(s) IRIs (stateStore,
 * issueClass, each category, each group member) are dropped rather than coerced
 * into a malformed NamedNode — keeping the graph well-formed (pod data is
 * untrusted input).
 */
export declare function buildTracker(docUrl: string, data: TrackerData): Store;
/**
 * Serialise a tracker to Turtle (via `n3.Writer`, with the model's prefixes).
 * Builds the store with {@link buildTracker}, then writes it — never
 * hand-concatenates RDF.
 */
export declare function serializeTracker(docUrl: string, data: TrackerData): Promise<string>;
/**
 * Parse a Turtle / JSON-LD body into a tracker, dispatching on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted RDF parser — never a bespoke
 * one). Returns `undefined` if the document holds no `wf:Tracker` at
 * `${docUrl}#this`.
 *
 * @param docUrl      - the document URL (the base IRI for relative refs and to
 *   locate the `#this` subject).
 * @param body        - the raw response body.
 * @param contentType - the `Content-Type` header value (null ⇒ text/turtle, per
 *   the Solid Protocol §5.2 default).
 */
export declare function parseTrackerTtl(docUrl: string, body: string, contentType?: string | null): Promise<TrackerData | undefined>;
//# sourceMappingURL=tracker.d.ts.map