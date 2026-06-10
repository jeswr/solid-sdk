import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Store, DataFactory, Writer } from "n3";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { Issue, Tracker, Comment, Sprint, SprintsDataset, type IssueState, type IssueType, type Priority, type StatusSlug } from "./issue";
import { wf, rdf } from "./vocab";
import { ConflictError, WriteError } from "./errors";

const TRACKER_FRAGMENT = "#this";
const ISSUE_FRAGMENT = "#this";
const DEFAULT_TITLE = "Issues";

export interface CommentRecord {
  author?: string;
  content: string;
  created?: Date;
  mentions: string[];
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
  /** Attached file URLs in the pod. */
  attachments: string[];
  /** Story-point estimate. */
  estimate?: number;
  /** Backlog rank (lower first). */
  rank?: number;
  created?: Date;
  modified?: Date;
  comments: CommentRecord[];
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
  estimate?: number;
  rank?: number;
  creator?: string;
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

function toRecord(issue: Issue, url: string, canWrite: boolean): IssueRecord {
  return {
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
    attachments: [...issue.attachments],
    estimate: issue.estimate,
    rank: issue.rank,
    created: issue.created,
    modified: issue.modified,
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
  ) {}

  get trackerIri(): string {
    return `${this.trackerUrl}${TRACKER_FRAGMENT}`;
  }
  get containerUrl(): string {
    return new URL("issues/", dirOf(this.trackerUrl)).toString();
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
  async ensureTracker(): Promise<Tracker> {
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) {
      tracker.configure(DEFAULT_TITLE);
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
  async info(): Promise<{ title?: string; labels: { slug: string; label: string }[]; groupMembers: string[]; assigneeGroup?: string }> {
    const { tracker } = await this.loadTracker();
    return {
      title: tracker.title,
      labels: tracker.labelDefs,
      groupMembers: tracker.groupMembers,
      assigneeGroup: tracker.assigneeGroup,
    };
  }

  /** Set the assignee group's members (WebIDs) on the tracker. */
  async setAssigneeGroup(webIds: string[]): Promise<void> {
    const { dataset, etag, tracker, exists } = await this.loadTracker();
    if (!exists || !tracker.title) tracker.configure(DEFAULT_TITLE);
    tracker.setGroupMembers(webIds);
    await this.put(this.trackerUrl, dataset, etag);
  }

  private async put(url: string, dataset: DatasetCore, etag: string | null): Promise<void> {
    const doFetch = this.fetchImpl ?? fetch;
    const headers: Record<string, string> = { "content-type": "text/turtle" };
    if (etag) headers["if-match"] = etag;
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

    const records = await Promise.all(
      memberUrls.map(async (url) => {
        try {
          const { dataset, response } = await fetchRdf(url, opts(this.fetchImpl));
          const subject = issueSubject(dataset, url);
          const issue = new Issue(subject, dataset, DataFactory);
          if (!issue.title && issue.state === "open" && issue.comments.length === 0 && !issue.tracker) return null;
          return toRecord(issue, url, wacAllowsWrite(response));
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

  /** Create a new issue document and return its URL. `input.labels` are display names. */
  async create(input: NewIssueInput): Promise<string> {
    await this.ensureTracker();
    const labelSlugs = await this.declareLabels(input.labels ?? []);
    const url = `${this.containerUrl}${crypto.randomUUID()}.ttl`;
    const dataset: DatasetCore = new Store();
    const issue = new Issue(`${url}${ISSUE_FRAGMENT}`, dataset, DataFactory);
    issue.tracker = this.trackerIri; // set first so status/priority/label IRIs resolve
    const now = new Date();
    issue.status = input.status ?? "todo"; // sets the status (and wf:Open/Closed) + wf:Task
    issue.issueType = input.issueType ?? "task";
    issue.title = input.title;
    issue.description = input.description;
    issue.assignee = input.assignee;
    issue.dateDue = input.dateDue;
    issue.creator = input.creator;
    issue.priority = input.priority;
    issue.labels = labelSlugs;
    issue.parent = input.parent;
    issue.estimate = input.estimate;
    issue.rank = input.rank;
    for (const b of input.blockedBy ?? []) issue.blockedBy.add(b);
    issue.created = now;
    issue.modified = now;
    await this.put(url, dataset, null);
    return url;
  }

  async update(url: string, patch: IssuePatch): Promise<void> {
    const labelSlugs = "labels" in patch && patch.labels ? await this.declareLabels(patch.labels) : undefined;
    const { dataset, etag, issue } = await this.openIssue(url);
    if ("title" in patch) issue.title = patch.title;
    if ("description" in patch) issue.description = patch.description;
    if ("assignee" in patch) issue.assignee = patch.assignee;
    if ("dateDue" in patch) issue.dateDue = patch.dateDue;
    if ("priority" in patch) issue.priority = patch.priority;
    if ("status" in patch && patch.status) issue.status = patch.status;
    if ("issueType" in patch && patch.issueType) issue.issueType = patch.issueType;
    if (labelSlugs) issue.labels = labelSlugs;
    if ("parent" in patch) issue.parent = patch.parent;
    if ("estimate" in patch) issue.estimate = patch.estimate;
    if ("rank" in patch) issue.rank = patch.rank;
    if ("blockedBy" in patch && patch.blockedBy) {
      const set = issue.blockedBy;
      for (const b of [...set]) set.delete(b);
      for (const b of patch.blockedBy) set.add(b);
    }
    issue.modified = new Date();
    await this.put(url, dataset, etag);
  }

  async setState(url: string, state: IssueState): Promise<void> {
    // Closing/reopening maps onto the workflow: closed ⇒ Done, open ⇒ To Do.
    await this.setStatus(url, state === "closed" ? "done" : "todo");
  }

  async setStatus(url: string, status: StatusSlug): Promise<void> {
    const { dataset, etag, issue } = await this.openIssue(url);
    issue.status = status;
    issue.modified = new Date();
    await this.put(url, dataset, etag);
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
   * sprint. `committedPoints` is snapshotted first — after the release the task
   * set no longer reflects what the team committed to.
   */
  async completeSprint(sprintIri: string, releaseUrls: string[] = [], committedPoints?: number): Promise<void> {
    await this.mutateTracker((dataset) => {
      const sp = new Sprint(sprintIri, dataset, DataFactory);
      sp.endDate = new Date();
      if (committedPoints !== undefined) sp.committedPoints = committedPoints;
      for (const url of releaseUrls) sp.tasks.delete(url);
    });
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
