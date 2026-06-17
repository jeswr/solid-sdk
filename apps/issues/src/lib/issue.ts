import {
  TermWrapper,
  DatasetWrapper,
  OptionalFrom,
  OptionalAs,
  SetFrom,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  TermAs,
  TermFrom,
} from "@rdfjs/wrapper";
// Import the runtime model from the `./task` subpath, NOT the barrel `.` — the
// barrel re-exports `taskShapeTtl`, which reads the shape via `node:fs`, and a
// client bundler (Next.js/Turbopack) cannot put `node:fs` in a browser chunk. The
// `Issue` model is used in client components (e.g. session-context), so it must
// stay `node:fs`-free; `./task` carries only the runtime accessors.
import { Task, type TaskPriority } from "@jeswr/solid-task-model/task";
import { WF, DCT, RDF, STATE, TM, wf, dct, rdf, rdfs, sioc, foaf, vcard, schema, xsd, skos, prov, time, tm, odrl, TIME_UNIT_SECOND, SAVED_VIEW, VIEW_QUERY, RELEASED } from "./vocab";

export type IssueState = "open" | "closed";
/**
 * Issue priority. Identical to the shared model's {@link TaskPriority} — re-exported
 * under the app's own name so consumers are unchanged while the values stay pinned
 * to the federated vocabulary.
 */
export type Priority = TaskPriority;
export const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];

/**
 * **Workflow primitives — single home in `@jeswr/solid-task-model` (G7).** These
 * were lifted VERBATIM from this file (the former lines 38–95) into the shared
 * federated tracker model, and are re-exported here from its client-safe
 * `./tracker` subexport so solid-issues, the Pod Manager, and every other suite
 * app share ONE definition (task #101 — the single-home requirement). The public
 * names are kept identical, so every existing `@/lib/issue` import is unchanged.
 *
 * Imported from `@jeswr/solid-task-model/tracker` — the client-safe subexport,
 * NOT the `.` barrel (the barrel re-exports the SHACL shape, which reads
 * `node:fs`, and `Issue` is used in client components — same reason `Task` above
 * is imported from `./task`).
 *
 * The shared copies tightened two behaviours over the former local ones; both are
 * verified transparent here (the full test suite is the behaviour-preservation
 * proof):
 *  - `DEFAULT_WORKFLOW` is now **deep-frozen**, and the package's own
 *    `Tracker.workflow` hands out a defensive copy. solid-issues never mutates
 *    `DEFAULT_WORKFLOW`, `STATUSES`, or a returned workflow, so freezing is a no-op
 *    at every call site.
 *  - `canTransition` now also rejects an unknown `from` slug (the former local
 *    copy only guarded `to`). Every solid-issues call site passes a `from` read
 *    from the issue's own status under the active workflow, so the stricter guard
 *    only ever rejects genuinely malformed inputs.
 *
 * `WorkflowStatus`/`WorkflowDef`/`StatusSlug` are byte-identical; `statusState`
 * is byte-identical (it returns the `"open" | "closed"` union — exactly this
 * file's {@link IssueState}).
 */
// Bring the shared primitives into this module's scope (the in-module accessors
// below reference them: `statusState`/`DEFAULT_WORKFLOW` in `Issue.setStatus`,
// the types in the `Tracker`/`Issue` signatures), AND re-export them so every
// `@/lib/issue` consumer keeps importing them from here under the same name.
import {
  type WorkflowStatus,
  type WorkflowDef,
  type StatusSlug,
  DEFAULT_WORKFLOW,
  canTransition,
  statusState,
} from "@jeswr/solid-task-model/tracker";
export {
  type WorkflowStatus,
  type WorkflowDef,
  type StatusSlug,
  DEFAULT_WORKFLOW,
  canTransition,
  statusState,
};

/**
 * The fixed built-in statuses. Retained as a convenience export (dashboards,
 * boards, and tests that predate configurable workflows read it); it is exactly
 * `DEFAULT_WORKFLOW.statuses` (the SAME array reference). For a tracker's *actual*
 * statuses, read {@link Tracker.workflow}. App-local — not part of the shared
 * model.
 */
export const STATUSES: WorkflowStatus[] = DEFAULT_WORKFLOW.statuses;

/**
 * Automation trigger coded values (#112 P1-3) — `tm:Trigger` individuals. The
 * EVENT half of an event-condition-action rule: WHEN does the rule consider firing.
 *  - `OnStatusChange` — an issue's workflow status changed (incl. via a board move).
 *  - `OnDueDatePassed` — an open issue is past its due date (evaluated on load).
 *  - `OnAllSubtasksDone` — every sub-task of an issue is closed (evaluated on load).
 *  - `OnAssigned` — an issue's assignee changed to a (non-empty) WebID.
 *  - `OnCreated` — an issue was just created.
 */
export const TRIGGERS = [
  "OnStatusChange",
  "OnDueDatePassed",
  "OnAllSubtasksDone",
  "OnAssigned",
  "OnCreated",
] as const;
export type TriggerKind = (typeof TRIGGERS)[number];

/**
 * Automation action coded values (#112 P1-3) — `tm:Action` individuals. The
 * ACTION half: what to DO when a rule fires (and its condition holds). The
 * `tm:actionValue` literal parameterises it (a status slug / priority / WebID /
 * comment text); `CloseIssue` takes no value.
 *  - `SetStatus` — move the issue to the `actionValue` status slug (workflow-guarded).
 *  - `SetPriority` — set the issue's priority to the `actionValue` (high/medium/low).
 *  - `Assign` — set the issue's assignee to the `actionValue` WebID.
 *  - `AddComment` — append a comment with `actionValue` as its body.
 *  - `CloseIssue` — close the issue (resolves to the workflow's terminal status).
 */
export const ACTIONS = [
  "SetStatus",
  "SetPriority",
  "Assign",
  "AddComment",
  "CloseIssue",
] as const;
export type ActionKind = (typeof ACTIONS)[number];

/**
 * A render/eval-friendly snapshot of one automation rule (#112 P1-3), decoupled
 * from the RDF wrapper — the shape the engine evaluates and the config UI edits.
 * The optional `condition` is an `odrl:Constraint` (leftOperand/operator/
 * rightOperand) evaluated by `@jeswr/solid-odrl`'s `constraintSatisfied`.
 */
export interface RuleDef {
  /** The rule node IRI (a `#rule-<uuid>` fragment of the tracker doc). */
  iri: string;
  /** Whether the rule is active (a disabled rule is persisted but never fires). */
  enabled: boolean;
  trigger: TriggerKind;
  action: ActionKind;
  /** The action parameter (status slug / priority / WebID / comment text); none for CloseIssue. */
  actionValue?: string;
  /** Optional ODRL constraint gating the rule. Absent ⇒ the rule always applies on its trigger. */
  condition?: RuleConditionDef;
}

/**
 * The persisted form of a `tm:condition` — a single `odrl:Constraint`. Field names
 * mirror `@jeswr/solid-odrl`'s `OdrlConstraint` so the engine can hand it straight
 * to `constraintSatisfied`. `leftOperand`/`operator` are stored as ODRL IRIs;
 * `rightOperand` as a literal (a single value — list operators are not surfaced in
 * the issue-automation UI). For issue automations the constrained left-operands map
 * to issue facts the engine supplies in the ODRL request `attributes`.
 */
export interface RuleConditionDef {
  /** The ODRL left-operand IRI (e.g. `odrl:purpose`) — what about the issue is constrained. */
  leftOperand: string;
  /** The ODRL operator IRI (e.g. `odrl:eq`). */
  operator: string;
  /** The value the issue's fact is compared against (a single scalar). */
  rightOperand: string;
}

export type IssueType = "initiative" | "epic" | "feature" | "story" | "task" | "bug";
/**
 * Jira-style issue types; carried by rdf:type via per-tracker `#type-*` classes.
 * Ordered coarse→fine — the order also defines the planning hierarchy used by the
 * nesting rules ({@link typeLevel} / {@link canNest}).
 */
export const ISSUE_TYPES: { slug: IssueType; label: string }[] = [
  { slug: "initiative", label: "Initiative" },
  { slug: "epic", label: "Epic" },
  { slug: "feature", label: "Feature" },
  { slug: "story", label: "Story" },
  { slug: "task", label: "Task" },
  { slug: "bug", label: "Bug" },
];

/**
 * The hierarchy level of an issue type: lower numbers are coarser (an Initiative
 * sits above an Epic above a Feature above a Story above a Task/Bug). `bug` shares
 * the leaf level with `task` — both are work items that may nest under a story but
 * take no children of their own.
 *
 * Full ordering: Initiative(0) > Epic(1) > Feature(2) > Story(3) > Task/Bug(4).
 *
 * Drives F5 (type-driven nesting): a parent must be strictly coarser than its
 * child, so an Epic can contain a Feature/Story but not another Epic, a Feature can
 * parent a Story, and a Task/Bug is a leaf.
 */
const TYPE_LEVEL: Record<IssueType, number> = {
  initiative: 0,
  epic: 1,
  feature: 2,
  story: 3,
  task: 4,
  bug: 4,
};

/** Hierarchy depth of an issue type (0 = coarsest). See {@link TYPE_LEVEL}. */
export function typeLevel(type: IssueType): number {
  return TYPE_LEVEL[type];
}

