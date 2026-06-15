import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Store, DataFactory, Writer } from "n3";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import {
  Issue,
  Tracker,
  Comment,
  Sprint,
  SprintsDataset,
  Activity,
  ActivityLog,
  DEFAULT_WORKFLOW,
  canTransition,
  statusState,
  type ActivityKind,
  type FieldDef,
  type FieldValue,
  type FieldType,
  type IssueState,
  type IssueType,
  type Priority,
  type StatusSlug,
  type WorkflowDef,
} from "./issue";
import { wf, rdf, prov } from "./vocab";
import { ConflictError, WriteError, TransitionError } from "./errors";

const TRACKER_FRAGMENT = "#this";
const ISSUE_FRAGMENT = "#this";
const DEFAULT_TITLE = "Issues";

export interface CommentRecord {
  author?: string;
  content: string;
  created?: Date;
  mentions: string[];
}

/** A render-friendly snapshot of one worklog entry (F4 time tracking). */
export interface WorklogRecord {
  /** The entry node IRI (stable identity for keys). */
  id: string;
  /** Who logged the work (`prov:wasAssociatedWith`). */
  actor?: string;
  /** When the work was logged (`prov:startedAtTime`). */
  at?: Date;
  /** Logged effort in seconds. */
  seconds: number;
  /** Optional free-text note (`dct:description`). */
  note?: string;
}

/** A render-friendly snapshot of one issue (decoupled from the RDF wrapper). */
export interface IssueRecord {
  url: string;
  title: string;
  description?: string;
  state: IssueState;
  status: StatusSlug;
  issueType: IssueType;
  priority?: Priority;
  labels: string[];
  assignee?: string;
  creator?: string;
  dateDue?: Date;
  /** Parent issue URL (this is a sub-task), if any. */
  parent?: string;
  /** Issue URLs that block this one. */
  blockedBy: string[];
  /** Issue URLs this one (non-blockingly) relates to (`dct:relation`). */
  relatesTo: string[];
  /** The issue this one is a duplicate of / superseded by (`dct:isReplacedBy`). */
  duplicateOf?: string;
  /** The issue this one was cloned from (`prov:wasDerivedFrom`). */
  clonedFrom?: string;
  /** Attached file URLs in the pod. */
  attachments: string[];
  /** Story-point estimate. */
  estimate?: number;
  /** Backlog rank (lower first). */
  rank?: number;
  created?: Date;
  modified?: Date;
  /** When the issue was completed (cleared on reopen). */
  endedAt?: Date;
  /** F4: worklog entries logged against this issue (newest first). */
  worklog: WorklogRecord[];
  /** F4: total logged effort on THIS issue (own worklog only), in seconds. */
  loggedSeconds: number;
  comments: CommentRecord[];
  /** Custom-field values keyed by field slug (selects hold the option IRI). */
  fields: Record<string, FieldValue>;
  /** Whether the signed-in user may write this issue (from WAC-Allow). */
  canWrite: boolean;
}

export interface SprintRecord {
  iri: string;
  title: string;
  startDate?: Date;
  endDate?: Date;
  state: "planned" | "active" | "done";
  taskUrls: string[];
  /** Points committed to the sprint, snapshotted when it completes. */
  committedPoints?: number;
}

/** A render-friendly snapshot of one provenance activity-log entry (F3). */
export interface ActivityRecord {
  /** The activity node IRI (stable identity for keys). */
  id: string;
  kind: ActivityKind;
  /** Actor WebID (`prov:wasAssociatedWith`), if recorded. */
  actor?: string;
  /** When the change happened (`prov:startedAtTime`). */
  at?: Date;
  /** Prior value (`prov:used`) — a status-class IRI / WebID / issue IRI. */
  used?: string;
  /** New value (`prov:generated`) — a status-class IRI / WebID / issue IRI. */
  generated?: string;
}

export interface NewIssueInput {
  title: string;
  description?: string;
  assignee?: string;
  dateDue?: Date;
  priority?: Priority;
  status?: StatusSlug;
  issueType?: IssueType;
  labels?: string[];
  parent?: string;
  blockedBy?: string[];
  /** Issue URLs this one relates to (non-blocking, `dct:relation`). */
  relatesTo?: string[];
  /** The issue this duplicates / is superseded by (`dct:isReplacedBy`). */
  duplicateOf?: string;
  /** The issue this was cloned from (`prov:wasDerivedFrom`). */
  clonedFrom?: string;
  estimate?: number;
  rank?: number;
  creator?: string;
  /** Custom-field values keyed by field slug (undefined clears a value). */
  fields?: Record<string, FieldValue | undefined>;
}
export type IssuePatch = Partial<Omit<NewIssueInput, "creator">>;

