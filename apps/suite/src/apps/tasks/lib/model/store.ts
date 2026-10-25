// AUTHORED-BY Codex GPT-6.1-Sol

import { ModelError } from "./errors";
import { RdfIO, type Resource } from "./io";
import { DataFactory, documentUrl, NS, requireTitle, Store, uniqueSlug } from "./rdf";
import { createTask, type TaskDetails, TaskItem, taskDetails, validateTask } from "./task";
import { createTracker, TaskTracker } from "./tracker";
import { TypeIndex } from "./type-index";
export interface StoredTask extends Resource {
  task: TaskItem;
}
export interface StoredProject extends Resource {
  tracker: TaskTracker;
}
export interface StoreOptions {
  storage: string;
  webId: string;
  /** Scope-guarded authenticated fetch supplied by the caller, never a global fallback. */
  fetch: typeof globalThis.fetch;
  now?: () => Date;
  uuid?: () => string;
  typeIndex?: boolean;
}
/** Hook-free port of Pod Manager's one-resource-per-item productivity store. */
export class TaskStore {
  readonly projects: string;
  private readonly io: RdfIO;
  private readonly index: TypeIndex;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  constructor(private readonly options: StoreOptions) {
    this.projects = new URL("tasks/projects/", options.storage).href;
    this.io = new RdfIO(options.fetch);
    this.index = new TypeIndex(this.io, options.storage, options.webId);
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }
  async readProject(url: string): Promise<StoredProject> {
    const resource = await this.io.read(documentUrl(url));
    const tracker = new TaskTracker(`${resource.url}#this`, resource.dataset, DataFactory);
    if (!tracker.isTracker) throw new TypeError("Expected a wf:Tracker.");
    return { ...resource, tracker };
  }
  async listProjects(): Promise<StoredProject[]> {
    const urls = new Set((await this.io.list(this.projects)).filter((url) => url.endsWith(".ttl")));
    if (this.options.typeIndex !== false)
      for (const reg of await this.index.locations(`${NS.WF}Tracker`)) {
        if (reg.kind === "instance") urls.add(documentUrl(reg.location));
        else
          for (const url of await this.io.list(reg.location))
            if (url.endsWith(".ttl")) urls.add(url);
      }
    const projects: StoredProject[] = [];
    for (const url of urls) {
      const resource = await this.io.read(url);
      const tracker = new TaskTracker(`${url}#this`, resource.dataset, DataFactory);
      if (tracker.isTracker) projects.push({ ...resource, tracker });
    }
    return projects.sort((a, b) => (a.tracker.position ?? 0) - (b.tracker.position ?? 0));
  }
  private async register(stateStore: string): Promise<void> {
    if (this.options.typeIndex === false) return;
    await this.index.register([
      { forClass: `${NS.WF}Tracker`, location: this.projects, kind: "instanceContainer" },
      { forClass: `${NS.WF}Task`, location: stateStore, kind: "instance" },
    ]);
  }
  async bootstrapInbox(): Promise<StoredProject> {
    const url = `${this.projects}inbox.ttl`;
    for (let attempt = 0; ; attempt++) {
      const existing = await this.io.optional(url);
      if (existing) {
        const project = await this.readProject(url);
        if (!project.tracker.stateStore) throw new TypeError("Inbox has no stateStore.");
        await this.io.container(project.tracker.stateStore);
        await this.register(project.tracker.stateStore);
        return project;
      }
      try {
        return await this.createProject("Inbox", true);
      } catch (error) {
        // A concurrent first-use client won the reservation. Re-read and repair it.
        if (!(error instanceof ModelError && error.status === 412 && attempt < 2)) throw error;
      }
    }
  }
  async createProject(title: string, inbox = false): Promise<StoredProject> {
    requireTitle(title);
    await this.io.container(new URL("tasks/", this.options.storage).href);
    await this.io.container(this.projects);
    const used = (await this.io.list(this.projects)).map((url) => {
      const path = url.replace(/\/$/, "");
      return path.slice(path.lastIndexOf("/") + 1).replace(/\.ttl$/, "");
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      const name = inbox ? "inbox" : uniqueSlug(title, used);
      const url = `${this.projects}${name}.ttl`;
      const stateStore = `${this.projects}${name}/`;
      const { dataset } = createTracker(url, title, stateStore, [this.options.webId], this.now());
      let resource: Resource;
      try {
        resource = await this.io.write(url, dataset, { create: true });
      } catch (error) {
        if (!(error instanceof ModelError && error.status === 412) || inbox) throw error;
        used.push(name);
        continue;
      }
      await this.io.container(stateStore);
      await this.register(stateStore);
      return {
        ...resource,
        tracker: new TaskTracker(`${url}#this`, resource.dataset, DataFactory),
      };
    }
    throw new ModelError(409, this.projects);
  }
  async updateProject(
    project: StoredProject,
    change: (tracker: TaskTracker) => void,
  ): Promise<StoredProject> {
    const dataset = new Store([...project.dataset]);
    const tracker = new TaskTracker(`${project.url}#this`, dataset, DataFactory);
    change(tracker);
    requireTitle(tracker.title);
    tracker.modified = this.now();
    const resource = await this.io.write(project.url, dataset, { etag: project.etag });
    return { ...resource, tracker };
  }
  async readTask(url: string): Promise<StoredTask> {
    const resource = await this.io.read(documentUrl(url));
    const task = new TaskItem(`${resource.url}#it`, resource.dataset, DataFactory);
    if (!task.isTask) throw new TypeError("Expected a wf:Task.");
    return { ...resource, task };
  }
  async listTasks(stateStore: string): Promise<StoredTask[]> {
    const tasks: StoredTask[] = [];
    for (const url of await this.io.list(stateStore)) {
      if (!url.endsWith(".ttl")) continue;
      const resource = await this.io.read(url);
      const task = new TaskItem(`${url}#it`, resource.dataset, DataFactory);
      if (task.isTask) tasks.push({ ...resource, task });
    }
    return tasks;
  }
  async createTask(project: StoredProject, data: TaskDetails): Promise<StoredTask> {
    const container = project.tracker.stateStore;
    if (!container?.endsWith("/")) throw new TypeError("Expected a stateStore container.");
    const id = this.uuid();
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new TypeError("Invalid task identifier.");
    const url = `${container}${id}.ttl`;
    const now = this.now();
    const dataset = createTask(url, {
      ...data,
      project: project.tracker.id,
      created: data.created ?? now,
      modified: now,
    });
    const resource = await this.io.write(url, dataset, { create: true });
    return { ...resource, task: new TaskItem(`${url}#it`, resource.dataset, DataFactory) };
  }
  async updateTask(item: StoredTask, change: (task: TaskItem) => void): Promise<StoredTask> {
    const dataset = new Store([...item.dataset]);
    const task = new TaskItem(`${item.url}#it`, dataset, DataFactory);
    change(task);
    task.modified = this.now();
    const data = taskDetails(item.url, dataset);
    if (!data) throw new TypeError("Expected a wf:Task.");
    validateTask(data);
    const resource = await this.io.write(item.url, dataset, { etag: item.etag });
    return { ...resource, task };
  }
  async deleteTask(item: StoredTask): Promise<void> {
    await this.io.remove(item.url, item.etag);
  }
}