/**
 * Whether an issue of `childType` may be nested under a parent of `parentType`.
 * A parent must be strictly coarser (a lower level number) than its child — so a
 * leaf type (task/bug) can never be a parent, and same-level types never nest.
 */
export function canNest(parentType: IssueType, childType: IssueType): boolean {
  return TYPE_LEVEL[parentType] < TYPE_LEVEL[childType];
}

/** Strip the fragment from an IRI to get its document URL. */
function docOf(iri: string): string {
  const u = new URL(iri);
  u.hash = "";
  return u.toString();
}

/** A comment on an issue: a `wf:Message` linked via `wf:message`. */
export class Comment extends TermWrapper {
  get id(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  markMessage(): void {
    this.types.add(wf("Message"));
  }
  get content(): string | undefined {
    return OptionalFrom.subjectPredicate(this, sioc("content"), LiteralAs.string);
  }
  set content(value: string | undefined) {
    OptionalAs.object(this, sioc("content"), value, LiteralFrom.string);
  }
  get author(): string | undefined {
    return OptionalFrom.subjectPredicate(this, foaf("maker"), NamedNodeAs.string);
  }
  set author(value: string | undefined) {
    OptionalAs.object(this, foaf("maker"), value, NamedNodeFrom.string);
  }
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
  /** WebIDs mentioned in this comment, via `schema:mentions` — live set. */
  get mentions(): Set<string> {
    return SetFrom.subjectPredicate(this, schema("mentions"), NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/** The xsd:decimal datatype IRI — the range of `time:numericDuration` (OWL-Time). */
const XSD_DECIMAL = xsd("decimal");

/**
 * A logged-work entry (F4 time tracking): a `prov:Activity` of `dct:type "worklog"`
 * recording who logged effort against an issue, when, how long, and (optionally) a
 * note. The effort is an OWL-Time `time:Duration` linked via `time:hasDuration`,
 * carrying a `time:numericDuration` (xsd:decimal **seconds**) and a fixed
 * `time:unitType time:unitSecond` — one canonical unit so figures sum without
 * conversion. The entry `prov:used`s the issue it pertains to (the same back-link
 * the F3 activity log uses), so an issue's worklog is "every worklog Activity in
 * its document". Entries are append-only — a fresh node per log, never mutated.
 */
export class Worklog extends TermWrapper {
  get id(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The OWL-Time duration node IRI for this entry (a fragment of the entry). */
  private get durationIri(): string {
    return `${this.value}-dur`;
  }

  /**
   * Stamp this node as a worklog entry against `issueIri`, by `actor`, at `at`,
   * for `seconds` of effort, with an optional `note`. Idempotent for a node minted
   * fresh per log; not a mutator of an existing entry's effort.
   */
  record(opts: { issueIri: string; actor?: string; at: Date; seconds: number; note?: string }): void {
    this.types.add(prov("Activity"));
    OptionalAs.object(this, dct("type"), "worklog", LiteralFrom.string);
    OptionalAs.object(this, prov("used"), opts.issueIri, NamedNodeFrom.string);
    if (opts.actor) OptionalAs.object(this, prov("wasAssociatedWith"), opts.actor, NamedNodeFrom.string);
    OptionalAs.object(this, prov("startedAtTime"), opts.at, LiteralFrom.dateTime);
    if (opts.note) OptionalAs.object(this, dct("description"), opts.note, LiteralFrom.string);

    // The effort is a time:Duration in canonical seconds (xsd:decimal), so all
    // worklog figures across a subtree sum directly with no unit conversion.
    OptionalAs.object(this, time("hasDuration"), this.durationIri, NamedNodeFrom.string);
    const duration = new TermWrapper(this.durationIri, this.dataset, this.factory);
    SetFrom.subjectPredicate(duration, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(time("Duration"));
    OptionalAs.object(duration, time("numericDuration"), [XSD_DECIMAL, String(opts.seconds)], LiteralFrom.datatypeTuple);
    OptionalAs.object(duration, time("unitType"), TIME_UNIT_SECOND, NamedNodeFrom.string);
  }

  /** The issue this entry logs work against (`prov:used`). */
  get issue(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("used"), NamedNodeAs.string);
  }
  /** Who logged the work (`prov:wasAssociatedWith`). */
  get actor(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("wasAssociatedWith"), NamedNodeAs.string);
  }
  /** When the work was logged (`prov:startedAtTime`). */
  get at(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, prov("startedAtTime"), LiteralAs.date);
  }
  /** Free-text note for the entry (`dct:description`). */
  get note(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("description"), LiteralAs.string);
  }
  /**
   * Logged effort in seconds (the `time:Duration`'s `time:numericDuration`), or 0 if
   * absent. The unit is enforced: only a duration whose `time:unitType` is
   * `time:unitSecond` is read. Seconds is the one canonical unit we write and sum, so
   * a duration in any other OWL-Time unit (minutes, hours, …) is **skipped** (returns
   * 0) rather than mis-summed as if it were seconds.
   */
  get seconds(): number {
    const durationIri = OptionalFrom.subjectPredicate(this, time("hasDuration"), NamedNodeAs.string);
    if (!durationIri) return 0;
    const duration = new TermWrapper(durationIri, this.dataset, this.factory);
    const unit = OptionalFrom.subjectPredicate(duration, time("unitType"), NamedNodeAs.string);
    if (unit !== TIME_UNIT_SECOND) return 0; // not seconds → can't be summed as seconds
    return OptionalFrom.subjectPredicate(duration, time("numericDuration"), LiteralAs.number) ?? 0;
  }
}

/** Reads the worklog entries (`prov:Activity` of `dct:type "worklog"`) out of a document. */
export class WorklogSet extends DatasetWrapper {
  /**
   * All worklog entries (`prov:Activity` of `dct:type "worklog"`), newest first
   * (descending time); ties broken by IRI for a stable order. Non-worklog
   * activities sharing the document (F3 status/assignment/link entries) are
   * excluded by the `dct:type "worklog"` gate.
   */
  get entries(): Worklog[] {
    return [...this.instancesOf(prov("Activity"), Worklog)]
      .filter((w) => OptionalFrom.subjectPredicate(w, dct("type"), LiteralAs.string) === "worklog")
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0) || a.id.localeCompare(b.id));
  }
}

/**
 * The kind of change an {@link Activity} records — carried as `dct:type` so the
 * timeline can label it without parsing the used/generated values.
 */
export type ActivityKind = "status" | "assignment" | "link";

/**
 * An immutable PROV-O activity-log entry (F3): one recorded change to an issue.
 * A `prov:Activity` with `prov:startedAtTime` (when), `prov:wasAssociatedWith`
 * (the actor WebID), `dct:type` (the {@link ActivityKind}), and — depending on the
 * kind — `prov:used` (the prior value/class) and `prov:generated` (the new one).
 *
 * Entries are **append-only**: the writer only ever adds a fresh activity node;
 * it never mutates or deletes an existing one. There is no setter that rewrites
 * an entry's predicates after construction beyond the initial `record`.
 */
export class Activity extends TermWrapper {
  get id(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this node as a typed activity with its actor + time. */
  private mark(kind: ActivityKind, actor: string | undefined, at: Date): void {
    this.types.add(prov("Activity"));
    OptionalAs.object(this, dct("type"), kind, LiteralFrom.string);
    if (actor) OptionalAs.object(this, prov("wasAssociatedWith"), actor, NamedNodeFrom.string);
    OptionalAs.object(this, prov("startedAtTime"), at, LiteralFrom.dateTime);
  }

  /**
   * Record a change. `used`/`generated` are the prior and new values: status-class
   * IRIs for a status change, WebIDs for an assignment, or issue IRIs for a link.
   * Empty/undefined endpoints (e.g. the first assignment has no prior assignee)
   * are simply omitted.
   */
  record(opts: { kind: ActivityKind; actor?: string; at: Date; used?: string; generated?: string }): void {
    this.mark(opts.kind, opts.actor, opts.at);
    if (opts.used) OptionalAs.object(this, prov("used"), opts.used, NamedNodeFrom.string);
    if (opts.generated) OptionalAs.object(this, prov("generated"), opts.generated, NamedNodeFrom.string);
  }

  get kind(): ActivityKind | undefined {
    return OptionalFrom.subjectPredicate(this, dct("type"), LiteralAs.string) as ActivityKind | undefined;
  }
  get actor(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("wasAssociatedWith"), NamedNodeAs.string);
  }
  get at(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, prov("startedAtTime"), LiteralAs.date);
  }
  /** Prior value (status class / WebID / issue IRI), if recorded. */
  get used(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("used"), NamedNodeAs.string);
  }
  /** New value (status class / WebID / issue IRI), if recorded. */
  get generated(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("generated"), NamedNodeAs.string);
  }
}

/** Reads the activity entries (`prov:Activity`) out of a parsed log document. */
export class ActivityLog extends DatasetWrapper {
  /**
   * All entries, newest first (descending `prov:startedAtTime`). Ties broken by
   * the entry IRI so the order is STABLE when two entries share a timestamp
   * (rapid changes can collide at millisecond resolution).
   */
  get entries(): Activity[] {
    return [...this.instancesOf(prov("Activity"), Activity)].sort(
      (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0) || a.id.localeCompare(b.id),
    );
  }
}

