// AUTHORED-BY Codex GPT-6.1-Sol

import { Authorization } from "@solid/object";
import { projectMoveData } from "../detail/task-data";
import { InboxAclRecoveryError, ModelError } from "./errors";
import { RdfIO, type Resource, requireEtag } from "./io";
import { TaskMove } from "./move";
import {
  DataFactory,
  documentUrl,
  NS,
  node,
  requireProjectFolder,
  requireTitle,
  Store,
  uniqueSlug,
} from "./rdf";
import { createTask, type TaskDetails, TaskItem, taskDetails, validateTask } from "./task";
import { createTracker, TaskTracker } from "./tracker";
import { type PrivateIndexAccess, TypeIndex } from "./type-index";

const initializationState = `${NS.SCHEDULING}initializationState`;
const initializationOwner = `${NS.SCHEDULING}initializationOwner`;
const cleanupResources = `${NS.SCHEDULING}cleanupResources`;
const cleanupEtag = `${NS.SCHEDULING}cleanupEtag`;
const deletionState = `${NS.SCHEDULING}deletionState`;
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
/** Kept by one create operation, including when a PUT commits without a response. */
export interface ProjectCreation {
  owner: string;
  reservation?: { name: string; dataset: Store } | undefined;
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
   * Required for project initialization, even without a Type Index. Confirm
   * owner-only effective ACL/ACP access at each supplied URL, including private
   * inheritance for containers. For absent resources, check the policy they will
   * inherit before creation. The empty Tasks root may need a policy established.
   * Check only the target and its effective inheritance/overrides; do not require
   * privacy across its descendants or remove deliberate grants on other projects.
   * Return true only when confirmed; unreadable/unsupported policy fails closed.
   */
  ensurePrivateTasksAccess?: (url: string, owner: string) => Promise<boolean>;
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
  async listProjects(
    onError?: (url: string, error: unknown) => void,
    { strict = false } = {},
  ): Promise<StoredProject[]> {
    const urls = new Set(
      (await this.io.list(this.projects, { strict })).filter((url) => url.endsWith(".ttl")),
    );
    if (this.options.typeIndex !== false)
      for (const reg of await this.index.locations(`${NS.WF}Tracker`)) {
        if (reg.kind === "instance") urls.add(documentUrl(reg.location));
        else {
          try {
            const listed = await this.io.list(reg.location, { strict });
            for (const url of listed.filter((member) => member.endsWith(".ttl"))) urls.add(url);
          } catch (error) {
            if (!onError) throw error;
            onError(reg.location, error);
          }
        }
      }
    const projects: StoredProject[] = [];
    for (const url of urls) {
      try {
        const resource = strict ? await this.io.read(url) : await this.readListedResource(url);
        if (!resource) continue;
        const tracker = new TaskTracker(`${resource.url}#this`, resource.dataset, DataFactory);
        if (tracker.isTracker) projects.push({ ...resource, tracker });
      } catch (error) {
        if (!onError) throw error;
        onError(url, error);
      }
    }
    return projects.sort((a, b) => (a.tracker.position ?? 0) - (b.tracker.position ?? 0));
  }
  private async readListedResource(url: string): Promise<Resource | undefined> {
    try {
      return await this.io.read(url);
    } catch (error) {
      // Registrations and container listings can outlive the resources they name.
      if (error instanceof ModelError && [404, 410].includes(error.status)) return undefined;
      throw error;
    }
  }
  private async register(stateStore: string): Promise<void> {
    if (this.options.typeIndex === false) return;
    await this.index.register([
      { forClass: `${NS.WF}Tracker`, location: this.projects, kind: "instanceContainer" },
      { forClass: `${NS.WF}Task`, location: stateStore, kind: "instanceContainer" },
    ]);
  }
  private async protectTasks(url?: string): Promise<void> {
    const verify = this.options.ensurePrivateTasksAccess;
    if (!verify) throw new TypeError("A Tasks ACL/ACP access verifier is required.");
    const target = url ?? new URL("tasks/", this.options.storage).href;
    // Only an empty app root may be created before protection is established.
    if (url === undefined) await this.io.container(target);
    if ((await verify(target, this.options.webId)) !== true) throw new ModelError(403, target);
  }
  async bootstrapInbox(): Promise<StoredProject> {
    await this.protectTasks();
    await this.protectTasks(this.projects);
    await this.retryCleanup("Inbox", true);
    const url = `${this.projects}inbox.ttl`;
    for (let attempt = 0; ; attempt++) {
      try {
        const existing = await this.io.optional(url);
        if (existing) {
          await this.protectTasks(url);
          if (
            node(`${existing.url}#this`, existing.dataset).text(initializationState) === "cleanup"
          ) {
            await this.resumeCleanup(existing, "Inbox", true);
            continue;
          }
          const project = await this.readProject(url);
          const stateStore = project.tracker.stateStore;
          if (!stateStore) throw new TypeError("Inbox has no stateStore.");
          await this.protectTasks(stateStore);
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
  async createProject(
    title: string,
    inbox = false,
    operation: ProjectCreation = { owner: crypto.randomUUID() },
  ): Promise<StoredProject> {
    requireTitle(title);
    await this.protectTasks();
    await this.protectTasks(this.projects);
    // Retry recoverable failures only for this project, never block unrelated titles.
    await this.retryCleanup(title, inbox);
    await this.io.container(this.projects);
    const used = (await this.io.list(this.projects)).map((url) => {
      const path = url.replace(/\/$/, "");
      return path.slice(path.lastIndexOf("/") + 1).replace(/\.ttl$/, "");
    });
    candidates: for (let attempt = 0; attempt < 100; attempt++) {
      const reservation = operation.reservation;
      const name = reservation?.name ?? (inbox ? "inbox" : uniqueSlug(title, used));
      const url = `${this.projects}${name}.ttl`;
      const stateStore = `${this.projects}${name}/`;
      // Auxiliary documents can outlive a deleted project. Never adopt their old grants.
      for (const resource of [url, stateStore]) {
        const acl = await this.io.optional(`${resource}.acl`);
        if (!acl) continue;
        if (reservation) throw new ModelError(409, acl.url, acl.etag);
        if (inbox) await this.repairInboxAcl(resource, acl);
        else {
          used.push(name);
          continue candidates;
        }
      }
      await this.protectTasks(url);
      await this.protectTasks(stateStore);
      let intended = reservation;
      if (!intended) {
        const { dataset } = createTracker(url, title, stateStore, [this.options.webId], this.now());
        node(`${url}#this`, dataset).setText(initializationOwner, operation.owner);
        intended = { name, dataset };
        operation.reservation = intended;
      }
      let resource = reservation ? await this.io.optional(url) : undefined;
      if (resource) {
        const tracker = new TaskTracker(`${url}#this`, resource.dataset, DataFactory);
        if (
          !tracker.isTracker ||
          tracker.stateStore !== stateStore ||
          node(tracker.id, resource.dataset).text(initializationOwner) !== operation.owner
        )
          throw new ModelError(412, url, resource.etag);
        if (node(tracker.id, resource.dataset).text(initializationState) === "ready")
          return { ...resource, tracker };
      } else {
        try {
          resource = await this.io.write(url, intended.dataset, { create: true });
        } catch (error) {
          // Only a definite collision before acquiring a reservation may choose a new slug.
          if (!(error instanceof ModelError && error.status === 412) || inbox || reservation)
            throw error;
          operation.reservation = undefined;
          used.push(name);
          continue;
        }
      }
      let container: Resource | undefined;
      try {
        container = await this.taskContainer(stateStore);
        await this.register(stateStore);
        // Finalize only while this attempt still owns its tracker revision.
        resource = await this.claimResource(resource, `${url}#this`, true);
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
  private async repairInboxAcl(resource: string, acl: Resource): Promise<void> {
    try {
      await this.protectTasks(resource);
    } catch (cause) {
      throw new InboxAclRecoveryError(resource, cause);
    }
    const dataset = new Store();
    const subject = `${acl.url}#owner`;
    const rule = new Authorization(subject, dataset, DataFactory);
    const namespace = "http://www.w3.org/ns/auth/acl#";
    rule.type.add(`${namespace}Authorization`);
    rule.agent.add(this.options.webId);
    for (const mode of ["Read", "Write", "Control"]) rule.mode.add(namespace + mode);
    node(subject, dataset).setIri(`${namespace}accessTo`, resource);
    if (resource.endsWith("/")) node(subject, dataset).setIri(`${namespace}default`, resource);
    await this.io.write(acl.url, dataset, { etag: acl.etag });
  }
  /** Change representation bytes so even content-based strong validators advance. */
  private async claimResource(
    resource: Resource,
    subject: string,
    ready = false,
  ): Promise<Resource> {
    const dataset = new Store([...resource.dataset]);
    const value = node(subject, dataset);
    if (value.text(initializationState) === "cleanup" || value.text(deletionState) === "pending")
      throw new ModelError(412, resource.url, resource.etag);
    if (ready) value.setText(initializationState, "ready");
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
    if (node(project.tracker.id, project.dataset).text(deletionState) === "pending")
      throw new ModelError(412, project.url, project.etag);
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
  /** Strict reads fail on missing/unreadable resources; membership cleanup can skip invalid tasks. */
  async listTasks(
    stateStore: string,
    { strict = false, skipInvalid = false } = {},
  ): Promise<StoredTask[]> {
    const tasks: StoredTask[] = [];
    for (const url of await this.io.list(stateStore, { strict })) {
      if (!isTaskMember(url, stateStore)) continue;
      const resource = strict ? await this.io.read(url) : await this.readListedResource(url);
      if (!resource) continue;
      if (strict) {
        try {
          const data = taskDetails(resource.url, resource.dataset);
          if (!data) throw new TypeError("Expected a wf:Task.");
          validateTask(data);
        } catch (error) {
          if (skipInvalid) continue;
          throw error;
        }
      }
      const task = new TaskItem(`${resource.url}#it`, resource.dataset, DataFactory);
      if (task.isTask) tasks.push({ ...resource, task });
    }
    return tasks;
  }
  async createTask(
    project: StoredProject,
    data: TaskDetails,
    id = this.uuid(),
    /** Capture the exact payload before a possibly ambiguous write, for ownership checks. */
    onReserved?: (resource: Resource) => void,
  ): Promise<StoredTask> {
    const container = project.tracker.stateStore;
    if (!container?.endsWith("/")) throw new TypeError("Expected a stateStore container.");
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new TypeError("Invalid task identifier.");
    const url = `${container}${id}.ttl`;
    const now = this.now();
    const dataset = createTask(url, {
      ...data,
      project: project.tracker.id,
      created: data.created ?? now,
      modified: now,
    });
    onReserved?.({ url, dataset: new Store([...dataset]), etag: null });
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
  /** Prepare once so Retry uses the same data, destination and reference revisions. */
  prepareTaskMove(
    item: StoredTask,
    source: StoredProject,
    target: StoredProject,
    id = this.uuid(),
  ): TaskMove {
    const container = target.tracker.stateStore;
    if (!container?.endsWith("/")) throw new TypeError("Expected a stateStore container.");
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new TypeError("Invalid task identifier.");
    const url = `${container}${id}.ttl`;
    const now = this.now();
    const dataset = createTask(url, {
      ...projectMoveData(item, source, target),
      created: item.task.created ?? now,
      modified: now,
    });
    return new TaskMove(
      this.io,
      item,
      { url, dataset },
      async () => {
        // Children and occurrences (including reopened copies) may remain in other projects.
        const projects = new Map(
          [source, target, ...(await this.listProjects())].map((project) => [project.url, project]),
        );
        const references = new Map<string, StoredTask>();
        for (const project of projects.values())
          for (const child of await this.listTasks(project.tracker.stateStore as string))
            if (child.task.parent === item.task.id || child.task.clonedFrom === item.task.id)
              references.set(child.url, child);
        return [...references.values()];
      },
      now,
    );
  }
  /** Create, remap child/occurrence links, then delete, reconciling before compensation. */
  async moveTaskToProject(
    item: StoredTask,
    source: StoredProject,
    target: StoredProject,
    id = this.uuid(),
  ): Promise<StoredTask> {
    if (source.url === target.url) return item;
    return this.prepareTaskMove(item, source, target, id).run();
  }
  async deleteTask(item: StoredTask): Promise<void> {
    await this.io.remove(item.url, item.etag);
  }
  /** Each resource keeps its own read validator; a conflict stops further removal. */
  async deleteSection(project: StoredProject, id: string): Promise<StoredProject> {
    if (!project.tracker.sections.some((section) => section.id === id))
      throw new TypeError("Unknown section.");
    for (const item of await this.listTasks(project.tracker.stateStore as string)) {
      if (item.task.types.has(id)) {
        await this.updateTask(item, (task) => task.types.delete(id));
      }
    }
    return this.updateProject(project, (tracker) => tracker.removeSection(id));
  }
  /** Reserve the tracker before removing anything; the persisted marker permits recovery after a restart. */
  async deleteProject(project: StoredProject): Promise<void> {
    const container = requireProjectFolder(project.url, project.tracker.stateStore, this.projects);
    const current = await this.io.optional(project.url);
    if (!current) {
      await this.removeAcl(container);
      await this.removeAcl(project.url);
      return;
    }
    const pending = node(project.tracker.id, current.dataset).text(deletionState) === "pending";
    if (!pending && current.etag !== project.etag)
      throw new ModelError(412, project.url, current.etag);
    const tracker = new TaskTracker(project.tracker.id, current.dataset, DataFactory);
    if (tracker.stateStore !== container) throw new ModelError(412, project.url, current.etag);
    requireProjectFolder(project.url, tracker.stateStore, this.projects);
    const dataset = new Store([...current.dataset]);
    const marker = node(project.tracker.id, dataset);
    marker.setText(deletionState, "pending");
    marker.setText(initializationOwner, crypto.randomUUID());
    const reserved = await this.io.write(project.url, dataset, { etag: current.etag });
    for (const item of await this.listTasks(container))
      await this.removeIfPresent(item.url, item.etag);
    // Auxiliary ACLs are listed by some pods; remove them before the folder DELETE.
    await this.removeAcl(container);
    const resource = await this.io.optional(container);
    if (resource) await this.removeIfPresent(container, resource.etag);
    // Removing an own ACL first falls back to the private projects container.
    await this.removeAcl(project.url);
    await this.removeIfPresent(project.url, reserved.etag);
  }
  private async removeAcl(resource: string): Promise<void> {
    const acl = await this.io.optional(`${resource}.acl`);
    if (acl) await this.removeIfPresent(acl.url, acl.etag);
  }
  private async removeIfPresent(url: string, etag: string | null): Promise<void> {
    try {
      await this.io.remove(url, etag);
    } catch (error) {
      if (!(error instanceof ModelError && error.status === 404)) throw error;
    }
  }
}

/** The suite app has no ldp-container dependency. Keep this stricter task-resource policy local. */
function isTaskMember(value: string, container: string): boolean {
  try {
    const scope = new URL(container);
    const member = new URL(value);
    const child = member.pathname.slice(scope.pathname.length);
    return (
      ["http:", "https:"].includes(scope.protocol) &&
      scope.pathname.endsWith("/") &&
      !/[?#]/.test(container) &&
      member.origin === scope.origin &&
      !member.username &&
      !member.password &&
      !/[?#]/.test(value) &&
      member.pathname.startsWith(scope.pathname) &&
      !/[/\\]/.test(decodeURIComponent(child)) &&
      child.endsWith(".ttl") &&
      child.length > 4
    );
  } catch {
    return false;
  }
}
