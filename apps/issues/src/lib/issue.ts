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
import { WF, DCT, RDF, STATE, wf, dct, rdf, rdfs, sioc, foaf, vcard, schema, xsd, skos, prov } from "./vocab";

export type IssueState = "open" | "closed";
export type Priority = "high" | "medium" | "low";
export const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];

/**
 * A workflow status. `slug` becomes the `#status-<slug>` class fragment of the
 * tracker doc; `terminal` is the open/closed **resolution** every status carries —
 * a terminal status resolves to `wf:Closed`, a non-terminal one to `wf:Open` — so
 * the SHACL exactly-one-of-{Open,Closed} rule and every state consumer still hold,
 * no matter how many custom statuses a tracker declares (F1).
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
 */
export const DEFAULT_WORKFLOW: WorkflowDef = {
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

/**
 * The fixed built-in statuses. Retained as a convenience export (dashboards,
 * boards, and tests that predate configurable workflows read it); it is exactly
 * `DEFAULT_WORKFLOW.statuses`. For a tracker's *actual* statuses, read
 * {@link Tracker.workflow}.
 */
export const STATUSES: WorkflowStatus[] = DEFAULT_WORKFLOW.statuses;

/** Whether `to` is reachable from `from` under `workflow` (same-status is always allowed). */
export function canTransition(workflow: WorkflowDef, from: StatusSlug, to: StatusSlug): boolean {
  if (from === to) return true;
  if (!workflow.statuses.some((s) => s.slug === to)) return false;
  return (workflow.transitions[from] ?? []).includes(to);
}

/** The slug a status of `terminal` disposition resolves to is "closed"; otherwise "open". */
export function statusState(workflow: WorkflowDef, slug: StatusSlug): IssueState {
  return workflow.statuses.find((s) => s.slug === slug)?.terminal ? "closed" : "open";
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
  /** All entries, newest first (descending `prov:startedAtTime`). */
  get entries(): Activity[] {
    return [...this.instancesOf(prov("Activity"), Activity)].sort(
      (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
    );
  }
}

/**
 * A single issue, mapped onto `wf:Task` data (one resource per issue). State,
 * priority, and labels are all carried by `rdf:type` — the SolidOS model. Priority
 * and label classes are fragments of the tracker document (resolvable); the issue
 * derives their IRIs from its own `wf:tracker` link.
 */
export class Issue extends TermWrapper {
  get id(): string {
    return this.value;
  }

  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The tracker *document* URL (for deriving priority/label class IRIs). */
  private trackerDoc(): string | undefined {
    return this.tracker ? docOf(this.tracker) : undefined;
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

  get tracker(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("tracker"), NamedNodeAs.string);
  }
  set tracker(value: string | undefined) {
    OptionalAs.object(this, wf("tracker"), value, NamedNodeFrom.string);
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

  get creator(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("creator"), NamedNodeAs.string);
  }
  set creator(value: string | undefined) {
    OptionalAs.object(this, dct("creator"), value, NamedNodeFrom.string);
  }

  /** WebID of the assigned agent or group (optional). */
  get assignee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("assignee"), NamedNodeAs.string);
  }
  set assignee(value: string | undefined) {
    OptionalAs.object(this, wf("assignee"), value, NamedNodeFrom.string);
  }

  /** Parent issue (this is a sub-task of it), via `dct:isPartOf`. */
  get parent(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("isPartOf"), NamedNodeAs.string);
  }
  set parent(value: string | undefined) {
    OptionalAs.object(this, dct("isPartOf"), value, NamedNodeFrom.string);
  }

  /** Issues this one is blocked by (must be done first), via `dct:requires` — live set. */
  get blockedBy(): Set<string> {
    return SetFrom.subjectPredicate(this, dct("requires"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /**
   * Issues this one merely relates to (a non-blocking, symmetric "relates-to"
   * link), via `dct:relation` — live set. The peer should carry the reverse
   * `dct:relation` too (the relation is symmetric); {@link relatedLinks} derives
   * the union for display.
   */
  get relatesTo(): Set<string> {
    return SetFrom.subjectPredicate(this, dct("relation"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /**
   * The issue this one duplicates / is superseded by (close-as-duplicate), via
   * `dct:isReplacedBy`. Supersession only — a single canonical successor; the
   * peer surfaces it as `dct:replaces` (derived for display, not stored here).
   */
  get duplicateOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("isReplacedBy"), NamedNodeAs.string);
  }
  set duplicateOf(value: string | undefined) {
    OptionalAs.object(this, dct("isReplacedBy"), value, NamedNodeFrom.string);
  }

  /**
   * The issue this one was cloned from (clone v1), via `prov:wasDerivedFrom`.
   * A single provenance source — the original this issue was derived from.
   */
  get clonedFrom(): string | undefined {
    return OptionalFrom.subjectPredicate(this, prov("wasDerivedFrom"), NamedNodeAs.string);
  }
  set clonedFrom(value: string | undefined) {
    OptionalAs.object(this, prov("wasDerivedFrom"), value, NamedNodeFrom.string);
  }

  /** Attached file URLs (in the pod), via `wf:attachment` — live set. */
  get attachments(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("attachment"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  get dateDue(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, wf("dateDue"), LiteralAs.date);
  }
  set dateDue(value: Date | undefined) {
    // LiteralFrom.date emits an xsd:date with a full dateTime lexical (a wrapper
    // quirk that fails SHACL); store dateTime, which is well-formed and round-trips.
    OptionalAs.object(this, wf("dateDue"), value, LiteralFrom.dateTime);
  }

  /** Story-point estimate (`dct:extent` — "size of the resource"). */
  get estimate(): number | undefined {
    return OptionalFrom.subjectPredicate(this, dct("extent"), LiteralAs.number);
  }
  set estimate(value: number | undefined) {
    OptionalAs.object(this, dct("extent"), value, LiteralFrom.double);
  }

  /** Backlog rank (`schema:position`); lower sorts first. Fractional for cheap reorder. */
  get rank(): number | undefined {
    return OptionalFrom.subjectPredicate(this, schema("position"), LiteralAs.number);
  }
  set rank(value: number | undefined) {
    OptionalAs.object(this, schema("position"), value, LiteralFrom.double);
  }

  get state(): IssueState {
    return this.types.has(STATE.Closed) ? "closed" : "open";
  }
  set state(value: IssueState) {
    const types = this.types;
    if (value === "closed") {
      types.add(STATE.Closed);
      types.delete(STATE.Open);
      // Completion is provenance: stamp once, keep the original on re-close.
      this.endedAt ??= new Date();
    } else {
      types.add(STATE.Open);
      types.delete(STATE.Closed);
      this.endedAt = undefined;
    }
    types.add(wf("Task"));
  }

  /** When the task was completed (`prov:endedAtTime`); cleared on reopen. */
  get endedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, prov("endedAtTime"), LiteralAs.date);
  }
  set endedAt(value: Date | undefined) {
    OptionalAs.object(this, prov("endedAtTime"), value, LiteralFrom.dateTime);
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
  get priority(): Priority | undefined {
    const doc = this.trackerDoc();
    if (!doc) return undefined;
    const types = this.types;
    return PRIORITIES.find((level) => types.has(this.priorityClass(level, doc)!));
  }
  set priority(level: Priority | undefined) {
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
}

/** A label definition on the tracker: slug + human label. */
export interface LabelDef {
  slug: string;
  label: string;
}

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