/**
 * A single issue, mapped onto `wf:Task` data (one resource per issue). State,
 * priority, and labels are all carried by `rdf:type` — the SolidOS model. Priority
 * and label classes are fragments of the tracker document (resolvable); the issue
 * derives their IRIs from its own `wf:tracker` link.
 *
 * **Federated core via `@jeswr/solid-task-model`.** The shared, cross-app fields
 * (title, description, state, assignee, tracker, dates, creator, due-date, rank,
 * and the issue↔issue link family) are read/written through an embedded shared
 * {@link Task} over the SAME subject + dataset, so a task created in solid-issues
 * is byte-compatible with one created in the Pod Manager (and vice-versa). The
 * shared model writes the `wf:description` **+** `dct:description` pair, so a body
 * authored by either app is read by the other. solid-issues' app-local refinements
 * (the configurable status workflow + `#status-*` classes, the `#type-*` /
 * `#priority-*` / `#label-*` subclasses, custom fields, comments, worklog, the
 * activity log, story-point estimate) are layered ON TOP and unchanged.
 */
export class Issue extends TermWrapper {
  get id(): string {
    return this.value;
  }

  /**
   * The shared federated task view over THIS issue's subject + dataset. All
   * cross-app predicates (`dct:title`/`description`/`created`/`modified`/`creator`,
   * `wf:Open`/`wf:Closed` state, `wf:assignee`, `wf:tracker`, `wf:dateDue`,
   * `schema:position`, and the `dct:isPartOf`/`requires`/`relation`/`isReplacedBy`
   * + `prov:wasDerivedFrom` link family) flow through it, so they are written
   * exactly as the Pod Manager and every other suite app write them. Lazily built
   * once and reused; it shares this wrapper's `dataset` + `factory`, so edits land
   * on the same graph the rest of the `Issue` accessors operate on.
   */
  private _shared?: Task;
  private get shared(): Task {
    if (!this._shared) this._shared = new Task(this.value, this.dataset, this.factory);
    return this._shared;
  }

  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The tracker *document* URL (for deriving priority/label class IRIs). */
  private trackerDoc(): string | undefined {
    return this.tracker ? docOf(this.tracker) : undefined;
  }

  get title(): string | undefined {
    return this.shared.title;
  }
  set title(value: string | undefined) {
    this.shared.title = value;
  }

  /**
   * The issue body. Delegated to the shared model, which reads BOTH `wf:description`
   * (solid-issues' historical predicate, preferred) AND `dct:description` (the Pod
   * Manager's), and WRITES BOTH — so a PM-authored body is no longer missed on read,
   * and a solid-issues-authored body is legible in PM. This is the cross-app
   * reconciliation point for the description field.
   */
  get description(): string | undefined {
    return this.shared.description;
  }
  set description(value: string | undefined) {
    this.shared.description = value;
  }

  /**
   * The tracker document this issue belongs to (`wf:tracker`). Same predicate the
   * shared model exposes as {@link Task.project}; named `tracker` here for the app's
   * vocabulary (and the priority/label/status class IRIs are derived from it).
   */
  get tracker(): string | undefined {
    return this.shared.project;
  }
  set tracker(value: string | undefined) {
    this.shared.project = value;
  }

  get created(): Date | undefined {
    return this.shared.created;
  }
  set created(value: Date | undefined) {
    this.shared.created = value;
  }

  get modified(): Date | undefined {
    return this.shared.modified;
  }
  set modified(value: Date | undefined) {
    this.shared.modified = value;
  }

  get creator(): string | undefined {
    return this.shared.creator;
  }
  set creator(value: string | undefined) {
    this.shared.creator = value;
  }

  /** WebID of the assigned agent or group (optional) — `wf:assignee` (shared). */
  get assignee(): string | undefined {
    return this.shared.assignee;
  }
  set assignee(value: string | undefined) {
    this.shared.assignee = value;
  }

  /** Parent issue (this is a sub-task of it), via `dct:isPartOf` (shared). */
  get parent(): string | undefined {
    return this.shared.parent;
  }
  set parent(value: string | undefined) {
    this.shared.parent = value;
  }

  /** Issues this one is blocked by (must be done first), via `dct:requires` — live set (shared). */
  get blockedBy(): Set<string> {
    return this.shared.blockedBy;
  }

  /**
   * Issues this one merely relates to (a non-blocking, symmetric "relates-to"
   * link), via `dct:relation` — live set (shared). The peer should carry the
   * reverse `dct:relation` too (the relation is symmetric); {@link relatedLinks}
   * derives the union for display.
   */
  get relatesTo(): Set<string> {
    return this.shared.relatesTo;
  }

  /**
   * The issue this one duplicates / is superseded by (close-as-duplicate), via
   * `dct:isReplacedBy` (shared). Supersession only — a single canonical successor;
   * the peer surfaces it as `dct:replaces` (derived for display, not stored here).
   */
  get duplicateOf(): string | undefined {
    return this.shared.duplicateOf;
  }
  set duplicateOf(value: string | undefined) {
    this.shared.duplicateOf = value;
  }

  /**
   * The issue this one was cloned from (clone v1), via `prov:wasDerivedFrom`
   * (shared). A single provenance source — the original this issue was derived from.
   */
  get clonedFrom(): string | undefined {
    return this.shared.clonedFrom;
  }
  set clonedFrom(value: string | undefined) {
    this.shared.clonedFrom = value;
  }