// Force revalidation on every pod read. CSS serves ETag/Last-Modified with no
// Cache-Control, so browsers heuristically cache GETs; with `Vary: Accept` the
// cache variant written by our GETs is not invalidated by PUTs (different vary
// key), so an immediate read-after-write can return the PRE-write body. The
// request directive makes the browser revalidate (304/200) against the server.
const NO_CACHE = { "cache-control": "no-cache" } as const;
const opts = (fetchImpl?: typeof fetch) => ({ headers: NO_CACHE, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

function dirOf(url: string): string {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

function wacAllowsWrite(response: Response): boolean {
  const header = response.headers.get("wac-allow");
  if (!header) return true;
  const user = /user\s*=\s*"([^"]*)"/i.exec(header);
  if (!user) return true;
  const modes = user[1].toLowerCase().split(/\s+/);
  return modes.includes("write") || modes.includes("append");
}

function serialize(dataset: DatasetCore): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const q of dataset) writer.addQuad(q);
  return new Promise((resolve, reject) =>
    writer.end((err, result) => (err ? reject(err) : resolve(result))),
  );
}

function issueSubject(dataset: DatasetCore, docUrl: string): string {
  for (const q of dataset.match(null, DataFactory.namedNode(rdf("type")), DataFactory.namedNode(wf("Task")))) {
    return q.subject.value;
  }
  return `${docUrl}${ISSUE_FRAGMENT}`;
}

function toRecord(issue: Issue, url: string, canWrite: boolean, fieldDefs: FieldDef[] = []): IssueRecord {
  const fields: Record<string, FieldValue> = {};
  for (const def of fieldDefs) {
    const value = issue.getField(def);
    if (value !== undefined) fields[def.slug] = value;
  }
  return {
    fields,
    url,
    title: issue.title ?? "(untitled)",
    description: issue.description,
    state: issue.state,
    status: issue.status,
    issueType: issue.issueType,
    priority: issue.priority,
    labels: issue.labels,
    assignee: issue.assignee,
    creator: issue.creator,
    dateDue: issue.dateDue,
    parent: issue.parent,
    blockedBy: [...issue.blockedBy],
    relatesTo: [...issue.relatesTo],
    duplicateOf: issue.duplicateOf,
    clonedFrom: issue.clonedFrom,
    attachments: [...issue.attachments],
    estimate: issue.estimate,
    rank: issue.rank,
    created: issue.created,
    modified: issue.modified,
    endedAt: issue.endedAt,
    worklog: issue.worklog.map((w) => ({ id: w.id, actor: w.actor, at: w.at, seconds: w.seconds, note: w.note })),
    loggedSeconds: issue.loggedSeconds,
    comments: issue.comments.map((c) => ({
      author: c.author,
      content: c.content ?? "",
      created: c.created,
      mentions: [...c.mentions],
    })),
    canWrite,
  };
}

/** One loaded issue document, for conditional read-modify-write. */
interface LoadedIssue {
  dataset: DatasetCore;
  etag: string | null;
  issue: Issue;
  canWrite: boolean;
}

/**
 * The tracker: a config document (`tracker.ttl#this`) plus an `issues/` container
 * holding one document per issue. Per-issue documents make per-issue access
 * control possible (each can carry its own ACL). Writes are conditional PUTs on
 * the individual issue's ETag.
 */
export class Repository {
  constructor(
    readonly trackerUrl: string,
    private readonly fetchImpl?: typeof fetch,
    /** The signed-in user's WebID — stamped as the actor of activity-log entries. */
    private readonly actor?: string,
  ) {}

  /**
   * The last activity timestamp this instance stamped (epoch ms). Two appends
   * triggered by back-to-back mutations can land in the same millisecond; the
   * timeline orders by `prov:startedAtTime`, so a collision makes their order
   * non-deterministic. Clamping each append to be strictly after the previous
   * one keeps the recorded order faithful to the append order.
   */
  private lastActivityAt = 0;

  get trackerIri(): string {
    return `${this.trackerUrl}${TRACKER_FRAGMENT}`;
  }
  get containerUrl(): string {
    return new URL("issues/", dirOf(this.trackerUrl)).toString();
  }
  /** The sibling `activity/` container holding one paginated log per issue. */
  get activityContainerUrl(): string {
    return new URL("activity/", dirOf(this.trackerUrl)).toString();
  }

  /** Load the tracker config; a 404 yields an empty, unconfigured tracker. */
  async loadTracker(): Promise<{ dataset: DatasetCore; etag: string | null; tracker: Tracker; exists: boolean }> {
    try {
      const { dataset, etag } = await fetchRdf(this.trackerUrl, opts(this.fetchImpl));
      return { dataset, etag, tracker: new Tracker(this.trackerIri, dataset, DataFactory), exists: true };
    } catch (e) {
      if (e instanceof RdfFetchError && e.status === 404) {
        const dataset: DatasetCore = new Store();
        return { dataset, etag: null, tracker: new Tracker(this.trackerIri, dataset, DataFactory), exists: false };
      }
      throw e;
    }
  }

