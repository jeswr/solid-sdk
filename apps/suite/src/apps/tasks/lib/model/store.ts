// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { ModelError } from "./errors";
import { RdfIO, type Resource, requireEtag } from "./io";
import { DataFactory, documentUrl, NS, node, requireTitle, Store, uniqueSlug } from "./rdf";
import { createTask, type TaskDetails, TaskItem, taskDetails, validateTask } from "./task";
import { createTracker, TaskTracker } from "./tracker";
import { type PrivateIndexAccess, TypeIndex } from "./type-index";

const initializationState = `${NS.SCHEDULING}initializationState`;
const initializationOwner = `${NS.SCHEDULING}initializationOwner`;
const cleanupResources = `${NS.SCHEDULING}cleanupResources`;
const cleanupEtag = `${NS.SCHEDULING}cleanupEtag`;
interface ProjectCleanup {
  resource: Resource;
  resources: Pick<Resource, "url" | "etag">[];
  title: string;
  inbox: boolean;
}
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
  /**
   * Required for project initialization, even without a Type Index. Establish or
   * verify owner-only effective ACL/ACP access on the Tasks root and its existing
   * descendants (including policy overrides), with private inheritance for new
   * resources. Return true only when confirmed; unreadable/unsupported policy fails closed.
   */
  ensurePrivateTasksAccess?: (root: string, owner: string) => Promise<boolean>;
  /** Required for registration; verify/establish effective owner-only ACL/ACP access. */
  ensurePrivateIndexAccess?: PrivateIndexAccess;
}
/** Hook-free port of Pod Manager's one-resource-per-item productivity store. */
export class TaskStore {
  readonly projects: string;
  private readonly io: RdfIO;
  private readonly index: TypeIndex;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly pendingCleanup = new Map<string, ProjectCleanup>();
  constructor(private readonly options: StoreOptions) {
    this.projects = new URL("tasks/projects/", options.storage).href;
    this.io = new RdfIO(options.fetch);
    this.index = new TypeIndex(
      this.io,
      options.storage,
      options.webId,
      options.ensurePrivateIndexAccess,
    );
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
      const tracker = new TaskTracker(`${resource.url}#this`, resource.dataset, DataFactory);
      if (tracker.isTracker) projects.push({ ...resource, tracker });
    }
    return projects.sort((a, b) => (a.tracker.position ?? 0) - (b.tracker.position ?? 0));
  }
  private async register(stateStore: string): Promise<void> {
    if (this.options.typeIndex === false) return;
    await this.index.register([
      { forClass: `${NS.WF}Tracker`, location: this.projects, kind: "instanceContainer" },
      { forClass: `${NS.WF}Task`, location: stateStore, kind: "instanceContainer" },
    ]);
  }
  private async protectTasks(): Promise<void> {
    const verify = this.options.ensurePrivateTasksAccess;
    if (!verify) throw new TypeError("A Tasks ACL/ACP access verifier is required.");
    const root = new URL("tasks/", this.options.storage).href;
    // Only an empty app root may be created before protection is established.
    await this.io.container(root);
    if ((await verify(root, this.options.webId)) !== true) throw new ModelError(403, root);
  }
  async bootstrapInbox(): Promise<StoredProject> {
    await this.protectTasks();
    await this.retryCleanup("Inbox", true);
    const url = `${this.projects}inbox.ttl`;
    for (let attempt = 0; ; attempt++) {
      try {
        const existing = await this.io.optional(url);
        if (existing) {
          if (
            node(`${existing.url}#this`, existing.dataset).text(initializationState) === "cleanup"
          ) {
            await this.resumeCleanup(existing, "Inbox", true);
            continue;
          }
          const project = await this.readProject(url);
          const stateStore = project.tracker.stateStore;
          if (!stateStore) throw new TypeError("Inbox has no stateStore.");
          // The tracker coordinates adoption and cleanup; existing LDP containers
          // cannot be replaced with PUT on Community Solid Server.
          let resource = await this.claimResource(project, project.tracker.id);
          await this.taskContainer(stateStore);
          await this.register(stateStore);
          resource = await this.claimResource(resource, project.tracker.id);
          return {
            ...resource,
            tracker: new TaskTracker(project.tracker.id, resource.dataset, DataFactory),
          };
        }
        return await this.createProject("Inbox", true);
      } catch (error) {
        // A concurrent first-use client won the reservation. Re-read and repair it.
        if (!(error instanceof ModelError && error.status === 412 && attempt < 2)) throw error;
      }
    }
  }
  async createProject(title: string, inbox = false): Promise<StoredProject> {
    requireTitle(title);
    await this.protectTasks();
    // Retry recoverable failures only for this project, never block unrelated titles.
    await this.retryCleanup(title, inbox);
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
      let container: Resource | undefined;
      try {
        container = await this.taskContainer(stateStore);
        await this.register(stateStore);
        // Finalize only while this attempt still owns its tracker revision.
        resource = await this.claimResource(resource, `${url}#this`);
      } catch (error) {
        const cleanup = { resource, resources: container ? [container] : [], title, inbox };
        this.pendingCleanup.set(resource.url, cleanup);
        try {
          await this.cleanupProject(cleanup);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Project creation and cleanup failed.");
        }
        throw error;
      }
      return {
        ...resource,
        tracker: new TaskTracker(`${url}#this`, resource.dataset, DataFactory),
      };
    }
    throw new ModelError(409, this.projects);
  }
  /** Change representation bytes so even content-based strong validators advance. */
  private async claimResource(resource: Resource, subject: string): Promise<Resource> {
    const dataset = new Store([...resource.dataset]);
    const value = node(subject, dataset);
    if (value.text(initializationState) === "cleanup")
      throw new ModelError(412, resource.url, resource.etag);
    const previous = value.date(`${NS.DCT}modified`)?.getTime() ?? -Infinity;
    value.setDate(`${NS.DCT}modified`, new Date(Math.max(this.now().getTime(), previous + 1)));
    return this.io.write(resource.url, dataset, { etag: resource.etag });
  }
  private async retryCleanup(title: string, inbox: boolean): Promise<void> {
    for (const cleanup of this.pendingCleanup.values())
      if (cleanup.title === title && cleanup.inbox === inbox) await this.cleanupProject(cleanup);
  }
  private async taskContainer(url: string): Promise<Resource | undefined> {
    const dataset = new Store();
    // Distinguish generations on servers that preserve client container metadata;
    // CSS ignores PUT bodies and generates its own creation/modification metadata.
    node(url, dataset).setText(initializationOwner, crypto.randomUUID());
    return this.io.container(url, dataset);
  }
  private async resumeCleanup(resource: Resource, title: string, inbox: boolean): Promise<void> {
    const marker = node(`${resource.url}#this`, resource.dataset);
    if (!marker.text(initializationOwner)) throw new ModelError(412, resource.url, resource.etag);
    const tracker = new TaskTracker(marker.value, resource.dataset, DataFactory);
    const resources = [...marker.iris(cleanupResources)].map((url) => {
      // A malformed marker must never authorize deleting an unrelated resource.
      if (url !== tracker.stateStore) throw new ModelError(412, resource.url, resource.etag);
      return { url, etag: requireEtag(node(url, resource.dataset).text(cleanupEtag) ?? null) };
    });
    const cleanup = { resource, resources, title, inbox };
    this.pendingCleanup.set(resource.url, cleanup);
    if (!(await this.cleanupProject(cleanup)))
      throw new ModelError(412, resource.url, resource.etag);
  }
  private async cleanupProject(cleanup: ProjectCleanup): Promise<boolean> {
    try {
      const dataset = new Store([...cleanup.resource.dataset]);
      const marker = node(`${cleanup.resource.url}#this`, dataset);
      marker.setText(initializationState, "cleanup");
      marker.setText(initializationOwner, crypto.randomUUID());
      marker.iris(cleanupResources).clear();
      for (const resource of cleanup.resources) {
        marker.iris(cleanupResources).add(resource.url);
        node(resource.url, dataset).setText(cleanupEtag, requireEtag(resource.etag));
      }
      // Persist the recovery record and conditionally claim its ownership before
      // every deletion pass. Stale creators/recoverers cannot acquire this fence.
      cleanup.resource = await this.io.write(cleanup.resource.url, dataset, {
        etag: cleanup.resource.etag,
      });
      for (const resource of cleanup.resources) {
        try {
          await this.io.remove(resource.url, resource.etag);
        } catch (error) {
          if (!(error instanceof ModelError && [404, 412].includes(error.status))) throw error;
        }
      }
      cleanup.resources = [];
      await this.io.remove(cleanup.resource.url, cleanup.resource.etag);
    } catch (error) {
      // Ownership loss is terminal. Retrying with an obsolete validator can never
      // succeed and must never remove an adopted project or its container.
      if (!(error instanceof ModelError && [404, 412].includes(error.status))) throw error;
      this.pendingCleanup.delete(cleanup.resource.url);
      return false;
    }
    this.pendingCleanup.delete(cleanup.resource.url);
    return true;
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
      const task = new TaskItem(`${resource.url}#it`, resource.dataset, DataFactory);
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