  /**
   * Attached file URLs (in the pod), via `wf:attachment` — live set. App-local
   * (not part of the shared federated model); kept on the `Issue` directly.
   */
  get attachments(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("attachment"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Due date (`wf:dateDue`, shared). Stored as xsd:dateTime (well-formed; round-trips). */
  get dateDue(): Date | undefined {
    return this.shared.dueDate;
  }
  set dateDue(value: Date | undefined) {
    this.shared.dueDate = value;
  }

  /**
   * Story-point estimate (`dct:extent` — "size of the resource"). App-local; not
   * part of the shared federated model.
   */
  get estimate(): number | undefined {
    return OptionalFrom.subjectPredicate(this, dct("extent"), LiteralAs.number);
  }
  set estimate(value: number | undefined) {
    OptionalAs.object(this, dct("extent"), value, LiteralFrom.double);
  }

  /** Backlog rank (`schema:position`, shared); lower sorts first. Fractional for cheap reorder. */
  get rank(): number | undefined {
    return this.shared.rank;
  }
  set rank(value: number | undefined) {
    this.shared.rank = value;
  }

  /**
   * Lifecycle state (`rdf:type wf:Open`/`wf:Closed`), delegated to the shared model
   * — identical semantics to solid-issues' historical setter: closing stamps
   * `prov:endedAtTime` once (preserved on re-close), reopening clears it, and
   * `wf:Task` stays typed. The app-local `#status-*` workflow class is layered on
   * top by {@link setStatus} / {@link status}.
   */
  get state(): IssueState {
    return this.shared.state;
  }
  set state(value: IssueState) {
    this.shared.state = value;
  }

  /** When the task was completed (`prov:endedAtTime`, shared); cleared on reopen. */
  get endedAt(): Date | undefined {
    return this.shared.endedAt;
  }
  set endedAt(value: Date | undefined) {
    this.shared.endedAt = value;
  }
  get isOpen(): boolean {
    return this.state === "open";
  }

  private statusClass(slug: StatusSlug, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#status-${slug}` : undefined;
  }
  private statusPrefix(doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#status-` : undefined;
  }
  /**
   * Workflow status (carried by rdf:type via a `#status-<slug>` class). Read
   * directly off the `#status-` prefixed type so it is workflow-agnostic — a
   * custom-status tracker needs no slug list here. Falls back to the open/closed
   * state for an unstatused issue (closed ⇒ "done", open ⇒ "todo").
   */
  get status(): StatusSlug {
    const prefix = this.statusPrefix();
    if (prefix) {
      for (const t of this.types) if (t.startsWith(prefix)) return t.slice(prefix.length);
    }
    return this.state === "closed" ? "done" : "todo";
  }
  /**
   * Set the status. Clears any existing `#status-` class and adds the new one.
   * `terminal` (the open/closed resolution of the new status) keeps `wf:Open` /
   * `wf:Closed` in sync; pass it from the tracker's workflow. Defaults to the
   * built-in resolution (only `done` is terminal) when omitted — back-compat for
   * the fixed three-column board.
   */
  setStatus(slug: StatusSlug, terminal = statusState(DEFAULT_WORKFLOW, slug) === "closed"): void {
    const doc = this.trackerDoc();
    const prefix = this.statusPrefix(doc);
    if (doc && prefix) {
      const types = this.types;
      for (const t of [...types]) if (t.startsWith(prefix)) types.delete(t);
      types.add(this.statusClass(slug, doc)!);
    }
    // Keep wf:Open/wf:Closed (and the open/closed filter) in sync with the status.
    this.state = terminal ? "closed" : "open";
  }
  set status(slug: StatusSlug) {
    this.setStatus(slug);
  }

  private priorityClass(level: Priority, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#priority-${level}` : undefined;
  }
  /**
   * Priority (high/medium/low). solid-issues' app-local source of truth is the
   * tracker-scoped `#priority-<level>` `rdf:type` subclass (resolvable, UI-driving);
   * the SHARED federated model carries it as a flat `schema:priority` string literal
   * (the predicate the Pod Manager reads). To keep the app refinement AND be legible
   * cross-app, the setter writes BOTH and the getter prefers the local subclass,
   * falling back to `schema:priority` (so a PM-authored priority is still read here).
   * This is the one predicate where the two producers genuinely diverge — mirror it
   * when wiring the Pod Manager (have PM also co-write the subclass, or read it).
   */
  get priority(): Priority | undefined {
    const doc = this.trackerDoc();
    if (doc) {
      const types = this.types;
      const local = PRIORITIES.find((level) => types.has(this.priorityClass(level, doc)!));
      if (local) return local;
    }
    // Fall back to the shared `schema:priority` literal (e.g. a PM-authored task).
    return this.shared.priority;
  }
  set priority(level: Priority | undefined) {
    // Shared `schema:priority` literal — written regardless of tracker so a
    // cross-app reader (PM) always sees it; cleared with undefined.
    this.shared.priority = level;
    // App-local `#priority-<level>` subclass — only when the tracker doc is known
    // (the class IRI is a fragment of it). Replaces any existing level, never stacks.
    const doc = this.trackerDoc();
    if (!doc) return;
    const types = this.types;
    for (const l of PRIORITIES) types.delete(this.priorityClass(l, doc)!);
    if (level) types.add(this.priorityClass(level, doc)!);
  }

  private typeClass(slug: IssueType, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#type-${slug}` : undefined;
  }
  /** Issue type (epic/story/task/bug), carried by rdf:type. Defaults to "task". */
  get issueType(): IssueType {
    const doc = this.trackerDoc();
    if (doc) {
      const types = this.types;
      const found = ISSUE_TYPES.find((t) => types.has(this.typeClass(t.slug, doc)!));
      if (found) return found.slug;
    }
    return "task";
  }
  set issueType(slug: IssueType) {
    const doc = this.trackerDoc();
    if (!doc) return;
    const types = this.types;
    for (const t of ISSUE_TYPES) types.delete(this.typeClass(t.slug, doc)!);
    types.add(this.typeClass(slug, doc)!);
  }

  private labelPrefix(doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#label-` : undefined;
  }
  /** Label slugs applied to this issue (the class fragment after `#label-`). */
  get labels(): string[] {
    const prefix = this.labelPrefix();
    if (!prefix) return [];
    return [...this.types].filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
  }
  set labels(slugs: string[]) {
    const prefix = this.labelPrefix();
    if (!prefix) return;
    const types = this.types;
    for (const t of [...types]) if (t.startsWith(prefix)) types.delete(t);
    for (const s of slugs) types.add(`${prefix}${s}`);
  }

  private componentPrefix(doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#component-` : undefined;
  }
  /**
   * Component slugs applied to this issue (the class fragment after
   * `#component-`). A second categorization dimension — areas/modules — carried by
   * `rdf:type` exactly like {@link labels}, just under the `#Component` parent.
   */
  get components(): string[] {
    const prefix = this.componentPrefix();
    if (!prefix) return [];
    return [...this.types].filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
  }
  set components(slugs: string[]) {
    const prefix = this.componentPrefix();
    if (!prefix) return;
    const types = this.types;
    for (const t of [...types]) if (t.startsWith(prefix)) types.delete(t);
    for (const s of slugs) types.add(`${prefix}${s}`);
  }

  /**
   * The version-class IRI for a slug, derived from the issue's own tracker link
   * (same derivation as priority/label/component classes).
   */
  private versionIri(slug: string, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#version-${slug}` : undefined;
  }
  /** Read the version slug carried by a single-valued version predicate. */
  private readVersion(predicate: string, doc = this.trackerDoc()): string | undefined {
    const prefix = doc ? `${doc}#version-` : undefined;
    if (!prefix) return undefined;
    const iri = OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
    return iri?.startsWith(prefix) ? iri.slice(prefix.length) : undefined;
  }
  /** Write (or clear, with undefined) a single-valued version predicate. */
  private writeVersion(predicate: string, slug: string | undefined, doc = this.trackerDoc()): void {
    if (!doc) return;
    OptionalAs.object(this, predicate, slug === undefined ? undefined : this.versionIri(slug, doc), NamedNodeFrom.string);
  }
  /**
   * The version in which the issue was observed (`wf:affectsVersion`). A single
   * slug pointing at a `#version-*` `schema:SoftwareVersion` declared on the
   * tracker, or undefined.
   */
  get affectsVersion(): string | undefined {
    return this.readVersion(wf("affectsVersion"));
  }
  set affectsVersion(slug: string | undefined) {
    this.writeVersion(wf("affectsVersion"), slug);
  }
  /**
   * The version in which the issue is targeted to be fixed (`wf:fixVersion`,
   * Jira's "fix version"). A single tracker-version slug, or undefined.
   */
  get fixVersion(): string | undefined {
    return this.readVersion(wf("fixVersion"));
  }
  set fixVersion(slug: string | undefined) {
    this.writeVersion(wf("fixVersion"), slug);
  }

  /** Read a custom-field value (select fields yield the option IRI). */
  getField(def: FieldDef): FieldValue | undefined {
    switch (def.type) {
      case "number":
        return OptionalFrom.subjectPredicate(this, def.iri, LiteralAs.number);
      case "date":
        return OptionalFrom.subjectPredicate(this, def.iri, LiteralAs.date);
      case "select":
        return OptionalFrom.subjectPredicate(this, def.iri, NamedNodeAs.string);
      default: // text, url — both read as strings
        return OptionalFrom.subjectPredicate(this, def.iri, LiteralAs.string);
    }
  }

  /** Write (or clear, with undefined) a custom-field value. */
  setField(def: FieldDef, value: FieldValue | undefined): void {
    switch (def.type) {
      case "number":
        OptionalAs.object(this, def.iri, value as number | undefined, LiteralFrom.double);
        break;
      case "date":
        OptionalAs.object(this, def.iri, value as Date | undefined, LiteralFrom.dateTime);
        break;
      case "select":
        OptionalAs.object(this, def.iri, value as string | undefined, NamedNodeFrom.string);
        break;
      case "url":
        // Enforced at the data layer, not just the form: an unsafe scheme
        // (javascript:, data:, …) is never serialised into the pod.
        OptionalAs.object(
          this,
          def.iri,
          value === undefined ? undefined : safeHttpUrl(String(value)),
          LiteralFrom.anyUriString,
        );
        break;
      default:
        OptionalAs.object(this, def.iri, value as string | undefined, LiteralFrom.string);
    }
  }

  /** Live set of comment objects linked via `wf:message`. */
  get messages(): Set<Comment> {
    return SetFrom.subjectPredicate(this, wf("message"), TermAs.instance(Comment), TermFrom.instance);
  }
  /** Comments, oldest first. */
  get comments(): Comment[] {
    return [...this.messages].sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0));
  }

  /**
   * F4 time tracking: the worklog entries stored in this issue's own document
   * (every `prov:Activity` typed `dct:type "worklog"`), newest first. Append a
   * fresh entry with {@link logWork}; entries are immutable thereafter.
   */
  get worklog(): Worklog[] {
    return new WorklogSet(this.dataset, this.factory).entries.filter((w) => !w.issue || w.issue === this.value);
  }

  /** Total logged effort on THIS issue (own worklog only), in seconds. */
  get loggedSeconds(): number {
    return this.worklog.reduce((sum, w) => sum + w.seconds, 0);
  }

  /**
   * Append a worklog entry (F4) to this issue's document. The entry is a new
   * `prov:Activity` node — existing entries are never touched (append-only). The
   * caller supplies a unique fragment IRI (e.g. `${url}#work-<uuid>`).
   */
  logWork(entryIri: string, opts: { actor?: string; at: Date; seconds: number; note?: string }): Worklog {
    const entry = new Worklog(entryIri, this.dataset, this.factory);
    entry.record({ issueIri: this.value, actor: opts.actor, at: opts.at, seconds: opts.seconds, note: opts.note });
    return entry;
  }
}

/** A label definition on the tracker: slug + human label. */
export interface LabelDef {
  slug: string;
  label: string;
}

/**
 * A component definition on the tracker: slug + human label. The same shape as
 * {@link LabelDef} — a component is just a second categorization dimension
 * (areas/modules), declared identically (an `rdfs:Class` under `#Component`).
 */
export interface ComponentDef {
  slug: string;
  label: string;
}

/**
 * A version (release) definition on the tracker. Each is a
 * `schema:SoftwareVersion` fragment of the tracker doc, ordered by
 * `schema:position` (lower sorts first — the declared release order), with an
 * optional release date and a released/unreleased flag (Jira's "release" toggle).
 */
export interface VersionDef {
  iri: string;
  slug: string;
  label: string;
  /** Declared order (lower first). */
  position: number;
  /** The release date, if set. */
  releaseDate?: Date;
  /** Whether the version has been released (vs. an upcoming/unreleased one). */
  released: boolean;
}