  /** Create the tracker config (with priority/label classes) if it doesn't exist. */
  async ensureTracker(title: string = DEFAULT_TITLE): Promise<Tracker> {
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) {
      tracker.configure(title);
      await this.put(this.trackerUrl, dataset, etag);
    }
    return tracker;
  }

  /**
   * Ensure the tracker declares each given label (by display name) as a category
   * class, returning their slugs. No-op for an empty list.
   */
  async declareLabels(displayLabels: string[]): Promise<string[]> {
    if (displayLabels.length === 0) return [];
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) tracker.configure(DEFAULT_TITLE);
    const known = new Map(tracker.labelDefs.map((d) => [d.label.toLowerCase(), d.slug]));
    const slugs = displayLabels.map((l) => known.get(l.toLowerCase()) ?? tracker.defineLabel(l));
    await this.put(this.trackerUrl, dataset, etag);
    return slugs;
  }

  /** All label definitions declared on the tracker. */
  async labels(): Promise<{ slug: string; label: string }[]> {
    const { tracker } = await this.loadTracker();
    return tracker.labelDefs;
  }

  /** A snapshot of tracker-level config for the UI. */
  async info(): Promise<{ title?: string; labels: { slug: string; label: string }[]; fields: FieldDef[]; groupMembers: string[]; assigneeGroup?: string; workflow: WorkflowDef }> {
    const { tracker } = await this.loadTracker();
    return {
      title: tracker.title,
      labels: tracker.labelDefs,
      fields: tracker.fieldDefs,
      groupMembers: tracker.groupMembers,
      assigneeGroup: tracker.assigneeGroup,
      workflow: tracker.workflow,
    };
  }

  /** The tracker's custom-field definitions. */
  async fieldDefs(): Promise<FieldDef[]> {
    const { tracker } = await this.loadTracker();
    return tracker.fieldDefs;
  }

  /** Define (or redefine) a custom field on the tracker. */
  async defineField(label: string, type: FieldType, optionLabels: string[] = []): Promise<FieldDef> {
    let def: FieldDef | undefined;
    await this.mutateTracker((dataset) => {
      def = new Tracker(this.trackerIri, dataset, DataFactory).defineField(label, type, optionLabels);
    });
    return def!;
  }

  /** Remove a custom field's definition (values on issues are left in place). */
  async removeField(slug: string): Promise<void> {
    await this.mutateTracker((dataset) => {
      new Tracker(this.trackerIri, dataset, DataFactory).removeField(slug);
    });
  }

  /** Set the assignee group's members (WebIDs) on the tracker. */
  async setAssigneeGroup(webIds: string[]): Promise<void> {
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) tracker.configure(DEFAULT_TITLE);
    tracker.setGroupMembers(webIds);
    await this.put(this.trackerUrl, dataset, etag);
  }

  /**
   * Conditional PUT. With a known `etag`, sends `If-Match` (lost-update guard).
   * With `etag === null` and `createOnly`, sends `If-None-Match: *` so the write
   * only succeeds if the resource does NOT yet exist — two concurrent creators of
   * the same URL then both can't win, and the loser gets a 412 to retry against.
   */
  private async put(url: string, dataset: DatasetCore, etag: string | null, createOnly = false): Promise<void> {
    const doFetch = this.fetchImpl ?? fetch;
    const headers: Record<string, string> = { "content-type": "text/turtle" };
    if (etag) headers["if-match"] = etag;
    else if (createOnly) headers["if-none-match"] = "*";
    const res = await doFetch(url, { method: "PUT", headers, body: await serialize(dataset) });
    if (res.status === 412) throw new ConflictError(url);
    if (!res.ok && res.status !== 205) throw new WriteError(url, res.status);
  }

  /** List every issue in the container (newest first), plus whether new issues can be created. */
  async list(): Promise<{ issues: IssueRecord[]; canCreate: boolean }> {
    let memberUrls: string[];
    let canCreate = true;
    try {
      const { dataset, response } = await fetchRdf(this.containerUrl, opts(this.fetchImpl));
      canCreate = wacAllowsWrite(response);
      const container = new ContainerDataset(dataset, DataFactory).container;
      memberUrls = [...(container?.contains ?? [])]
        .filter((r) => !r.isContainer)
        .map((r) => r.id)
        .filter((id) => id !== this.containerUrl && id.endsWith(".ttl"));
    } catch (e) {
      if (e instanceof RdfFetchError && e.status === 404) return { issues: [], canCreate: true }; // not created yet
      throw e;
    }

    // Custom-field definitions live in the tracker config; a collaborator
    // without config access still sees the issues, just without field values.
    const fieldDefs = await this.fieldDefs().catch(() => [] as FieldDef[]);

    const records = await Promise.all(
      memberUrls.map(async (url) => {
        try {
          const { dataset, response } = await fetchRdf(url, opts(this.fetchImpl));
          const subject = issueSubject(dataset, url);
          const issue = new Issue(subject, dataset, DataFactory);
          if (!issue.title && issue.state === "open" && issue.comments.length === 0 && !issue.tracker) return null;
          return toRecord(issue, url, wacAllowsWrite(response), fieldDefs);
        } catch {
          return null; // a member we can't read is simply omitted
        }
      }),
    );
    const issues = records
      .filter((r): r is IssueRecord => r !== null)
      .sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0));
    return { issues, canCreate };
  }

  private async openIssue(url: string): Promise<LoadedIssue> {
    const { dataset, etag, response } = await fetchRdf(url, opts(this.fetchImpl));
    return { dataset, etag, issue: new Issue(issueSubject(dataset, url), dataset, DataFactory), canWrite: wacAllowsWrite(response) };
  }

  /** Resolve field slugs to definitions and apply the values to an issue. */
  private applyFields(issue: Issue, defs: FieldDef[], values: Record<string, FieldValue | undefined>): void {
    for (const [slug, value] of Object.entries(values)) {
      const def = defs.find((d) => d.slug === slug);
      if (def) issue.setField(def, value);
    }
  }

  /** Create a new issue document and return its URL. `input.labels` are display names. */
  async create(input: NewIssueInput): Promise<string> {
    const tracker = await this.ensureTracker();
    const fieldDefs = tracker.fieldDefs;
    const workflow = tracker.workflow;
    const labelSlugs = await this.declareLabels(input.labels ?? []);
    const url = `${this.containerUrl}${crypto.randomUUID()}.ttl`;
    const dataset: DatasetCore = new Store();
    const issue = new Issue(`${url}${ISSUE_FRAGMENT}`, dataset, DataFactory);
    issue.tracker = this.trackerIri; // set first so status/priority/label IRIs resolve
    const now = new Date();
    // Default to the workflow's declared initial state (statuses[0]) — NOT the
    // built-in "todo", which need not exist in a custom workflow. A supplied
    // status is validated against the workflow, and its open/closed resolution
    // is applied so a terminal initial status (e.g. "shipped") records as closed.
    const initial = workflow.statuses[0].slug;
    const status = input.status ?? initial;
    if (!workflow.statuses.some((s) => s.slug === status)) {
      throw new TransitionError(initial, status, `"${status}" is not a status in this tracker's workflow.`);
    }
    issue.setStatus(status, statusState(workflow, status) === "closed"); // status (+ wf:Open/Closed) + wf:Task
    issue.issueType = input.issueType ?? "task";
    issue.title = input.title;
    issue.description = input.description;
    issue.assignee = input.assignee;
    issue.dateDue = input.dateDue;
    issue.creator = input.creator;
    issue.priority = input.priority;
    issue.labels = labelSlugs;
    issue.parent = input.parent;
    issue.duplicateOf = input.duplicateOf;
    issue.clonedFrom = input.clonedFrom;
    issue.estimate = input.estimate;
    issue.rank = input.rank;
    for (const b of input.blockedBy ?? []) issue.blockedBy.add(b);
    for (const r of input.relatesTo ?? []) issue.relatesTo.add(r);
    if (input.fields) this.applyFields(issue, fieldDefs, input.fields);
    issue.created = now;
    issue.modified = now;
    await this.put(url, dataset, null);
    return url;
  }

  /**
   * The tracker's configured workflow (F1). A collaborator without tracker-config
   * access — or a not-yet-configured tracker — falls back to {@link DEFAULT_WORKFLOW},
   * so status changes and the open/closed resolution always work.
   */
  async workflow(): Promise<WorkflowDef> {
    try {
      const { tracker } = await this.loadTracker();
      return tracker.workflow;
    } catch {
      return DEFAULT_WORKFLOW;
    }
  }

  /** Declare (replacing any existing) a custom workflow on the tracker (F1). */
  async defineWorkflow(workflow: WorkflowDef): Promise<void> {
    await this.mutateTracker((dataset) => {
      new Tracker(this.trackerIri, dataset, DataFactory).defineWorkflow(workflow);
    });
  }

  async update(url: string, patch: IssuePatch): Promise<void> {
    const labelSlugs = "labels" in patch && patch.labels ? await this.declareLabels(patch.labels) : undefined;
    const workflow = "status" in patch && patch.status ? await this.workflow() : undefined;
    const { dataset, etag, issue } = await this.openIssue(url);
    // Snapshot the change-tracked fields BEFORE mutating, so the activity log
    // records the true before→after (F3).
    const before = { status: issue.status, assignee: issue.assignee, duplicateOf: issue.duplicateOf };
    if ("title" in patch) issue.title = patch.title;
    if ("description" in patch) issue.description = patch.description;
    if ("assignee" in patch) issue.assignee = patch.assignee;
    if ("dateDue" in patch) issue.dateDue = patch.dateDue;
    if ("priority" in patch) issue.priority = patch.priority;
    if ("status" in patch && patch.status && workflow) this.applyStatus(issue, patch.status, workflow);
    if ("issueType" in patch && patch.issueType) issue.issueType = patch.issueType;
    if (labelSlugs) issue.labels = labelSlugs;
    if ("parent" in patch) issue.parent = patch.parent;
    if ("duplicateOf" in patch) issue.duplicateOf = patch.duplicateOf;
    if ("clonedFrom" in patch) issue.clonedFrom = patch.clonedFrom;
    if ("estimate" in patch) issue.estimate = patch.estimate;
    if ("rank" in patch) issue.rank = patch.rank;
    if ("blockedBy" in patch && patch.blockedBy) {
      const set = issue.blockedBy;
      for (const b of [...set]) set.delete(b);
      for (const b of patch.blockedBy) set.add(b);
    }
    if ("relatesTo" in patch && patch.relatesTo) {
      const set = issue.relatesTo;
      for (const r of [...set]) set.delete(r);
      for (const r of patch.relatesTo) set.add(r);
    }
    if (patch.fields) {
      const defs = await this.fieldDefs().catch(() => [] as FieldDef[]);
      this.applyFields(issue, defs, patch.fields);
    }
    issue.modified = new Date();
    await this.put(url, dataset, etag);

    // Append provenance for the change-tracked fields (after the issue write
    // succeeds, so the log never gets ahead of the issue). Best-effort.
    const now = new Date();
    if (workflow && "status" in patch && patch.status && before.status !== patch.status) {
      await this.appendActivity(url, { kind: "status", at: now, used: this.statusClassOf(url, before.status), generated: this.statusClassOf(url, patch.status) });
    }
    if ("assignee" in patch && before.assignee !== patch.assignee) {
      await this.appendActivity(url, { kind: "assignment", at: now, used: before.assignee, generated: patch.assignee });
    }
    if ("duplicateOf" in patch && before.duplicateOf !== patch.duplicateOf) {
      await this.appendActivity(url, { kind: "link", at: now, used: before.duplicateOf, generated: patch.duplicateOf });
    }
  }

  async setState(url: string, state: IssueState): Promise<void> {
    // Closing/reopening maps onto the workflow: the first terminal status closes,
    // the first non-terminal status (the initial state) reopens.
    const workflow = await this.workflow();
    const target = state === "closed"
      ? workflow.statuses.find((s) => s.terminal)?.slug
      : workflow.statuses.find((s) => !s.terminal)?.slug;
    await this.setStatus(url, target ?? (state === "closed" ? "done" : "todo"));
  }

  async setStatus(url: string, status: StatusSlug): Promise<void> {
    const workflow = await this.workflow();
    const { dataset, etag, issue } = await this.openIssue(url);
    const from = issue.status;
    this.applyStatus(issue, status, workflow);
    issue.modified = new Date();
    await this.put(url, dataset, etag);
    if (from !== status) {
      await this.appendActivity(url, {
        kind: "status",
        at: new Date(),
        used: this.statusClassOf(url, from),
        generated: this.statusClassOf(url, status),
      });
    }
  }

  /** The `#status-<slug>` class IRI of a status, derived from the tracker doc. */
  private statusClassOf(_issueUrl: string, slug: StatusSlug): string {
    return `${this.trackerUrl}#status-${slug}`;
  }

  /**
   * Apply a status to an issue, enforcing the workflow's transition rules and its
   * open/closed resolution (terminal ⇒ wf:Closed). A disallowed move throws
   * {@link TransitionError}; same-status re-asserts are always allowed.
   */
  private applyStatus(issue: Issue, status: StatusSlug, workflow: WorkflowDef): void {
    const from = issue.status;
    if (from !== status && !canTransition(workflow, from, status)) {
      throw new TransitionError(from, status);
    }
    issue.setStatus(status, statusState(workflow, status) === "closed");
  }

  async addComment(url: string, content: string, author?: string, mentions: string[] = []): Promise<void> {
    const { dataset, etag, issue } = await this.openIssue(url);
    const comment = new Comment(`${url}#msg-${crypto.randomUUID()}`, dataset, DataFactory);
    comment.markMessage();
    comment.content = content;
    comment.author = author;
    comment.created = new Date();
    for (const m of mentions) comment.mentions.add(m);
    issue.messages.add(comment);
    issue.modified = new Date();
    await this.put(url, dataset, etag);
  }

  /**
   * Log work against an issue (F4 time tracking). Appends a NEW worklog entry
   * (`prov:Activity` of `dct:type "worklog"`) to the issue's document — existing
   * entries are never touched (append-only). The actor defaults to the repository's
   * signed-in WebID. `seconds` must be a positive, finite number.
   */
  async logWork(url: string, seconds: number, note?: string, at: Date = new Date()): Promise<void> {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new RangeError("Logged work must be a positive number of seconds.");
    }
    const { dataset, etag, issue } = await this.openIssue(url);
    issue.logWork(`${url}#work-${crypto.randomUUID()}`, { actor: this.actor, at, seconds, note: note?.trim() || undefined });
    issue.modified = new Date();
    await this.put(url, dataset, etag);
  }

  // ---- Provenance activity log (F3): append-only, paginated, one log per issue ----

  /** Max entries per log page before rolling over to a fresh page (caps doc growth). */
  private static readonly ACTIVITY_PAGE_SIZE = 200;

  /** The stem (`<activity/>/<issue-uuid>`) of an issue's paginated log pages. */
  private activityStem(issueUrl: string): string {
    const last = issueUrl.slice(issueUrl.lastIndexOf("/") + 1);
    const slug = (last.endsWith(".ttl") ? last.slice(0, -4) : last).split("#")[0];
    return `${this.activityContainerUrl}${slug}`;
  }

  /** Page document URL: `<stem>.ttl` for page 0, `<stem>.<n>.ttl` thereafter. */
  private activityPageUrl(stem: string, page: number): string {
    return page === 0 ? `${stem}.ttl` : `${stem}.${page}.ttl`;
  }

  /** How many times to retry an append that loses a conditional-write race. */
  private static readonly ACTIVITY_APPEND_RETRIES = 4;

  /**
   * Append one provenance entry for `issueUrl` (F3). Strictly append-only: it
   * reads the current page, adds a NEW `prov:Activity` node (never touching the
   * existing ones), and conditionally PUTs. When the page is full it rolls over
   * to a fresh page so no single document grows without bound. Best-effort — a
   * failure to log never fails the user's primary mutation.
   *
   * Concurrency-safe: a write to an EXISTING page is guarded by `If-Match`, and a
   * write that CREATES a page (page 0 of a fresh log, or a rolled-over page) is
   * guarded by `If-None-Match: *`. Either guard surfaces a concurrent writer as a
   * 412 ({@link ConflictError}); on conflict we re-read, re-roll, and re-append so
   * neither writer can silently overwrite the other's entry.
   */
  async appendActivity(
    issueUrl: string,
    entry: { kind: ActivityKind; at: Date; used?: string; generated?: string },
  ): Promise<void> {
    const stem = this.activityStem(issueUrl);
    // Keep timestamps strictly increasing across this instance's appends so the
    // recorded order matches the append order even at millisecond collisions.
    const at = new Date(Math.max(entry.at.getTime(), this.lastActivityAt + 1));
    this.lastActivityAt = at.getTime();
    const stamped = { ...entry, at };
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.appendActivityOnce(stem, stamped);
          return;
        } catch (e) {
          // A conflict means another writer created/extended the same page first.
          // Re-read from scratch (a fresh walk picks up the new page/entries) and
          // retry, so a concurrent create can never replace an existing entry.
          if (e instanceof ConflictError && attempt < Repository.ACTIVITY_APPEND_RETRIES) continue;
          throw e;
        }
      }
    } catch {
      // Logging is non-critical; swallow so a primary mutation still succeeds.
    }
  }

  /** One append attempt (walk → roll → conditional PUT). Throws {@link ConflictError} on a race. */
  private async appendActivityOnce(
    stem: string,
    entry: { kind: ActivityKind; at: Date; used?: string; generated?: string },
  ): Promise<void> {
    // Walk to the highest existing page (cheap: stops at the first 404).
    let page = 0;
    let current: { dataset: DatasetCore; etag: string | null } | undefined;
    for (;;) {
      const pageUrl = this.activityPageUrl(stem, page);
      try {
        const { dataset, etag } = await fetchRdf(pageUrl, opts(this.fetchImpl));
        current = { dataset, etag };
        page += 1;
      } catch (e) {
        if (e instanceof RdfFetchError && e.status === 404) break;
        throw e;
      }
    }
    page = Math.max(0, page - 1); // the last page that exists (or 0 if none)

    const count = current ? [...current.dataset.match(null, DataFactory.namedNode(rdf("type")), DataFactory.namedNode(prov("Activity")))].length : 0;
    // Roll over to a new page when the current one is full.
    const full = current !== undefined && count >= Repository.ACTIVITY_PAGE_SIZE;
    const creating = full || current === undefined; // a brand-new page document
    const targetPage = current === undefined ? 0 : full ? page + 1 : page;
    const targetUrl = this.activityPageUrl(stem, targetPage);
    const dataset: DatasetCore = creating ? new Store() : current!.dataset;
    const etag = creating ? null : current!.etag;

    const activity = new Activity(`${targetUrl}#act-${crypto.randomUUID()}`, dataset, DataFactory);
    activity.record({ kind: entry.kind, actor: this.actor, at: entry.at, used: entry.used, generated: entry.generated });
    // A new page is created with If-None-Match: * so a concurrent creator can't be
    // clobbered; an existing page is extended under its If-Match etag.
    await this.put(targetUrl, dataset, etag, creating);
  }

  /**
   * Read an issue's full activity log (F3), newest first. Reads every page until
   * a 404. Returns [] for an issue with no log (or an inaccessible one).
   */
  async activityLog(issueUrl: string): Promise<ActivityRecord[]> {
    const stem = this.activityStem(issueUrl);
    const out: ActivityRecord[] = [];
    for (let page = 0; ; page++) {
      const pageUrl = this.activityPageUrl(stem, page);
      try {
        const { dataset } = await fetchRdf(pageUrl, opts(this.fetchImpl));
        for (const entry of new ActivityLog(dataset, DataFactory).entries) {
          out.push({
            id: entry.id,
            kind: entry.kind ?? "status",
            actor: entry.actor,
            at: entry.at,
            used: entry.used,
            generated: entry.generated,
          });
        }
      } catch (e) {
        if (e instanceof RdfFetchError && e.status === 404) break;
        // An access error (401/403) or any other failure: stop, return what we have.
        break;
      }
    }
    // Newest first; ties broken by entry IRI so the order is STABLE when entries
    // from different writers share a timestamp.
    return out.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0) || a.id.localeCompare(b.id));
  }

  /** Default cap on log pages read per issue when reconstructing the CFD. */
  private static readonly STATUS_HISTORY_MAX_PAGES = 4;
  /** Default cap on concurrent per-issue log reads during a CFD fan-out. */
  private static readonly STATUS_HISTORY_CONCURRENCY = 6;

  /**
   * One issue's recorded status transitions for CFD replay (F3): the `{ to, at }`
   * of every `status`-kind `prov:Activity`, ascending by time. `to` is the slug
   * the issue moved into (`prov:generated`, the part after `#status-`). Reads at
   * most `maxPages` log pages so the fan-out stays bounded. Pages are numbered
   * oldest-first (page 0 = oldest; highest page = current), so reading up to
   * `maxPages` pages from the front captures the oldest transitions. For issues
   * with more pages than the cap, the most recent transitions are on the pages
   * not read — callers should reconcile with the issue's current record to keep
   * the present-day CFD band correct (see {@link computeCumulativeFlowBands}).
   * Returns [] for an issue with no log (or an inaccessible one).
   */
  async statusHistory(
    issueUrl: string,
    maxPages = Repository.STATUS_HISTORY_MAX_PAGES,
  ): Promise<{ to: StatusSlug; at: Date }[]> {
    const stem = this.activityStem(issueUrl);
    const out: { to: StatusSlug; at: Date }[] = [];
    for (let page = 0; page < maxPages; page++) {
      const pageUrl = this.activityPageUrl(stem, page);
      try {
        const { dataset } = await fetchRdf(pageUrl, opts(this.fetchImpl));
        for (const entry of new ActivityLog(dataset, DataFactory).entries) {
          if (entry.kind !== "status" || entry.at === undefined) continue;
          const to = this.slugOfStatusClass(entry.generated);
          if (to !== undefined) out.push({ to, at: entry.at });
        }
      } catch (e) {
        if (e instanceof RdfFetchError && e.status === 404) break;
        // An access error (401/403) or any other failure: stop, return what we have.
        break;
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  /**
   * Fan out {@link statusHistory} over `issueUrls` to feed the three-band CFD
   * ({@link computeCumulativeFlowBands}). Reads are bounded: at most `maxPages`
   * pages per issue and at most `concurrency` issues in flight at once, so a large
   * tracker does not open an unbounded number of simultaneous requests.
   */
  async dashboardStatusHistory(
    issueUrls: string[],
    maxPages = Repository.STATUS_HISTORY_MAX_PAGES,
    concurrency = Repository.STATUS_HISTORY_CONCURRENCY,
  ): Promise<Map<string, { to: StatusSlug; at: Date }[]>> {
    const result = new Map<string, { to: StatusSlug; at: Date }[]>();
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= issueUrls.length) return;
        const url = issueUrls[i];
        result.set(url, await this.statusHistory(url, maxPages));
      }
    };
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, issueUrls.length)) }, worker);
    await Promise.all(workers);
    return result;
  }

  /** Slug of a `#status-<slug>` class IRI (the part after `#status-`); undefined otherwise. */
  private slugOfStatusClass(iri: string | undefined): StatusSlug | undefined {
    if (!iri) return undefined;
    const marker = "#status-";
    const at = iri.lastIndexOf(marker);
    return at === -1 ? undefined : iri.slice(at + marker.length);
  }

  // ---- Sprints (schema:Event fragments in tracker.ttl; membership via wf:task) ----

  async listSprints(now = new Date()): Promise<SprintRecord[]> {
    let dataset: DatasetCore;
    try {
      ({ dataset } = await this.loadTracker());
    } catch (e) {
      // A collaborator may have container access but no tracker-config access —
      // sprint metadata is then simply unavailable. Anything else is a real error.
      if (e instanceof RdfFetchError && (e.status === 401 || e.status === 403)) return [];
      throw e;
    }
    const out: SprintRecord[] = [];
    for (const sp of new SprintsDataset(dataset, DataFactory).sprints) {
      out.push({
        iri: sp.iri,
        title: sp.title ?? "(unnamed sprint)",
        startDate: sp.startDate,
        endDate: sp.endDate,
        state: sp.state(now),
        taskUrls: [...sp.tasks],
        committedPoints: sp.committedPoints,
      });
    }
    // planned → active → done, then by title for stability.
    const order = { active: 0, planned: 1, done: 2 } as const;
    return out.sort((a, b) => order[a.state] - order[b.state] || a.title.localeCompare(b.title));
  }

  private async mutateTracker(applyFn: (dataset: DatasetCore) => void): Promise<void> {
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) tracker.configure(DEFAULT_TITLE);
    applyFn(dataset);
    await this.put(this.trackerUrl, dataset, etag);
  }

  async createSprint(title: string): Promise<string> {
    const iri = `${this.trackerUrl}#sprint-${crypto.randomUUID()}`;
    await this.mutateTracker((dataset) => {
      const sp = new Sprint(iri, dataset, DataFactory);
      sp.markSprint();
      sp.title = title;
    });
    return iri;
  }

  async setSprintMembership(sprintIri: string, issueUrl: string, member: boolean): Promise<void> {
    await this.mutateTracker((dataset) => {
      const sp = new Sprint(sprintIri, dataset, DataFactory);
      if (member) {
        // an issue lives in at most one sprint — drop it from the others
        for (const other of new SprintsDataset(dataset, DataFactory).sprints) {
          if (other.iri !== sprintIri) other.tasks.delete(issueUrl);
        }
        sp.tasks.add(issueUrl);
      } else {
        sp.tasks.delete(issueUrl);
      }
    });
  }

  /** Start the sprint now, ending at `endDate` (default: two weeks out). */
  async startSprint(sprintIri: string, endDate?: Date): Promise<void> {
    await this.mutateTracker((dataset) => {
      const sp = new Sprint(sprintIri, dataset, DataFactory);
      sp.startDate = new Date();
      sp.endDate = endDate ?? new Date(Date.now() + 14 * 24 * 3600 * 1000);
    });
  }

  /**
   * Complete the sprint now. Unfinished issues (`releaseUrls`) are released back
   * to the backlog (Jira behaviour) so open work never hides inside a completed
   * sprint. The committed points are snapshotted onto the sprint first — after
   * the release the task set no longer reflects what the team committed to.
   */
  async completeSprint(sprintIri: string, releaseUrls: string[] = []): Promise<void> {
    // Snapshot and write against the SAME dataset/ETag: a concurrent membership
    // change between load and PUT then surfaces as a 412 instead of silently
    // pairing a stale commitment with newer tasks.
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) tracker.configure(DEFAULT_TITLE);
    const sp = new Sprint(sprintIri, dataset, DataFactory);
    // Sum the members' estimates before anything is released. Unreadable or
    // deleted members count 0 — the snapshot is reporting data, not a ledger.
    const estimates = await Promise.all(
      [...sp.tasks].map((url) => this.openIssue(url).then((o) => o.issue.estimate ?? 0).catch(() => 0)),
    );
    sp.committedPoints = estimates.reduce((sum, e) => sum + e, 0);
    sp.endDate = new Date();
    for (const url of releaseUrls) sp.tasks.delete(url);
    await this.put(this.trackerUrl, dataset, etag);
  }

  get attachmentsContainerUrl(): string {
    return new URL("attachments/", dirOf(this.trackerUrl)).toString();
  }

  /** Upload a file into the pod and link it from the issue (`wf:attachment`). */
  async uploadAttachment(
    issueUrl: string,
    file: { name: string; type: string; data: ArrayBuffer | Uint8Array },
  ): Promise<string> {
    const doFetch = this.fetchImpl ?? fetch;
    const safe = encodeURIComponent(file.name).replace(/[()'!*]/g, "_");
    const fileUrl = `${this.attachmentsContainerUrl}${crypto.randomUUID()}-${safe}`;
    const put = await doFetch(fileUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file.data as BodyInit,
    });
    if (!put.ok && put.status !== 205) throw new WriteError(fileUrl, put.status);

    const { dataset, etag, issue } = await this.openIssue(issueUrl);
    issue.attachments.add(fileUrl);
    issue.modified = new Date();
    await this.put(issueUrl, dataset, etag);
    return fileUrl;
  }

  /** Unlink an attachment from the issue and delete the file (best-effort). */
  async removeAttachment(issueUrl: string, fileUrl: string): Promise<void> {
    const { dataset, etag, issue } = await this.openIssue(issueUrl);
    issue.attachments.delete(fileUrl);
    issue.modified = new Date();
    await this.put(issueUrl, dataset, etag);
    await (this.fetchImpl ?? fetch)(fileUrl, { method: "DELETE" }).catch(() => undefined);
  }

  async remove(url: string): Promise<void> {
    const doFetch = this.fetchImpl ?? fetch;
    const res = await doFetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 205 && res.status !== 404) throw new WriteError(url, res.status);
  }
}
