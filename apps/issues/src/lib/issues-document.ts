import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Store, DataFactory, Writer } from "n3";
import type { DatasetCore } from "@rdfjs/types";
import { Issue, Tracker } from "./issue";
import { wf, rdf } from "./vocab";
import { ConflictError, WriteError } from "./errors";

const TRACKER_FRAGMENT = "#tracker";
const DEFAULT_TRACKER_TITLE = "Issues";

/**
 * Parse the `WAC-Allow` header to learn the signed-in user's effective access,
 * e.g. `user="read write append control",public="read"`. Absent header → assume
 * writable (servers without WAC-Allow, or the owner's own pod).
 */
function wacAllowsWrite(response: Response): boolean {
  const header = response.headers.get("wac-allow");
  if (!header) return true;
  const user = /user\s*=\s*"([^"]*)"/i.exec(header);
  if (!user) return true;
  const modes = user[1].toLowerCase().split(/\s+/);
  return modes.includes("write") || modes.includes("append");
}

export interface NewIssueInput {
  title: string;
  description?: string;
  assignee?: string;
  dateDue?: Date;
  /** WebID of the filer; set by the caller from the session. */
  creator?: string;
}

export type IssuePatch = Partial<Omit<NewIssueInput, "creator">>;

/**
 * Read-modify-write wrapper over the single issues document. The flow is always
 * load → mutate via typed accessors → conditional PUT (AGENTS.md §Writing data).
 * `fetchImpl` is injected in tests only; production uses the auth-patched global.
 *
 * Open a fresh instance per write batch so the ETag is current — a 412 surfaces
 * as {@link ConflictError} for the UI to retry.
 */
export class IssuesDocument {
  private constructor(
    readonly url: string,
    private readonly dataset: DatasetCore,
    private etag: string | null,
    /** Whether the signed-in user may write here (from the WAC-Allow header). */
    readonly canWrite: boolean,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  /** Load the document; a 404 yields an empty, ready-to-write document. */
  static async open(url: string, fetchImpl?: typeof fetch): Promise<IssuesDocument> {
    try {
      const { dataset, etag, response } = await fetchRdf(url, fetchImpl ? { fetch: fetchImpl } : undefined);
      return new IssuesDocument(url, dataset, etag, wacAllowsWrite(response), fetchImpl);
    } catch (e) {
      // 404 → the document doesn't exist yet; the user can create it (owner path).
      if (e instanceof RdfFetchError && e.status === 404) {
        return new IssuesDocument(url, new Store(), null, true, fetchImpl);
      }
      throw e;
    }
  }

  private get trackerIri(): string {
    return `${this.url}${TRACKER_FRAGMENT}`;
  }

  /** Ensure the tracker config node exists before the first issue is written. */
  private ensureTracker(): void {
    const tracker = new Tracker(this.trackerIri, this.dataset, DataFactory);
    if (!tracker.title) tracker.configure(DEFAULT_TRACKER_TITLE);
  }

  get tracker(): Tracker {
    return new Tracker(this.trackerIri, this.dataset, DataFactory);
  }

  /** All issues, newest first. */
  list(): Issue[] {
    const subjects = new Set<string>();
    for (const q of this.dataset.match(
      null,
      DataFactory.namedNode(rdf("type")),
      DataFactory.namedNode(wf("Task")),
    )) {
      subjects.add(q.subject.value);
    }
    return [...subjects]
      .map((s) => new Issue(s, this.dataset, DataFactory))
      .sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0));
  }

  get(id: string): Issue | undefined {
    const found = this.dataset.has(
      DataFactory.quad(
        DataFactory.namedNode(id),
        DataFactory.namedNode(rdf("type")),
        DataFactory.namedNode(wf("Task")),
      ),
    );
    return found ? new Issue(id, this.dataset, DataFactory) : undefined;
  }

  create(input: NewIssueInput): Issue {
    const id = `${this.url}#issue-${crypto.randomUUID()}`;
    const issue = new Issue(id, this.dataset, DataFactory);
    const now = new Date();
    issue.state = "open"; // also sets the wf:Task type
    issue.title = input.title;
    issue.description = input.description;
    issue.assignee = input.assignee;
    issue.dateDue = input.dateDue;
    issue.creator = input.creator;
    issue.tracker = this.trackerIri;
    issue.created = now;
    issue.modified = now;
    this.ensureTracker();
    return issue;
  }

  update(id: string, patch: IssuePatch): Issue {
    const issue = this.require(id);
    if ("title" in patch) issue.title = patch.title;
    if ("description" in patch) issue.description = patch.description;
    if ("assignee" in patch) issue.assignee = patch.assignee;
    if ("dateDue" in patch) issue.dateDue = patch.dateDue;
    issue.modified = new Date();
    return issue;
  }

  setState(id: string, state: "open" | "closed"): Issue {
    const issue = this.require(id);
    issue.state = state;
    issue.modified = new Date();
    return issue;
  }

  remove(id: string): void {
    const subject = DataFactory.namedNode(id);
    for (const q of [...this.dataset.match(subject)]) this.dataset.delete(q);
  }

  private require(id: string): Issue {
    const issue = this.get(id);
    if (!issue) throw new Error(`No issue with id ${id}`);
    return issue;
  }

  private serialize(): Promise<string> {
    const writer = new Writer({ format: "text/turtle" });
    for (const q of this.dataset) writer.addQuad(q);
    return new Promise((resolve, reject) =>
      writer.end((err, result) => (err ? reject(err) : resolve(result))),
    );
  }

  /** Serialise and conditionally PUT. Throws {@link ConflictError} on 412. */
  async save(): Promise<void> {
    const body = await this.serialize();
    const doFetch = this.fetchImpl ?? fetch;
    const headers: Record<string, string> = { "content-type": "text/turtle" };
    if (this.etag) headers["if-match"] = this.etag;
    else headers["if-none-match"] = "*"; // creating: refuse to clobber a doc that appeared since load

    const res = await doFetch(this.url, { method: "PUT", headers, body });
    if (res.status === 412) throw new ConflictError(this.url);
    if (!res.ok && res.status !== 205) throw new WriteError(this.url, res.status);

    const newEtag = res.headers.get("etag");
    this.etag = newEtag ?? null; // null → next save must re-open for a fresh validator
  }
}