/**
 * WIP (work-in-progress) limits for one board column (#111 P1-1). Persisted on the
 * column's `#status-<slug>` `wf:State` class as `tm:wipMin`/`tm:wipMax`
 * (xsd:nonNegativeInteger). Both are optional: `min` is a soft floor (a column
 * under it is starved), `max` a soft ceiling (over it is overloaded). The board
 * surfaces these as advisory warnings and the move-guard warns (never blocks) on a
 * drop that would push a column over its `max` — consistent with the dependency
 * warn-don't-block stance.
 */
export interface WipLimit {
  /** Soft minimum open count for the column (amber when under). */
  min?: number;
  /** Soft maximum open count for the column (red when over; warns on a move). */
  max?: number;
}

/** Per-column WIP limits keyed by status slug (#111). Absent slug ⇒ no limit. */
export type WipLimits = Record<string, WipLimit>;

/** Custom-field value types (Jira/Monday column types). */
export type FieldType = "text" | "number" | "date" | "url" | "select";
export const FIELD_TYPES: { slug: FieldType; label: string }[] = [
  { slug: "text", label: "Text" },
  { slug: "number", label: "Number" },
  { slug: "date", label: "Date" },
  { slug: "url", label: "Link" },
  { slug: "select", label: "Select" },
];

/** One choice of a select field — a `skos:Concept` in the field's scheme. */
export interface FieldOption {
  iri: string;
  label: string;
}

/**
 * A custom field: an `rdf:Property` minted as a fragment of the tracker doc
 * (so the IRI dereferences), typed by its `rdfs:range`. Select fields double
 * as a `skos:ConceptScheme` whose options are `skos:Concept`s.
 */
export interface FieldDef {
  iri: string;
  slug: string;
  label: string;
  type: FieldType;
  options: FieldOption[];
}

/** A custom-field value; select fields hold the chosen option's IRI. */
export type FieldValue = string | number | Date;

/**
 * A saved view persisted on the tracker (shareable, cross-device): its stable
 * IRI (a fragment of the tracker doc), display name, and the serialised
 * query+layout payload (an opaque JSON string the app interprets).
 */
export interface SavedViewDef {
  iri: string;
  name: string;
  /** The serialised query+layout (JSON). Opaque to the data layer. */
  payload: string;
}

/**
 * The URL if it parses with an http(s) scheme, else undefined. Pod data is
 * untrusted input: a stored `javascript:` URL must never become a clickable
 * link, and we reject it on write too.
 */
export function safeHttpUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** `rdfs:range` per field type (xsd datatypes; selects range over concepts). */
const FIELD_RANGES: Record<FieldType, string> = {
  text: xsd("string"),
  number: xsd("double"),
  date: xsd("dateTime"),
  url: xsd("anyURI"),
  select: skos("Concept"),
};

const fieldTypeOfRange = (range: string | undefined): FieldType =>
  (Object.keys(FIELD_RANGES) as FieldType[]).find((t) => FIELD_RANGES[t] === range) ?? "text";

/** Shared slug rule for fragment identifiers minted from display names. */
const fragmentSlug = (label: string): string =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Whether `value` is one of the known trigger coded-value short names. */
const isTrigger = (value: string): value is TriggerKind => (TRIGGERS as readonly string[]).includes(value);
/** Whether `value` is one of the known action coded-value short names. */
const isAction = (value: string): value is ActionKind => (ACTIONS as readonly string[]).includes(value);

/**
 * One automation rule (#112 P1-3): a `tm:Rule` node carrying a `tm:trigger` coded
 * value, an optional `tm:condition` (an `odrl:Constraint`), a `tm:action` coded
 * value, and a `tm:actionValue` literal. Trigger/action coded values are stored as
 * `tm:`-namespace IRIs (`tm:OnStatusChange`, `tm:SetStatus`, …) and surfaced as
 * their short names. The condition node is a fragment of the rule (`<rule>-cond`)
 * so it is self-contained and removed with the rule. `enabled` defaults to true —
 * a rule with no explicit flag is active.
 */
