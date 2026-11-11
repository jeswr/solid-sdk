// AUTHORED-BY Codex GPT-6.1-Sol
import { isomorphic } from "rdf-isomorphic";
import { ModelError } from "../model/errors";
import { RdfIO, type Resource } from "../model/io";
import type { TaskMove } from "../model/move";
import { DataFactory, documentUrl, NS, requireTitle, Store } from "../model/rdf";
import { type StoredProject, type StoredTask, type StoreOptions, TaskStore } from "../model/store";
import { createTask, type TaskDetails, type TaskItem, validateTask } from "../model/task";
import type { TaskTracker } from "../model/tracker";
import { TypeIndex } from "../model/type-index";
import { allowsWrite, discoverIssues, inside } from "./discovery";
import { IssueItem, IssuesTracker, isIssuesProject, syncIssueState } from "./model";

/** Compatibility at the I/O boundary; TasksCache still owns queues, rollback and conflict toasts. */
export class IssuesTaskStore extends TaskStore {
  readonly issuesIO: RdfIO;
  private permissions = new Map<string, string | null>();
  private trackers = new Map<string, StoredProject>();
  private opened = new Set<string>();
  constructor(private readonly config: StoreOptions) {
    const permissions = new Map<string, string | null>();
    const trackedFetch: typeof fetch = async (input, init) => {
      const response = await config.fetch(input, init);
      if (response.ok && (!init?.method || init.method === "GET"))
        permissions.set(documentUrl(String(input)), response.headers.get("WAC-Allow"));
      return response;
    };
    super({ ...config, fetch: trackedFetch });
    this.permissions = permissions;
    this.issuesIO = new RdfIO(trackedFetch);
  }
  canWrite(url: string, append = false): boolean {
    return allowsWrite(this.permissions.get(url) ?? null, append);
  }
  canEdit(project: StoredProject, task?: StoredTask): boolean {
    return this.canWrite(task?.url ?? project.url);
  }
  canCreate(project: StoredProject): boolean {
    return this.canWrite(project.tracker.stateStore as string, true);
  }
  override prepareTaskMove(
    item: StoredTask,
    source: StoredProject,
    target: StoredProject,
    id?: string,
  ): TaskMove {
    if (item.task instanceof IssueItem || isIssuesProject(source))
      throw new Error("Issues cannot be moved between projects.");
    return super.prepareTaskMove(item, source, target, id);
  }
  override async readProject(url: string): Promise<StoredProject> {
    const project = await super.readProject(url);
    if (!isIssuesProject(project)) return project;
    project.tracker = new IssuesTracker(project.tracker.id, project.dataset, DataFactory);
    const container = project.tracker.stateStore as string;
    if (!inside(container, new URL("./", project.url).href) || !container.endsWith("/"))
      throw new ModelError(400, container);
    this.trackers.set(container, project);
    return project;
  }
  override async listProjects(
    onError?: (url: string, error: unknown) => void,
    { strict = false } = {},
  ): Promise<StoredProject[]> {
    const urls = new Set(
      (await this.issuesIO.list(this.projects, { strict })).filter(
        (url) => inside(url, this.projects) && url.endsWith(".ttl"),
      ),
    );
    if (this.config.typeIndex !== false) {
      try {
        const registrations = await new TypeIndex(
          this.issuesIO,
          this.config.storage,
          this.config.webId,
        ).locations(`${NS.WF}Tracker`);
        for (const registration of registrations) {
          if (!inside(registration.location, this.config.storage)) continue;
          if (registration.kind === "instance") urls.add(documentUrl(registration.location));
          else {
            try {
              for (const url of await this.issuesIO.list(registration.location, { strict }))
                if (inside(url, registration.location) && url.endsWith(".ttl")) urls.add(url);
            } catch (error) {
              onError?.(registration.location, error);
            }
          }
        }
      } catch {
        /* Public discovery and conventional projects still work without an index. */
      }
    }
    for (const url of [
      ...this.opened,
      ...(await discoverIssues(this.config.webId, this.issuesIO, this.config.storage)),
    ])
      urls.add(url);
    const result = new Map<string, StoredProject>();
    for (const url of urls) {
      try {
        result.set(url, await this.readProject(url));
      } catch (error) {
        if (!(error instanceof ModelError && error.status === 404)) onError?.(url, error);
      }
    }
    return [...result.values()];
  }
  async openTracker(input: string): Promise<string[]> {
    let urls: string[];
    try {
      // WebIDs can end in .ttl too; inspect RDF rather than guessing from the path.
      const project = await this.readProject(documentUrl(input));
      urls = [project.url];
    } catch {
      urls = await discoverIssues(input, this.issuesIO);
    }
    if (!urls.length) throw new ModelError(404, input);
    for (const candidate of urls) this.opened.add(candidate);
    return urls;
  }
  override async updateProject(
    project: StoredProject,
    change: (tracker: TaskTracker) => void,
  ): Promise<StoredProject> {
    if (isIssuesProject(project) && !this.canWrite(project.url))
      throw new ModelError(403, project.url);
    const updated = await super.updateProject(project, (tracker) => {
      change(tracker);
      if (isIssuesProject(project))
        for (const label of tracker.labels) tracker.categories.add(label.id);
    });
    if (!isIssuesProject(project)) return updated;
    updated.tracker = new IssuesTracker(updated.tracker.id, updated.dataset, DataFactory);
    this.trackers.set(updated.tracker.stateStore as string, updated);
    return updated;
  }
  override async readTask(url: string): Promise<StoredTask> {
    const project = [...this.trackers].find(([container]) => inside(url, container))?.[1];
    if (!project) return super.readTask(url);
    const resource = await this.issuesIO.read(documentUrl(url));
    const subject = [
      ...resource.dataset.match(
        null,
        DataFactory.namedNode(`${NS.RDF}type`),
        DataFactory.namedNode(`${NS.WF}Task`),
      ),
    ].find(
      (quad) =>
        quad.subject.termType === "NamedNode" && documentUrl(quad.subject.value) === resource.url,
    )?.subject.value;
    if (!subject) throw new TypeError("Expected a wf:Task.");
    return { ...resource, task: new IssueItem(subject, resource.dataset, DataFactory) };
  }
  override async listTasks(
    container: string,
    { strict = false, skipInvalid = false } = {},
  ): Promise<StoredTask[]> {
    if (!this.trackers.has(container)) return super.listTasks(container, { strict, skipInvalid });
    const tasks: StoredTask[] = [];
    for (const url of await this.issuesIO.list(container, { strict })) {
      if (!inside(url, container) || !url.endsWith(".ttl")) continue;
      try {
        tasks.push(await this.readTask(url));
      } catch (error) {
        if (strict && !skipInvalid) throw error;
        /* Per-issue ACLs may hide a member. */
      }
    }
    return tasks;
  }
  override async createTask(
    project: StoredProject,
    data: TaskDetails,
    id = crypto.randomUUID(),
    onReserved?: (resource: Resource) => void,
  ): Promise<StoredTask> {
    if (!isIssuesProject(project)) return super.createTask(project, data, id, onReserved);
    if (!this.canCreate(project)) throw new ModelError(403, project.tracker.stateStore as string);
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new TypeError("Invalid task identifier.");
    // An existing tracker may not have any issue documents or container yet.
    await this.issuesIO.container(project.tracker.stateStore as string);
    if (!this.canCreate(project)) throw new ModelError(403, project.tracker.stateStore as string);
    const url = `${project.tracker.stateStore}${id}.ttl`;
    const now = this.config.now?.() ?? new Date();
    const dataset = createTask(url, {
      ...data,
      project: project.tracker.id,
      created: data.created ?? now,
      modified: now,
    });
    const task = new IssueItem(`${url}#it`, dataset, DataFactory);
    task.priority = data.priority;
    syncIssueState(task, project);
    onReserved?.({ url, dataset: new Store([...dataset]), etag: null });
    const resource = await this.issuesIO.write(url, dataset, { create: true });
    return { ...resource, task: new IssueItem(task.id, resource.dataset, DataFactory) };
  }
  override async updateTask(
    item: StoredTask,
    change: (task: TaskItem) => void,
  ): Promise<StoredTask> {
    const project = [...this.trackers.values()].find((project) =>
      inside(item.url, project.tracker.stateStore as string),
    );
    if (!project) return super.updateTask(item, change);
    if (!this.canEdit(project, item)) throw new ModelError(403, item.url);
    const dataset = new Store([...item.dataset]);
    const task = new IssueItem(item.task.id, dataset, DataFactory);
    const state = task.state;
    change(task);
    if (isomorphic([...item.dataset], [...dataset])) return item;
    requireTitle(task.title);
    const details: TaskDetails = {
      title: task.title as string,
      state: task.state,
      priority: task.priority,
    };
    if (task.assignee !== undefined) details.assignee = task.assignee;
    if (task.dueDate !== undefined) details.dueDate = task.dueDate;
    validateTask(details);
    if (task.state !== state) syncIssueState(task, project);
    task.modified = this.config.now?.() ?? new Date();
    const resource = await this.issuesIO.write(item.url, dataset, { etag: item.etag });
    return { ...resource, task: new IssueItem(task.id, resource.dataset, DataFactory) };
  }
}
