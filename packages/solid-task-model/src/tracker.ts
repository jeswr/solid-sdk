// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { DataFactory, Store } from "n3";
import { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";
import { storeToTurtle } from "./task.js";
import {
  dct,
  rdf,
  rdfs,
  schema,
  TASK_CLASS,
  vcard,
  WF_ALLOWED_TRANS,
  WF_ASSIGNEE_GROUP,
  WF_CLOSED,
  WF_INITIAL_STATE,
  WF_ISSUE_CATEGORY,
  WF_ISSUE_CLASS,
  WF_OPEN,
  WF_STATE,
  WF_STATE_STORE,
  WF_TRACKER,
} from "./vocab.js";

// --- Workflow model — lifted VERBATIM from solid-issues `src/lib/issue.ts`
// (lines 38–95) so the two share ONE definition. solid-issues will re-export
// these from here, retiring its copy (the WorkflowDef single-home requirement).

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

/** A fresh, independent copy of a workflow (no aliasing into a shared constant). */
function cloneWorkflow(workflow: WorkflowDef): WorkflowDef {
  return {
    statuses: workflow.statuses.map((s) => ({ ...s })),
    transitions: Object.fromEntries(
      Object.entries(workflow.transitions).map(([k, v]) => [k, [...v]]),
    ),
  };
}

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
export const DEFAULT_WORKFLOW: WorkflowDef = (() => {
  const wf: WorkflowDef = {
    statuses: [
      { slug: "todo", label: "To Do", terminal: false },
      { slug: "in-progress", label: "In Progress", terminal: false },
      { slug: "done", label: "Done", terminal: true },
    ],
    // A linear board with free backward moves: any column can reach any other.
    transitions: {
      todo: ["in-progress", "done"],
      "in-progress": ["todo", "done"],
      done: ["todo", "in-progress"],
    },
  };
  for (const s of wf.statuses) Object.freeze(s);
  Object.freeze(wf.statuses);
  for (const v of Object.values(wf.transitions)) Object.freeze(v);
  Object.freeze(wf.transitions);
  return Object.freeze(wf);
})();

/**
 * Whether `to` is reachable from `from` under `workflow` (same-status is always
 * allowed). Both `from` and `to` must name a status declared in `workflow` — a
 * malformed `from` that is not a declared status authorizes no transition (a same-
 * status `from === to` short-circuits to true regardless, the identity move).
 */
export function canTransition(workflow: WorkflowDef, from: StatusSlug, to: StatusSlug): boolean {
  if (from === to) return true;
  const slugs = workflow.statuses;
  if (!slugs.some((s) => s.slug === from)) return false;
  if (!slugs.some((s) => s.slug === to)) return false;
  return (workflow.transitions[from] ?? []).includes(to);
}

/** A status of `terminal` disposition resolves to "closed"; otherwise "open". */
export function statusState(workflow: WorkflowDef, slug: StatusSlug): "open" | "closed" {
  return workflow.statuses.find((s) => s.slug === slug)?.terminal ? "closed" : "open";
}

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
export class Tracker extends TermWrapper {
  /** The tracker subject IRI. */
  get id(): string {
    return this.value;
  }

  /** The document URL of this tracker (its subject IRI without the fragment). */
  private get doc(): string {
    return docOf(this.value);
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `wf:Tracker`. Idempotent; returns `this` for chaining. */
  mark(): this {
    this.types.add(WF_TRACKER);
    return this;
  }

  /** Whether this subject is a `wf:Tracker`. */
  get isTracker(): boolean {
    return this.types.has(WF_TRACKER);
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  /**
   * `wf:issueClass` — the RDF class the tracker's issues carry. Defaults to
   * `wf:Task` on read when unset (the federation-canonical issue class, and what
   * SolidOS expects). The setter writes the supplied class (or `wf:Task` for an
   * undefined value, so the SolidOS-required triple is never dropped).
   */
  get issueClass(): string {
    return OptionalFrom.subjectPredicate(this, WF_ISSUE_CLASS, NamedNodeAs.string) ?? TASK_CLASS;
  }
  set issueClass(value: string | undefined) {
    OptionalAs.object(this, WF_ISSUE_CLASS, value ?? TASK_CLASS, NamedNodeFrom.string);
  }

  /** `wf:stateStore` — the container/resource where the tracker's issues live. */
  get stateStore(): string | undefined {
    return OptionalFrom.subjectPredicate(this, WF_STATE_STORE, NamedNodeAs.string);
  }
  set stateStore(value: string | undefined) {
    OptionalAs.object(this, WF_STATE_STORE, value, NamedNodeFrom.string);
  }

  /** `wf:issueCategory` — the declared category/dimension class IRIs (live set). */
  get categories(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      WF_ISSUE_CATEGORY,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** `wf:assigneeGroup` — the group IRI, or undefined if none is set. */
  get assigneeGroup(): string | undefined {
    return OptionalFrom.subjectPredicate(this, WF_ASSIGNEE_GROUP, NamedNodeAs.string);
  }

  /** The conventional assignee-group node for this tracker doc (`#team`). */
  private get groupIri(): string {
    return `${this.doc}#team`;
  }

  /**
   * The assignee group's members (WebIDs), via `wf:assigneeGroup` →
   * `vcard:hasMember`. Non-http(s) entries are dropped on READ exactly as
   * {@link setGroupMembers} drops them on WRITE — a foreign/malicious tracker
   * doc may carry e.g. `vcard:hasMember <javascript:…>`, and a consumer that
   * renders members as links must never surface such a URI (pod data is
   * untrusted input). The read filter mirrors the write filter so the two sides
   * are symmetric.
   */
  get groupMembers(): string[] {
    const group = this.assigneeGroup;
    if (!group) return [];
    const wrapper = new TermWrapper(group, this.dataset, this.factory);
    return [
      ...SetFrom.subjectPredicate(
        wrapper,
        vcard("hasMember"),
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ),
    ].filter(isHttpIri);
  }

  /**
   * Replace the assignee group's membership. Links a `vcard:Group` (`#team`) via
   * `wf:assigneeGroup` and sets its `vcard:hasMember` WebIDs (clearing any prior
   * members). Non-http(s) entries are dropped (pod data is untrusted). Passing an
   * empty list leaves an empty (but typed) group node.
   */
  setGroupMembers(webIds: string[]): void {
    OptionalAs.object(this, WF_ASSIGNEE_GROUP, this.groupIri, NamedNodeFrom.string);
    const group = new TermWrapper(this.groupIri, this.dataset, this.factory);
    SetFrom.subjectPredicate(group, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(
      vcard("Group"),
    );
    const members = SetFrom.subjectPredicate(
      group,
      vcard("hasMember"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    for (const m of [...members]) members.delete(m);
    for (const w of webIds) if (isHttpIri(w)) members.add(w);
  }

  /** The `#status-<slug>` class IRI for a status slug, in THIS tracker's doc. */
  private statusIri(slug: string): string {
    return `${this.doc}#status-${slug}`;
  }

  /**
   * Define a workflow status class. It is a `wf:State` typed `rdfs:Class` whose
   * open/closed **resolution** is carried as `rdfs:subClassOf wf:Open|wf:Closed`
   * (terminal ⇒ Closed). The persisted `schema:position` records the declared
   * column order; a non-terminal state declares its allowed transition targets
   * via `wf:allowedTransitions`.
   */
  private defineStatus(
    slug: string,
    label: string,
    terminal: boolean,
    position: number,
    targets: string[] = [],
  ): void {
    const iri = this.statusIri(slug);
    const klass = new TermWrapper(iri, this.dataset, this.factory);
    const types = SetFrom.subjectPredicate(
      klass,
      rdf("type"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    types.add(rdfs("Class"));
    types.add(WF_STATE);
    OptionalAs.object(klass, rdfs("label"), label, LiteralFrom.string);
    OptionalAs.object(
      klass,
      rdfs("subClassOf"),
      terminal ? WF_CLOSED : WF_OPEN,
      NamedNodeFrom.string,
    );
    OptionalAs.object(klass, schema("position"), position, LiteralFrom.double);
    const allowed = SetFrom.subjectPredicate(
      klass,
      WF_ALLOWED_TRANS,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    for (const t of targets) allowed.add(this.statusIri(t));
  }

  /** Remove a status class and its transition edges. */
  private removeStatus(slug: string): void {
    const iri = this.statusIri(slug);
    for (const q of [...this.dataset.match(this.factory.namedNode(iri))]) this.dataset.delete(q);
  }

  /**
   * Read the tracker's configured workflow. Statuses are the declared `wf:State`
   * classes (`#status-*`) in this document, ordered with `wf:initialState` first
   * then by `schema:position`; transitions come from each state's
   * `wf:allowedTransitions`. A tracker with no declared statuses yields the
   * {@link DEFAULT_WORKFLOW}, so consumers always get a usable workflow.
   */
  get workflow(): WorkflowDef {
    const prefix = `${this.doc}#status-`;
    const nn = this.factory.namedNode.bind(this.factory);
    const slugs = new Set<string>();
    for (const q of this.dataset.match(null, nn(rdf("type")), nn(WF_STATE))) {
      if (q.subject.value.startsWith(prefix)) slugs.add(q.subject.value.slice(prefix.length));
    }
    // Return a defensive COPY of the default — DEFAULT_WORKFLOW is a shared frozen
    // constant, so handing it out directly would let a consumer's mutation either
    // throw (frozen) or, pre-freeze, corrupt every future caller.
    if (slugs.size === 0) return cloneWorkflow(DEFAULT_WORKFLOW);

    const initial = OptionalFrom.subjectPredicate(this, WF_INITIAL_STATE, NamedNodeAs.string);
    const initialSlug = initial?.startsWith(prefix) ? initial.slice(prefix.length) : undefined;
    const positionOf = (slug: string): number =>
      OptionalFrom.subjectPredicate(
        new TermWrapper(this.statusIri(slug), this.dataset, this.factory),
        schema("position"),
        LiteralAs.number,
      ) ?? Number.MAX_SAFE_INTEGER;
    // Order by the persisted column position (the declared order); the initial
    // state always leads, and an unpositioned status falls back to slug order.
    const ordered = [...slugs].sort((a, b) => {
      if (a === initialSlug) return -1;
      if (b === initialSlug) return 1;
      const pa = positionOf(a);
      const pb = positionOf(b);
      return pa !== pb ? pa - pb : a.localeCompare(b);
    });
    const statuses: WorkflowStatus[] = ordered.map((slug) => {
      const klass = new TermWrapper(this.statusIri(slug), this.dataset, this.factory);
      const supers = SetFrom.subjectPredicate(
        klass,
        rdfs("subClassOf"),
        NamedNodeAs.string,
        NamedNodeFrom.string,
      );
      return {
        slug,
        label: OptionalFrom.subjectPredicate(klass, rdfs("label"), LiteralAs.string) ?? slug,
        terminal: supers.has(WF_CLOSED),
      };
    });
    const transitions: Record<string, string[]> = {};
    for (const slug of ordered) {
      const klass = new TermWrapper(this.statusIri(slug), this.dataset, this.factory);
      const targets = SetFrom.subjectPredicate(
        klass,
        WF_ALLOWED_TRANS,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      );
      transitions[slug] = [...targets]
        .filter((iri) => iri.startsWith(prefix))
        .map((iri) => iri.slice(prefix.length))
        .filter((s) => slugs.has(s));
    }
    return { statuses, transitions };
  }

  /**
   * Declare (replacing any existing) a custom workflow on the tracker: mint each
   * `#status-<slug>` `wf:State` class with its open/closed resolution and allowed
   * transition edges, and set the first status as `wf:initialState`. Every state
   * resolves to `wf:Open`/`wf:Closed`, so the issue model and SHACL are unchanged.
   * At least one status is required, and exactly one initial state results.
   */
  defineWorkflow(workflow: WorkflowDef): void {
    const first = workflow.statuses[0];
    if (first === undefined) throw new Error("A workflow needs at least one status.");
    // Clear the previously-declared statuses (the union of old + new slugs), so a
    // redefinition that drops a status leaves no orphan #status- class behind.
    for (const slug of this.workflow.statuses.map((s) => s.slug)) this.removeStatus(slug);
    for (const slug of workflow.statuses.map((s) => s.slug)) this.removeStatus(slug);
    workflow.statuses.forEach((s, i) => {
      this.defineStatus(s.slug, s.label, s.terminal, i, workflow.transitions[s.slug] ?? []);
    });
    OptionalAs.object(this, WF_INITIAL_STATE, this.statusIri(first.slug), NamedNodeFrom.string);
  }
}

/**
 * Conventional tracker subject IRI for a document: `${docUrl}#this`. Both
 * existing producers (solid-issues' `Tracker`, the SolidOS pane) root the tracker
 * config at `#this` within its own document. **Note: the Task uses `#it`, NOT
 * `#this` — the two fragments are intentionally distinct; do not unify them, or a
 * cross-app read silently misses the subject.**
 */
export function trackerSubject(docUrl: string): string {
  return `${docUrl}#this`;
}

/**
 * Parse a tracker out of a dataset, or `undefined` if the subject is not a
 * `wf:Tracker`.
 *
 * @param docUrl  - the tracker document URL; the subject is `${docUrl}#this`
 *   (see {@link trackerSubject}).
 * @param dataset - the parsed RDF (e.g. from {@link parseTrackerTtl} or
 *   `@jeswr/fetch-rdf`'s `fetchRdf`).
 */
export function parseTracker(docUrl: string, dataset: DatasetCore): TrackerData | undefined {
  const doc = new Tracker(trackerSubject(docUrl), dataset, DataFactory);
  if (!doc.isTracker) return undefined;

  const categories = [...doc.categories];
  const groupMembers = doc.groupMembers;
  const data: TrackerData = {
    title: doc.title ?? "",
    issueClass: doc.issueClass,
    workflow: doc.workflow,
  };
  if (doc.stateStore !== undefined) data.stateStore = doc.stateStore;
  if (categories.length > 0) data.categories = categories;
  if (groupMembers.length > 0) data.groupMembers = groupMembers;
  return data;
}

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
export function buildTracker(docUrl: string, data: TrackerData): Store {
  const store = new Store();
  const doc = new Tracker(trackerSubject(docUrl), store, DataFactory).mark();

  doc.title = data.title || undefined;
  // issueClass: a non-http(s) value falls back to wf:Task (the required default).
  doc.issueClass = isHttpIri(data.issueClass) ? data.issueClass : TASK_CLASS;
  doc.stateStore = httpIriOrUndefined(data.stateStore);
  // Workflow (+ wf:initialState) — defaults to the To Do → In Progress → Done board.
  doc.defineWorkflow(data.workflow ?? DEFAULT_WORKFLOW);
  for (const iri of data.categories ?? []) if (isHttpIri(iri)) doc.categories.add(iri);
  if (data.groupMembers && data.groupMembers.length > 0) doc.setGroupMembers(data.groupMembers);

  return store;
}

/**
 * Serialise a tracker to Turtle (via `n3.Writer`, with the model's prefixes).
 * Builds the store with {@link buildTracker}, then writes it — never
 * hand-concatenates RDF.
 */
export async function serializeTracker(docUrl: string, data: TrackerData): Promise<string> {
  return storeToTurtle(buildTracker(docUrl, data));
}

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
export async function parseTrackerTtl(
  docUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<TrackerData | undefined> {
  // Coalesce BEFORE parsing: callers routinely pass `Response.headers.get(
  // "content-type")`, which is `null` for a header-less response. The default
  // parameter only fires for `undefined`, so an explicit `null` would otherwise
  // bypass this function's documented "⇒ text/turtle" default.
  const resolvedContentType = contentType ?? "text/turtle";
  // Lazy import keeps the (Node-targeted) fetch-rdf dep off any pure-parse path a
  // consumer might tree-shake — and matches how the apps import it.
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, resolvedContentType, { baseIRI: docUrl });
  return parseTracker(docUrl, dataset);
}