export class Rule extends TermWrapper {
  get iri(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** The condition node IRI (a fragment of this rule). */
  private get conditionIri(): string {
    return `${this.value}-cond`;
  }

  markRule(): void {
    this.types.add(tm("Rule"));
  }

  /** Whether the rule is active. Absent flag ⇒ active (the common case). */
  get enabled(): boolean {
    return OptionalFrom.subjectPredicate(this, tm("enabled"), LiteralAs.boolean) ?? true;
  }
  set enabled(value: boolean) {
    OptionalAs.object(this, tm("enabled"), value, LiteralFrom.boolean);
  }

  /** The trigger coded value (short name), or undefined if unset/unknown. */
  get trigger(): TriggerKind | undefined {
    const iri = OptionalFrom.subjectPredicate(this, tm("trigger"), NamedNodeAs.string);
    if (!iri || !iri.startsWith(TM)) return undefined;
    const local = iri.slice(TM.length);
    return isTrigger(local) ? local : undefined;
  }
  set trigger(value: TriggerKind | undefined) {
    OptionalAs.object(this, tm("trigger"), value === undefined ? undefined : tm(value), NamedNodeFrom.string);
  }

  /** The action coded value (short name), or undefined if unset/unknown. */
  get action(): ActionKind | undefined {
    const iri = OptionalFrom.subjectPredicate(this, tm("action"), NamedNodeAs.string);
    if (!iri || !iri.startsWith(TM)) return undefined;
    const local = iri.slice(TM.length);
    return isAction(local) ? local : undefined;
  }
  set action(value: ActionKind | undefined) {
    OptionalAs.object(this, tm("action"), value === undefined ? undefined : tm(value), NamedNodeFrom.string);
  }

  /** The action parameter literal (status slug / priority / WebID / comment text). */
  get actionValue(): string | undefined {
    return OptionalFrom.subjectPredicate(this, tm("actionValue"), LiteralAs.string);
  }
  set actionValue(value: string | undefined) {
    OptionalAs.object(this, tm("actionValue"), value, LiteralFrom.string);
  }

  /**
   * The rule's ODRL constraint condition, or undefined. Read off the `tm:condition`
   * node's `odrl:leftOperand`/`odrl:operator`/`odrl:rightOperand`. A partial
   * condition (any of the three missing) is treated as absent (defensive against
   * corrupt/hostile pod data — a half-written constraint never silently passes).
   */
  get condition(): RuleConditionDef | undefined {
    const node = OptionalFrom.subjectPredicate(this, tm("condition"), NamedNodeAs.string);
    if (!node) return undefined;
    const cond = new TermWrapper(node, this.dataset, this.factory);
    const leftOperand = OptionalFrom.subjectPredicate(cond, odrl("leftOperand"), NamedNodeAs.string);
    const operator = OptionalFrom.subjectPredicate(cond, odrl("operator"), NamedNodeAs.string);
    const rightOperand = OptionalFrom.subjectPredicate(cond, odrl("rightOperand"), LiteralAs.string);
    if (!leftOperand || !operator || rightOperand === undefined) return undefined;
    return { leftOperand, operator, rightOperand };
  }
  set condition(value: RuleConditionDef | undefined) {
    // Clear any prior condition node + link first (idempotent overwrite).
    for (const q of [...this.dataset.match(this.factory.namedNode(this.conditionIri))]) this.dataset.delete(q);
    if (!value) {
      OptionalAs.object(this, tm("condition"), undefined, NamedNodeFrom.string);
      return;
    }
    const node = new TermWrapper(this.conditionIri, this.dataset, this.factory);
    SetFrom.subjectPredicate(node, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(odrl("Constraint"));
    OptionalAs.object(node, odrl("leftOperand"), value.leftOperand, NamedNodeFrom.string);
    OptionalAs.object(node, odrl("operator"), value.operator, NamedNodeFrom.string);
    OptionalAs.object(node, odrl("rightOperand"), value.rightOperand, LiteralFrom.string);
    OptionalAs.object(this, tm("condition"), this.conditionIri, NamedNodeFrom.string);
  }

  /**
   * Read the rule as a plain {@link RuleDef}, or undefined when it is not a
   * well-formed rule (missing a trigger or action — a half-written rule never
   * fires). A self-contained snapshot the engine + UI consume.
   */
  toDef(): RuleDef | undefined {
    const trigger = this.trigger;
    const action = this.action;
    if (!trigger || !action) return undefined;
    return {
      iri: this.value,
      enabled: this.enabled,
      trigger,
      action,
      actionValue: this.actionValue,
      condition: this.condition,
    };
  }
}

/**
 * The tracker configuration node (`wf:Tracker`). Holds the title, the priority and
 * label category classes (declared via `wf:issueCategory`, defined as fragments of
 * the tracker document), and the assignee group (`wf:assigneeGroup` → `vcard:Group`).
 */
export class Tracker extends TermWrapper {
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  private get doc(): string {
    return docOf(this.value);
  }
  private get categories(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("issueCategory"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  /** Define a category class (e.g. a priority or label) as a fragment of the doc. */
  private defineClass(fragment: string, label: string, parentFragment?: string): string {
    const iri = `${this.doc}#${fragment}`;
    const klass = new TermWrapper(iri, this.dataset, this.factory);
    SetFrom.subjectPredicate(klass, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(rdfs("Class"));
    OptionalAs.object(klass, rdfs("label"), label, LiteralFrom.string);
    if (parentFragment) {
      OptionalAs.object(klass, rdfs("subClassOf"), `${this.doc}#${parentFragment}`, NamedNodeFrom.string);
    }
    this.categories.add(iri);
    return iri;
  }

  private statusIri(slug: string): string {
    return `${this.doc}#status-${slug}`;
  }

  /**
   * Define a workflow status class. It is a `wf:State` typed `rdfs:Class` whose
   * open/closed **resolution** is carried as `rdfs:subClassOf wf:Open|wf:Closed`
   * (terminal ⇒ Closed). An issue typed with this class therefore *inherits*
   * `wf:Open`/`wf:Closed` semantically — but the writer also stamps the issue with
   * the concrete `wf:Open`/`wf:Closed` type so the SHACL exactly-one rule holds
   * without an OWL reasoner. A non-terminal state additionally declares its
   * allowed transition targets via `wf:allowedTransitions`.
   */
  private defineStatus(slug: string, label: string, terminal: boolean, position: number, targets: string[] = []): void {
    const iri = this.statusIri(slug);
    const klass = new TermWrapper(iri, this.dataset, this.factory);
    const types = SetFrom.subjectPredicate(klass, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    types.add(rdfs("Class"));
    types.add(wf("State"));
    OptionalAs.object(klass, rdfs("label"), label, LiteralFrom.string);
    OptionalAs.object(klass, rdfs("subClassOf"), terminal ? STATE.Closed : STATE.Open, NamedNodeFrom.string);
    // The declared column order is meaningful (the board/list layout); persist it
    // via schema:position (lower sorts first) — the same predicate used for issue rank.
    OptionalAs.object(klass, schema("position"), position, LiteralFrom.double);
    const allowed = SetFrom.subjectPredicate(klass, wf("allowedTransitions"), NamedNodeAs.string, NamedNodeFrom.string);
    for (const t of targets) allowed.add(this.statusIri(t));
  }

  /** Remove a status class and its transition edges (issue type-quads are untouched). */
  private removeStatus(slug: string): void {
    const iri = this.statusIri(slug);
    for (const q of [...this.dataset.match(this.factory.namedNode(iri))]) this.dataset.delete(q);
  }

  /**
   * Read the tracker's configured workflow. Statuses are the declared `wf:State`
   * classes (`#status-*`) in the document's transition graph, ordered with the
   * `wf:initialState` first; transitions come from each state's
   * `wf:allowedTransitions`. A tracker with no declared statuses yields the
   * {@link DEFAULT_WORKFLOW}, so consumers always get a usable workflow.
   */
  get workflow(): WorkflowDef {
    const prefix = `${this.doc}#status-`;
    const nn = this.factory.namedNode.bind(this.factory);
    const slugs = new Set<string>();
    for (const q of this.dataset.match(null, nn(rdf("type")), nn(wf("State")))) {
      if (q.subject.value.startsWith(prefix)) slugs.add(q.subject.value.slice(prefix.length));
    }
    if (slugs.size === 0) return DEFAULT_WORKFLOW;

    const initial = OptionalFrom.subjectPredicate(this, wf("initialState"), NamedNodeAs.string);
    const initialSlug = initial?.startsWith(prefix) ? initial.slice(prefix.length) : undefined;
    const positionOf = (slug: string): number =>
      OptionalFrom.subjectPredicate(new TermWrapper(this.statusIri(slug), this.dataset, this.factory), schema("position"), LiteralAs.number) ??
      Number.MAX_SAFE_INTEGER;
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
      const supers = SetFrom.subjectPredicate(klass, rdfs("subClassOf"), NamedNodeAs.string, NamedNodeFrom.string);
      return {
        slug,
        label: OptionalFrom.subjectPredicate(klass, rdfs("label"), LiteralAs.string) ?? slug,
        terminal: supers.has(STATE.Closed),
      };
    });
    const transitions: Record<string, string[]> = {};
    for (const slug of ordered) {
      const klass = new TermWrapper(this.statusIri(slug), this.dataset, this.factory);
      const targets = SetFrom.subjectPredicate(klass, wf("allowedTransitions"), NamedNodeAs.string, NamedNodeFrom.string);
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
   * resolves to wf:Open or wf:Closed, so the issue model and SHACL are unchanged.
   * At least one status is required, and exactly one initial state results.
   */
  defineWorkflow(workflow: WorkflowDef): void {
    if (workflow.statuses.length === 0) throw new Error("A workflow needs at least one status.");
    // Clear the previously-declared statuses (the union of old + new slugs), so
    // a redefinition that drops a status leaves no orphan #status- class behind.
    for (const slug of this.workflow.statuses.map((s) => s.slug)) this.removeStatus(slug);
    for (const slug of workflow.statuses.map((s) => s.slug)) this.removeStatus(slug);
    workflow.statuses.forEach((s, i) => {
      this.defineStatus(s.slug, s.label, s.terminal, i, workflow.transitions[s.slug] ?? []);
    });
    OptionalAs.object(this, wf("initialState"), this.statusIri(workflow.statuses[0].slug), NamedNodeFrom.string);
  }

  /**
   * Per-column WIP limits (#111 P1-1), keyed by status slug. Read off each
   * `#status-<slug>` `wf:State` class's `tm:wipMin`/`tm:wipMax`. A slug with
   * neither bound is omitted entirely, so the map only carries columns the user
   * has actually constrained. A negative or non-finite stored value is ignored
   * (pod data is untrusted — a hostile/corrupt bound never reaches the UI).
   */
  get wipLimits(): WipLimits {
    const out: WipLimits = {};
    const prefix = `${this.doc}#status-`;
    const nn = this.factory.namedNode.bind(this.factory);
    for (const q of this.dataset.match(null, nn(rdf("type")), nn(wf("State")))) {
      const iri = q.subject.value;
      if (!iri.startsWith(prefix)) continue;
      const klass = new TermWrapper(iri, this.dataset, this.factory);
      const sane = (n: number | undefined): number | undefined =>
        n !== undefined && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
      const min = sane(OptionalFrom.subjectPredicate(klass, tm("wipMin"), LiteralAs.number));
      const max = sane(OptionalFrom.subjectPredicate(klass, tm("wipMax"), LiteralAs.number));
      if (min === undefined && max === undefined) continue;
      out[iri.slice(prefix.length)] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    }
    return out;
  }

  /**
   * Set (or clear) the WIP limits on one column's `#status-<slug>` `wf:State`
   * class. `undefined`/negative/non-integer bounds clear that bound; a valid
   * non-negative integer is floored and written as `tm:wipMin`/`tm:wipMax`. A
   * no-op when the status class does not exist (a typo'd slug never mints a stray
   * node). Idempotent — re-asserting the same bounds rewrites them in place.
   */
  setWipLimit(slug: string, limit: WipLimit): void {
    const iri = this.statusIri(slug);
    // Only constrain a column the workflow actually declares — guard against a
    // stray slug minting a State-less node carrying only WIP bounds.
    const klass = new TermWrapper(iri, this.dataset, this.factory);
    const types = SetFrom.subjectPredicate(klass, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    if (!types.has(wf("State"))) return;
    const clean = (n: number | undefined): number | undefined =>
      n !== undefined && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
    const min = clean(limit.min);
    const max = clean(limit.max);
    OptionalAs.object(klass, tm("wipMin"), min === undefined ? undefined : [xsd("nonNegativeInteger"), String(min)], LiteralFrom.datatypeTuple);
    OptionalAs.object(klass, tm("wipMax"), max === undefined ? undefined : [xsd("nonNegativeInteger"), String(max)], LiteralFrom.datatypeTuple);
  }

  /** The trusted prefix for a rule node — a `#rule-` fragment of THIS tracker doc. */
  private get rulePrefix(): string {
    return `${this.doc}#rule-`;
  }
  /** Live set of automation-rule node IRIs declared on the tracker (`tm:rule`). */
  private get ruleIris(): Set<string> {
    return SetFrom.subjectPredicate(this, tm("rule"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /**
   * Whether `iri` is a trusted rule node — a `#rule-` fragment of THIS tracker
   * document. A `tm:rule` link is untrusted pod data; mutating/clearing a target
   * outside this shape could wipe unrelated config (mirrors the saved-view guard),
   * so define/remove operate ONLY on this trusted shape and read SKIPS anything else.
   */
  private isOwnRule(iri: string): boolean {
    return iri.startsWith(this.rulePrefix);
  }

  /**
   * The automation rules declared on the tracker (#112 P1-3), via `tm:rule` → a
   * `tm:Rule` node. Only trusted `#rule-` fragments of this doc are read, and a
   * malformed rule (no trigger/action) is skipped. Order is stable by IRI.
   */
  get rules(): RuleDef[] {
    const out: RuleDef[] = [];
    for (const iri of this.ruleIris) {
      if (!this.isOwnRule(iri)) continue;
      const def = new Rule(iri, this.dataset, this.factory).toDef();
      if (def) out.push(def);
    }
    return out.sort((a, b) => a.iri.localeCompare(b.iri));
  }

  /**
   * Define (or overwrite by IRI) an automation rule. With no `iri` a fresh
   * `#rule-<uuid>` node is minted; an existing trusted IRI overwrites that rule
   * (edit). A supplied IRI that is NOT a trusted `#rule-` fragment of this doc is
   * ignored and a fresh one minted, so a caller can never coax this into clobbering
   * the tracker node or another config node. The node's prior triples (incl. its
   * condition fragment) are cleared first — idempotent overwrite. Returns the def.
   */
  defineRule(def: Omit<RuleDef, "iri"> & { iri?: string }): RuleDef {
    const iri = def.iri && this.isOwnRule(def.iri) ? def.iri : `${this.rulePrefix}${crypto.randomUUID()}`;
    const nn = this.factory.namedNode.bind(this.factory);
    // Clear the rule node AND its condition fragment so an edit leaves no stale
    // condition/value behind.
    for (const q of [...this.dataset.match(nn(`${iri}-cond`))]) this.dataset.delete(q);
    for (const q of [...this.dataset.match(nn(iri))]) this.dataset.delete(q);
    const rule = new Rule(iri, this.dataset, this.factory);
    rule.markRule();
    rule.enabled = def.enabled;
    rule.trigger = def.trigger;
    rule.action = def.action;
    rule.actionValue = def.actionValue;
    rule.condition = def.condition;
    this.ruleIris.add(iri);
    return { ...def, iri };
  }

  /**
   * Remove an automation rule (its node, its condition fragment, and the tracker's
   * `tm:rule` link). The link is always dropped; the node's triples are cleared
   * ONLY for a trusted `#rule-` fragment — so a hostile link can be unlinked
   * without wiping the target's unrelated triples (mirrors {@link removeSavedView}).
   */
  removeRule(iri: string): void {
    this.ruleIris.delete(iri);
    if (!this.isOwnRule(iri)) return;
    const nn = this.factory.namedNode.bind(this.factory);
    for (const q of [...this.dataset.match(nn(`${iri}-cond`))]) this.dataset.delete(q);
    for (const q of [...this.dataset.match(nn(iri))]) this.dataset.delete(q);
  }

  /** Write the fixed tracker configuration (type, issue class, statuses, priorities). */
  configure(title: string): void {
    this.types.add(wf("Tracker"));
    this.title = title;
    OptionalAs.object(this, wf("issueClass"), wf("Task"), NamedNodeFrom.string);
    // Workflow statuses (the default To Do → In Progress → Done board).
    this.defineWorkflow(DEFAULT_WORKFLOW);
    // Priority dimension (#Priority parent + the three ordered priorities).
    this.defineClass("Priority", "Priority");
    this.defineClass("priority-high", "High", "Priority");
    this.defineClass("priority-medium", "Medium", "Priority");
    this.defineClass("priority-low", "Low", "Priority");
    this.defineClass("Label", "Label");
    // Component dimension (#Component parent — areas/modules, like #Label).
    this.defineClass("Component", "Component");
    // Issue-type dimension (#Type parent + epic/story/task/bug).
    this.defineClass("Type", "Type");
    for (const t of ISSUE_TYPES) this.defineClass(`type-${t.slug}`, t.label, "Type");
  }

  /** Label definitions (subclasses of `#Label`), as slug + human label. */
  get labelDefs(): LabelDef[] {
    const out: LabelDef[] = [];
    const prefix = `${this.doc}#label-`;
    for (const iri of this.categories) {
      if (iri.startsWith(prefix)) {
        const klass = new TermWrapper(iri, this.dataset, this.factory);
        out.push({
          slug: iri.slice(prefix.length),
          label: OptionalFrom.subjectPredicate(klass, rdfs("label"), LiteralAs.string) ?? iri.slice(prefix.length),
        });
      }
    }
    return out;
  }

  /** Define (or relabel) a label, returning its slug. */
  defineLabel(label: string): string {
    const slug = fragmentSlug(label);
    this.defineClass(`label-${slug}`, label, "Label");
    return slug;
  }

  /** Component definitions (subclasses of `#Component`), as slug + human label. */
  get componentDefs(): ComponentDef[] {
    const out: ComponentDef[] = [];
    const prefix = `${this.doc}#component-`;
    for (const iri of this.categories) {
      if (iri.startsWith(prefix)) {
        const klass = new TermWrapper(iri, this.dataset, this.factory);
        out.push({
          slug: iri.slice(prefix.length),
          label: OptionalFrom.subjectPredicate(klass, rdfs("label"), LiteralAs.string) ?? iri.slice(prefix.length),
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Define (or relabel) a component, returning its slug. */
  defineComponent(label: string): string {
    const slug = fragmentSlug(label);
    this.defineClass(`component-${slug}`, label, "Component");
    return slug;
  }

  /**
   * Remove a component class. The category-link and the class triples are dropped;
   * `rdf:type` quads on issues that reference it are left untouched (a stale
   * component slug simply stops resolving, exactly like an undefined label).
   */
  removeComponent(slug: string): void {
    const iri = `${this.doc}#component-${slug}`;
    this.categories.delete(iri);
    for (const q of [...this.dataset.match(this.factory.namedNode(iri))]) this.dataset.delete(q);
  }

  private versionIri(slug: string): string {
    return `${this.doc}#version-${slug}`;
  }

  /**
   * Version (release) definitions, ordered by `schema:position` (lower first —
   * the declared release order), then by label. Each is a
   * `schema:SoftwareVersion` fragment of the tracker doc.
   */
  get versionDefs(): VersionDef[] {
    const prefix = `${this.doc}#version-`;
    const nn = this.factory.namedNode.bind(this.factory);
    const out: VersionDef[] = [];
    for (const quad of this.dataset.match(null, nn(rdf("type")), nn(schema("SoftwareVersion")))) {
      const iri = quad.subject.value;
      if (!iri.startsWith(prefix)) continue;
      const node = new TermWrapper(iri, this.dataset, this.factory);
      out.push({
        iri,
        slug: iri.slice(prefix.length),
        label: OptionalFrom.subjectPredicate(node, rdfs("label"), LiteralAs.string) ?? iri.slice(prefix.length),
        position: OptionalFrom.subjectPredicate(node, schema("position"), LiteralAs.number) ?? Number.MAX_SAFE_INTEGER,
        releaseDate: OptionalFrom.subjectPredicate(node, schema("releaseDate"), LiteralAs.date),
        released: OptionalFrom.subjectPredicate(node, RELEASED, LiteralAs.boolean) ?? false,
      });
    }
    return out.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  }

  /**
   * Define (or redefine) a version. Redefining a slug clears the node first so a
   * dropped release date / flag never lingers. `position` defaults to the end of
   * the current ordered list (next slot) so a freshly-added version sorts last
   * until reordered. Returns the stored definition.
   */
  defineVersion(
    label: string,
    opts: { position?: number; releaseDate?: Date; released?: boolean } = {},
  ): VersionDef {
    const slug = fragmentSlug(label);
    const iri = this.versionIri(slug);
    // Default position: append after the current highest declared position.
    const existing = this.versionDefs;
    const prior = existing.find((v) => v.slug === slug);
    const maxPos = existing.reduce((m, v) => (v.position < Number.MAX_SAFE_INTEGER ? Math.max(m, v.position) : m), -1);
    const position = opts.position ?? prior?.position ?? maxPos + 1;
    // Idempotent overwrite: clear the node's prior triples.
    for (const q of [...this.dataset.match(this.factory.namedNode(iri))]) this.dataset.delete(q);
    const node = new TermWrapper(iri, this.dataset, this.factory);
    SetFrom.subjectPredicate(node, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(schema("SoftwareVersion"));
    OptionalAs.object(node, rdfs("label"), label, LiteralFrom.string);
    OptionalAs.object(node, schema("position"), position, LiteralFrom.double);
    OptionalAs.object(node, schema("releaseDate"), opts.releaseDate, LiteralFrom.dateTime);
    OptionalAs.object(node, RELEASED, opts.released ?? false, LiteralFrom.boolean);
    return { iri, slug, label, position, releaseDate: opts.releaseDate, released: opts.released ?? false };
  }

  /**
   * Remove a version definition (its node triples). Issue
   * `wf:affectsVersion`/`wf:fixVersion` links to it are left in place — a removed
   * version simply stops resolving, like an undefined label/component.
   */
  removeVersion(slug: string): void {
    for (const q of [...this.dataset.match(this.factory.namedNode(this.versionIri(slug)))]) this.dataset.delete(q);
  }

  /**
   * Define (or redefine) a custom field. Select options get `-opt-` in their
   * fragment so an option IRI can never collide with another field's IRI.
   */
  defineField(label: string, type: FieldType, optionLabels: string[] = []): FieldDef {
    const slug = fragmentSlug(label);
    const iri = `${this.doc}#field-${slug}`;
    // Redefinition must not leave stale triples behind (old options, an old
    // range, a leftover ConceptScheme type) — clear the slug and start fresh.
    this.removeField(slug);
    const prop = new TermWrapper(iri, this.dataset, this.factory);
    SetFrom.subjectPredicate(prop, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(rdf("Property"));
    OptionalAs.object(prop, rdfs("label"), label, LiteralFrom.string);
    OptionalAs.object(prop, rdfs("domain"), wf("Task"), NamedNodeFrom.string);
    OptionalAs.object(prop, rdfs("range"), FIELD_RANGES[type], NamedNodeFrom.string);

    const options: FieldOption[] = [];
    if (type === "select") {
      SetFrom.subjectPredicate(prop, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(skos("ConceptScheme"));
      for (const optionLabel of optionLabels) {
        const optionIri = `${iri}-opt-${fragmentSlug(optionLabel)}`;
        const concept = new TermWrapper(optionIri, this.dataset, this.factory);
        SetFrom.subjectPredicate(concept, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(skos("Concept"));
        OptionalAs.object(concept, skos("prefLabel"), optionLabel, LiteralFrom.string);
        OptionalAs.object(concept, skos("inScheme"), iri, NamedNodeFrom.string);
        options.push({ iri: optionIri, label: optionLabel });
      }
    }
    return { iri, slug, label, type, options };
  }

  /** All custom-field definitions (properties under `#field-`), label order. */
  get fieldDefs(): FieldDef[] {
    const prefix = `${this.doc}#field-`;
    const nn = this.factory.namedNode.bind(this.factory);
    const out: FieldDef[] = [];
    for (const quad of this.dataset.match(null, nn(rdf("type")), nn(rdf("Property")))) {
      const iri = quad.subject.value;
      if (!iri.startsWith(prefix)) continue;
      const prop = new TermWrapper(iri, this.dataset, this.factory);
      const type = fieldTypeOfRange(OptionalFrom.subjectPredicate(prop, rdfs("range"), NamedNodeAs.string));
      const options: FieldOption[] = [];
      if (type === "select") {
        for (const oq of this.dataset.match(null, nn(skos("inScheme")), nn(iri))) {
          const concept = new TermWrapper(oq.subject.value, this.dataset, this.factory);
          options.push({
            iri: oq.subject.value,
            label: OptionalFrom.subjectPredicate(concept, skos("prefLabel"), LiteralAs.string) ?? oq.subject.value,
          });
        }
        options.sort((a, b) => a.label.localeCompare(b.label));
      }
      out.push({
        iri,
        slug: iri.slice(prefix.length),
        label: OptionalFrom.subjectPredicate(prop, rdfs("label"), LiteralAs.string) ?? iri.slice(prefix.length),
        type,
        options,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Remove a field definition and its options (issue values are untouched). */
  removeField(slug: string): void {
    const iri = `${this.doc}#field-${slug}`;
    const nn = this.factory.namedNode.bind(this.factory);
    for (const oq of [...this.dataset.match(null, nn(skos("inScheme")), nn(iri))]) {
      for (const q of [...this.dataset.match(oq.subject)]) this.dataset.delete(q);
    }
    for (const q of [...this.dataset.match(nn(iri))]) this.dataset.delete(q);
  }

  /** Live set of saved-view node IRIs declared on the tracker (`wf:savedView`). */
  private get savedViewIris(): Set<string> {
    return SetFrom.subjectPredicate(this, SAVED_VIEW, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The trusted prefix for a saved-view node: a `#view-` fragment of THIS doc. */
  private get savedViewPrefix(): string {
    return `${this.doc}#view-`;
  }
  /**
   * Whether `iri` is a trusted saved-view node — a `#view-` fragment of the
   * tracker document itself. A `wf:savedView` link is untrusted pod data: a
   * hostile one could point at the tracker node (`#this`), a field/status class,
   * or a foreign document. Mutating/clearing such a target would wipe unrelated
   * tracker config — so define/remove operate ONLY on this trusted shape, and
   * read SKIPS anything else.
   */
  private isOwnSavedView(iri: string): boolean {
    return iri.startsWith(this.savedViewPrefix);
  }

  /**
   * The saved views declared on the tracker (`wf:savedView` → a node carrying a
   * `dct:title` name and a `wf:viewQuery` JSON payload), sorted by name. A view
   * missing its name or payload — or whose IRI is not a trusted `#view-` fragment
   * of this doc — is skipped (defensive against partial/hostile data).
   */
  get savedViews(): SavedViewDef[] {
    const out: SavedViewDef[] = [];
    for (const iri of this.savedViewIris) {
      if (!this.isOwnSavedView(iri)) continue;
      const node = new TermWrapper(iri, this.dataset, this.factory);
      const name = OptionalFrom.subjectPredicate(node, dct("title"), LiteralAs.string);
      const payload = OptionalFrom.subjectPredicate(node, VIEW_QUERY, LiteralAs.string);
      if (name === undefined || payload === undefined) continue;
      out.push({ iri, name, payload });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Define (or overwrite by IRI) a saved view: mint/refresh the `#view-<slug>`
   * node with its name + serialised payload, and link it from the tracker via
   * `wf:savedView`. Overwriting first clears the node's previous triples so a
   * relabel/re-query never leaves stale values behind. A supplied `iri` MUST be a
   * trusted `#view-` fragment of this tracker doc — otherwise it is ignored and a
   * fresh slug-derived IRI is minted, so a caller can never coax this into
   * clearing the tracker node or another config node's triples. Returns the
   * definition.
   */
  defineSavedView(name: string, payload: string, iri?: string): SavedViewDef {
    const target = iri && this.isOwnSavedView(iri) ? iri : `${this.savedViewPrefix}${fragmentSlug(name)}`;
    const nn = this.factory.namedNode.bind(this.factory);
    // Clear any prior triples on this exact (trusted) node — idempotent overwrite.
    for (const q of [...this.dataset.match(nn(target))]) this.dataset.delete(q);
    const node = new TermWrapper(target, this.dataset, this.factory);
    OptionalAs.object(node, dct("title"), name.trim(), LiteralFrom.string);
    OptionalAs.object(node, VIEW_QUERY, payload, LiteralFrom.string);
    this.savedViewIris.add(target);
    return { iri: target, name: name.trim(), payload };
  }

  /**
   * Remove a saved view (its node triples and the tracker's link to it). The
   * `wf:savedView` link is always dropped, but the subject's triples are cleared
   * ONLY when `iri` is a trusted `#view-` fragment of this doc — so a hostile
   * link pointing at the tracker node or another config node can be UNLINKED
   * without wiping that node's unrelated configuration.
   */
  removeSavedView(iri: string): void {
    this.savedViewIris.delete(iri);
    if (!this.isOwnSavedView(iri)) return;
    for (const q of [...this.dataset.match(this.factory.namedNode(iri))]) this.dataset.delete(q);
  }

  private get groupIri(): string {
    return `${this.doc}#team`;
  }
  /** The assignee group's members (WebIDs). */
  get groupMembers(): string[] {
    const group = OptionalFrom.subjectPredicate(this, wf("assigneeGroup"), NamedNodeAs.string);
    if (!group) return [];
    const wrapper = new TermWrapper(group, this.dataset, this.factory);
    return [...SetFrom.subjectPredicate(wrapper, vcard("hasMember"), NamedNodeAs.string, NamedNodeFrom.string)];
  }
  /** The assignee group IRI, or undefined if no members are set. */
  get assigneeGroup(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("assigneeGroup"), NamedNodeAs.string);
  }
  setGroupMembers(webIds: string[]): void {
    OptionalAs.object(this, wf("assigneeGroup"), this.groupIri, NamedNodeFrom.string);
    const group = new TermWrapper(this.groupIri, this.dataset, this.factory);
    SetFrom.subjectPredicate(group, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(vcard("Group"));
    const members = SetFrom.subjectPredicate(group, vcard("hasMember"), NamedNodeAs.string, NamedNodeFrom.string);
    for (const m of [...members]) members.delete(m);
    for (const w of webIds) members.add(w);
  }
}

/**
 * A sprint: a `schema:Event` fragment in the tracker document with start/end
 * dates and `wf:task` links to its issues. Lifecycle derives from the dates:
 * no start ⇒ planned; started & no/unreached end ⇒ active; end passed ⇒ done.
 */
export class Sprint extends TermWrapper {
  get iri(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  markSprint(): void {
    this.types.add(schema("Event"));
  }
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }
  get startDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, schema("startDate"), LiteralAs.date);
  }
  set startDate(value: Date | undefined) {
    OptionalAs.object(this, schema("startDate"), value, LiteralFrom.dateTime);
  }
  get endDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, schema("endDate"), LiteralAs.date);
  }
  set endDate(value: Date | undefined) {
    OptionalAs.object(this, schema("endDate"), value, LiteralFrom.dateTime);
  }
  /** Issue URLs in this sprint (live set), via `wf:task`. */
  get tasks(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("task"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /**
   * Story points committed to the sprint (`dct:extent`, as on issues),
   * snapshotted at completion — completing releases unfinished tasks, so the
   * live task set alone can no longer reconstruct the commitment.
   */
  get committedPoints(): number | undefined {
    return OptionalFrom.subjectPredicate(this, dct("extent"), LiteralAs.number);
  }
  set committedPoints(value: number | undefined) {
    OptionalAs.object(this, dct("extent"), value, LiteralFrom.double);
  }
  state(now = new Date()): "planned" | "active" | "done" {
    if (this.endDate && this.endDate.getTime() <= now.getTime()) return "done";
    if (this.startDate && this.startDate.getTime() <= now.getTime()) return "active";
    return "planned";
  }
}

/** Enumerates the sprints declared in a tracker document. */
export class SprintsDataset extends DatasetWrapper {
  get sprints(): Iterable<Sprint> {
    return this.instancesOf(schema("Event"), Sprint);
  }
}

export { WF, DCT, RDF, STATE };
