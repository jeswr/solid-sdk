// AUTHORED-BY Codex GPT-6.1-Sol

import { isomorphic } from "rdf-isomorphic";
import { missingLabels } from "../lib/compose/planning";
import { projectMoveData } from "../lib/detail/task-data";
import { ModelError, ProjectMembersSyncError } from "../lib/model/errors";
import type { TaskMove } from "../lib/model/move";
import { DataFactory, isSharedTrackerUrl, requireProjectFolder } from "../lib/model/rdf";
import type { ProjectCreation, StoredProject, StoredTask, TaskStore } from "../lib/model/store";
import { createTask, type TaskDetails, TaskItem } from "../lib/model/task";
import { createTracker, type TaskTracker } from "../lib/model/tracker";
import { runBulk } from "../lib/views/bulk";
import { completedHistoryToKeep, completedParentsToKeep } from "../lib/views/clear-completed";
import { type CompletionPlan, planComplete, planUndo } from "../lib/views/completion";
import { type DropPosition, positionForDrop } from "../lib/views/positions";
import { projectColour } from "../lib/views/project-colours";
import { compareTasks } from "../lib/views/project-groups";
import { type TaskView, toTaskView } from "../lib/views/types";
import { changeProject, changeTask, moveItem, optimisticValue, sortedProjects } from "./mutations";

export interface TaskLoad {
  status: "loading" | "ready" | "error";
  items: StoredTask[];
  /** Cached rows stay visible, but this load is incomplete until revalidation settles. */
  refreshing?: boolean;
  /** Invalid RDF tasks skipped while projecting this project's last load. */
  warningCount?: number;
  error?: unknown;
}
export interface TasksSnapshot {
  status: "loading" | "ready" | "error";
  error?: unknown;
  projects: StoredProject[];
  /** Includes failed tracker reads and registered-container listings.
   * Entries are keyed by tracker or container URL. Resources retain their URL and ETag. */
  tasks: Record<string, TaskLoad>;
  saving: string[];
  views: TaskView[];
}
export interface NewTask extends Omit<TaskDetails, "state"> {
  state?: TaskDetails["state"];
  sectionId?: string | undefined;
  due?: Date | undefined;
  allDay?: string | undefined;
  position?: number | undefined;
  priority?: TaskDetails["priority"];
  recurrence?: TaskDetails["recurrence"];
  reminders?: TaskDetails["reminders"];
  labelIds?: string[] | undefined;
}
type Patch = (state: TasksSnapshot) => TasksSnapshot;
function projectTasks(project: StoredProject, items: StoredTask[]) {
  const valid: StoredTask[] = [];
  const views: TaskView[] = [];
  let warningCount = 0;
  for (const item of items) {
    try {
      views.push(toTaskView(item, project));
      valid.push(item);
    } catch {
      warningCount++;
    }
  }
  return { items: valid, views, warningCount };
}
interface Pending {
  apply: Patch;
  urls: string[];
}
interface UndoRepair {
  run: () => Promise<boolean | undefined>;
  supersede: (current: StoredTask) => boolean;
}
export type MutationFailure = (error: unknown, retry: () => void) => void;
export interface TaskMoveMapping {
  from: string;
  to: string;
}
const replaceProject = (state: TasksSnapshot, project: StoredProject): TasksSnapshot => ({
  ...state,
  projects: [...state.projects.filter((item) => item.url !== project.url), project],
});
function replaceTask(
  state: TasksSnapshot,
  projectUrl: string,
  url: string,
  task?: StoredTask,
): TasksSnapshot {
  const previous = state.tasks[projectUrl];
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [projectUrl]: {
        status: "ready",
        refreshing: previous?.refreshing ?? false,
        warningCount: previous?.warningCount ?? 0,
        items: [
          ...(previous?.items ?? []).filter((item) => item.url !== url),
          ...(task ? [task] : []),
        ],
      },
    },
  };
}
/** Framework-free cache. Writes serialize; pending transforms replay over the confirmed baseline.
 * Reads are generation-fenced and notification refreshes wait for writes to settle. */
export class TasksCache {
  private baseline: TasksSnapshot = {
    status: "loading",
    projects: [],
    tasks: {},
    saving: [],
    views: [],
  };
  private snapshot = this.baseline;
  private pending: Pending[] = [];
  private listeners = new Set<() => void>();
  private moveListeners = new Set<(mapping: TaskMoveMapping) => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private started: Promise<void> | undefined;
  private epoch = 0;
  private reads = new Map<string, Promise<void>>();
  private dirtyReads = new Set<string>();
  private projectRead = 0;
  private taskReadGenerations = new Map<string, number>();
  private projectFailures = new Map<string, unknown>();
  /** Keep the original URL reserved across failures and repeated completion actions. */
  private unresolvedCompletions = new Map<string, () => Promise<CompletionPlan | undefined>>();
  /** A project move keeps one TaskMove per task until it succeeds, so every Retry reuses it. */
  private unresolvedMoves = new Map<
    string,
    { target: string; run: () => Promise<StoredTask | undefined> }
  >();
  /** Where each task moved by this session went (original URL → its copy's URL). */
  private movedTasks = new Map<string, string>();
  private hiddenTasks = new Set<string>();
  /** Failed commit-time reads block queued completed deletes until an explicit strict refresh. */
  private completedDeletionBlocked = true;
  private undoOperations = new WeakMap<CompletionPlan, () => Promise<boolean | undefined>>();
  private completionCopies = new WeakMap<CompletionPlan, StoredTask>();
  private undoRepairs = new Map<string, UndoRepair>();
  private sharedProjects = new Map<string, string>();
  private ownProjects = new Set<string>();
  private removedSharedProjects = new Set<string>();
  /** Bumped when a shared project is forgotten, so a read already in flight is dropped. */
  private sharedGenerations = new Map<string, number>();
  private removedAssignments = new Map<string, Map<string, Map<string, string | null>>>();
  readonly inboxUrl: string;
  isOwnProject(url: string) {
    return this.ownProjects.has(url) || url.startsWith(this.store.projects);
  }
  async setSharedProjects(projects: readonly { url: string; title: string }[]) {
    const next = new Map(
      projects
        .filter((project) => isSharedTrackerUrl(project.url))
        .map((project) => [project.url, project.title]),
    );
    for (const url of this.sharedProjects.keys()) if (!next.has(url)) this.forgetSharedProject(url);
    for (const url of next.keys()) this.removedSharedProjects.delete(url);
    this.sharedProjects = next;
    await this.start();
    if (this.baseline.status === "error") return;
    await this.refreshProjects().catch((error: unknown) => {
      this.onFailure(error, () => {
        void this.setSharedProjects(projects);
      });
    });
  }
  hasSharedProject(url: string): boolean {
    return this.sharedProjects.has(url);
  }
  forgetSharedProject(url: string) {
    this.removedSharedProjects.add(url);
    this.sharedGenerations.set(url, (this.sharedGenerations.get(url) ?? 0) + 1);
    this.sharedProjects.delete(url);
    this.projectFailures.delete(url);
    ++this.projectRead;
    this.taskReadGenerations.set(url, (this.taskReadGenerations.get(url) ?? 0) + 1);
    const tasks = { ...this.baseline.tasks };
    delete tasks[url];
    this.baseline = {
      ...this.baseline,
      projects: this.baseline.projects.filter((project) => project.url !== url),
      tasks,
    };
    this.emit();
  }
  private validateSharedProject(project: StoredProject) {
    if (!isSharedTrackerUrl(project.url)) throw new ModelError(400, project.url);
    requireProjectFolder(project.url, project.tracker.stateStore);
  }
  /**
   * The user navigated to this project: a project removed from Shared with me may be opened
   * again. Background re-renders and retries on the same route keep it removed.
   */
  allowSharedProject(url: string) {
    this.removedSharedProjects.delete(url);
  }
  /** Read a project that isn't one of the user's own. */
  async openProject(url: string): Promise<StoredProject | undefined> {
    if (!isSharedTrackerUrl(url) || this.removedSharedProjects.has(url)) return undefined;
    const generation = this.sharedGenerations.get(url) ?? 0;
    const stale = () => (this.sharedGenerations.get(url) ?? 0) !== generation;
    await this.start();
    if (stale()) return undefined;
    const existing = this.baseline.projects.find((project) => project.url === url);
    if (existing) return existing;
    this.baseline = {
      ...this.baseline,
      tasks: { ...this.baseline.tasks, [url]: { status: "loading", items: [] } },
    };
    this.emit();
    try {
      const project = await this.store.readProject(url);
      this.validateSharedProject(project);
      if (stale()) return undefined;
      this.sharedProjects.set(url, project.tracker.title ?? "Project");
      this.baseline = replaceProject(this.baseline, project);
      this.projectFailures.delete(url);
      this.emit();
      return project;
    } catch (error) {
      if (stale()) return undefined;
      this.baseline = {
        ...this.baseline,
        tasks: { ...this.baseline.tasks, [url]: { status: "error", items: [], error } },
      };
      this.emit();
      return undefined;
    }
  }
  constructor(
    readonly store: TaskStore,
    private readonly onFailure: MutationFailure,
    private readonly webId: string,
    private readonly onNotice: (message: string) => void = () => {},
  ) {
    this.inboxUrl = `${store.projects}inbox.ttl`;
  }
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Successful moves, including toast retries, share one route-independent notification. */
  readonly subscribeTaskMoves = (listener: (mapping: TaskMoveMapping) => void) => {
    this.moveListeners.add(listener);
    return () => {
      this.moveListeners.delete(listener);
    };
  };
  private emit() {
    const visible = optimisticValue(
      this.baseline,
      this.pending.map((entry) => entry.apply),
    );
    const tasks = { ...visible.tasks };
    const views: TaskView[] = [];
    const projects = sortedProjects(visible.projects, this.inboxUrl);
    for (const project of projects) {
      const load = tasks[project.url];
      if (!load) continue;
      if (this.projectFailures.has(project.url)) {
        tasks[project.url] = {
          status: "error",
          items: [],
          error: this.projectFailures.get(project.url),
        };
        continue;
      }
      const projected = projectTasks(
        project,
        load.items.filter((item) => !this.hiddenTasks.has(item.url)),
      );
      tasks[project.url] = {
        ...load,
        items: projected.items,
        warningCount: (load.warningCount ?? 0) + projected.warningCount,
      };
      views.push(...projected.views);
    }
    this.snapshot = {
      ...visible,
      tasks,
      views,
      projects,
      saving: this.pending.flatMap((entry) => entry.urls),
    };
    for (const listener of this.listeners) listener();
  }
  start(): Promise<void> {
    this.started ??= this.bootstrap();
    return this.started;
  }
  private async bootstrap() {
    try {
      await this.store.bootstrapInbox();
      await this.refreshProjects();
    } catch (error) {
      this.baseline = { ...this.baseline, status: "error", error };
      this.emit();
    }
  }
  readonly retry = () => {
    this.started = undefined;
    this.baseline = { ...this.baseline, status: "loading" };
    this.emit();
    void this.start();
  };
  async refreshProjects(strict = false): Promise<void> {
    const epoch = this.epoch;
    const generation = ++this.projectRead;
    const failures = new Map<string, unknown>();
    const projects = await this.store
      .listProjects((url, error) => failures.set(url, error), { strict })
      .catch((error: unknown) => {
        this.completedDeletionBlocked = true;
        throw error;
      });
    const ownProjects = new Set(projects.map((project) => project.url));
    for (const url of this.sharedProjects.keys()) {
      if (ownProjects.has(url)) continue;
      try {
        const project = await this.store.readProject(url);
        this.validateSharedProject(project);
        projects.push(project);
      } catch (error) {
        failures.set(url, error);
      }
    }
    if (failures.size) this.completedDeletionBlocked = true;
    if (epoch !== this.epoch || generation !== this.projectRead) return;
    this.ownProjects = ownProjects;
    const tasks = { ...this.baseline.tasks };
    for (const project of projects) {
      const previous = this.baseline.projects.find((item) => item.url === project.url);
      if (
        this.projectFailures.has(project.url) ||
        (previous && previous.tracker.stateStore !== project.tracker.stateStore)
      ) {
        tasks[project.url] = { status: "loading", items: [] };
        this.dirtyReads.add(project.url);
        this.taskReadGenerations.set(
          project.url,
          (this.taskReadGenerations.get(project.url) ?? 0) + 1,
        );
      }
    }
    this.projectFailures = failures;
    for (const [url, error] of failures) {
      tasks[url] = { status: "error", items: [], error };
      const previous = this.baseline.projects.find((project) => project.url === url);
      if (previous) projects.push(previous);
    }
    for (const url of Object.keys(tasks))
      if (!projects.some((project) => project.url === url) && !failures.has(url)) delete tasks[url];
    this.baseline = { ...this.baseline, projects, tasks, status: "ready", error: undefined };
    this.emit();
  }
  async retryProject(url: string): Promise<void> {
    await this.refreshProjects();
    const project =
      this.baseline.projects.find((item) => item.url === url) ??
      (url.endsWith("/") ? undefined : await this.openProject(url));
    if (project && !this.projectFailures.has(url)) await this.loadTasks(project, true);
  }
  loadTasks(project: StoredProject, force = false): Promise<void> {
    const current = this.baseline.projects.find((item) => item.url === project.url);
    if (current) project = current;
    if (this.projectFailures.has(project.url)) {
      if (!force) return Promise.resolve();
      return this.retryProject(project.url);
    }
    if (!current) return Promise.resolve();
    const existing = this.reads.get(project.url);
    if (existing) {
      if (force) this.dirtyReads.add(project.url);
      return existing;
    }
    if (
      !force &&
      this.baseline.tasks[project.url] &&
      this.baseline.tasks[project.url]?.status !== "loading"
    )
      return Promise.resolve();
    this.dirtyReads.delete(project.url);
    const request = this.readTasks(project).finally(() => {
      this.reads.delete(project.url);
      const dirty = this.dirtyReads.has(project.url);
      if (!this.pending.length && (dirty || this.baseline.tasks[project.url]?.status === "loading"))
        void this.loadTasks(project, true);
    });
    this.reads.set(project.url, request);
    return request;
  }
  private async readTasks(project: StoredProject, strict = false) {
    const epoch = this.epoch;
    const generation = this.taskReadGenerations.get(project.url);
    const stateStore = project.tracker.stateStore as string;
    const isCurrent = () =>
      !this.projectFailures.has(project.url) &&
      generation === this.taskReadGenerations.get(project.url) &&
      this.baseline.projects.some(
        (item) => item.url === project.url && item.tracker.stateStore === stateStore,
      );
    const previous = this.baseline.tasks[project.url];
    this.baseline = {
      ...this.baseline,
      tasks: {
        ...this.baseline.tasks,
        [project.url]: {
          status: previous?.status === "ready" ? "ready" : "loading",
          refreshing: true,
          warningCount: previous?.warningCount ?? 0,
          items: previous?.items ?? [],
        },
      },
    };
    this.emit();
    try {
      const items = await this.store.listTasks(stateStore, { strict });
      if (!isCurrent()) return;
      if (epoch !== this.epoch) {
        this.dirtyReads.add(project.url);
        return;
      }
      this.baseline = {
        ...this.baseline,
        tasks: {
          ...this.baseline.tasks,
          [project.url]: { status: "ready", ...projectTasks(project, items) },
        },
      };
    } catch (error) {
      this.completedDeletionBlocked = true;
      if (!isCurrent()) return;
      if (epoch !== this.epoch) {
        this.dirtyReads.add(project.url);
        return;
      }
      this.baseline = {
        ...this.baseline,
        tasks: { ...this.baseline.tasks, [project.url]: { status: "error", items: [], error } },
      };
    }
    this.emit();
  }
  /** Debouncing belongs to the session adapter. Prefixes include stateStore descendants. */
  async invalidate(url: string): Promise<void> {
    if (this.pending.length) {
      await this.tail;
    }
    try {
      const projects = this.baseline.projects;
      const matches = (project: StoredProject) =>
        url.startsWith(project.tracker.stateStore as string) ||
        (project.tracker.stateStore as string).startsWith(url) ||
        url === project.url;
      const affected = new Set(projects.filter(matches).map((project) => project.url));
      if (
        url.startsWith(this.store.projects) ||
        this.store.projects.startsWith(url) ||
        affected.has(url)
      )
        await this.refreshProjects();
      await Promise.all(
        this.baseline.projects
          .filter(
            (project) =>
              (affected.has(project.url) || matches(project) || this.dirtyReads.has(project.url)) &&
              !this.projectFailures.has(project.url),
          )
          .map((project) => this.loadTasks(project, true)),
      );
    } catch (error) {
      this.onFailure(error, () => {
        void this.invalidate(url);
      });
    }
  }
  private project(url: string): StoredProject {
    if (this.projectFailures.has(url)) throw this.projectFailures.get(url);
    const project = this.baseline.projects.find((item) => item.url === url);
    if (!project) throw new ModelError(404, url);
    return project;
  }
  private task(projectUrl: string, url: string): StoredTask {
    const task = this.baseline.tasks[projectUrl]?.items.find((item) => item.url === url);
    if (!task) throw new ModelError(404, url);
    return task;
  }
  private mutate<T>(
    apply: Patch,
    write: () => Promise<{ result: T; commit: Patch }>,
    retry: () => void,
    urls: string[] = [],
    onFailure: MutationFailure = this.onFailure,
    signal?: AbortSignal,
    strictReconciliation = false,
  ): Promise<T | undefined> {
    const entry = { apply, urls };
    this.pending.push(entry);
    ++this.epoch;
    this.emit();
    const run = this.tail.then(async () => {
      try {
        // Cancellation can happen while this operation waits behind another mutation.
        if (signal?.aborted) return undefined;
        const { result, commit } = await write();
        this.baseline = commit(this.baseline);
        return result;
      } catch (error) {
        // A section/project operation can partially succeed; reconcile its confirmed resources.
        try {
          await this.refreshProjects(strictReconciliation);
          for (const project of this.baseline.projects)
            if (this.baseline.tasks[project.url] && !this.baseline.tasks[project.url]?.error)
              await this.readTasks(project, strictReconciliation);
          if (this.completedDeletionIncomplete()) this.completedDeletionBlocked = true;
        } catch {
          this.completedDeletionBlocked = true;
          /* The baseline plus the remaining queue is still safe to render. */
        }
        onFailure(error, retry);
        return undefined;
      } finally {
        this.pending = this.pending.filter((item) => item !== entry);
        ++this.epoch;
        this.emit();
        // Reads invalidated during a write must not leave a permanent loading state.
        if (!this.pending.length)
          for (const project of this.baseline.projects) {
            if (
              this.baseline.tasks[project.url]?.status === "loading" ||
              this.dirtyReads.has(project.url)
            )
              void this.loadTasks(project, true);
          }
      }
    });
    this.tail = run;
    return run;
  }
  createTask(project: StoredProject, data: NewTask): Promise<StoredTask | undefined> {
    return this.prepareTaskCreate(project, data)();
  }
  /** One queue reservation protects an import while independent task documents write four at a time. */
  importTasks(
    project: StoredProject,
    entries: readonly { id: string; parentId: string | null; data: NewTask }[],
    signal: AbortSignal,
    onProgress: (completed: number) => void,
  ) {
    return this.mutate(
      (state) => state,
      async () => {
        const current = this.project(project.url);
        const outcomes = new Map<string, Promise<StoredTask | undefined>>();
        const confirmed: StoredTask[] = [];
        let failed = 0;
        let completed = 0;
        await runBulk(entries, (entry) => {
          const run = async (): Promise<StoredTask | undefined> => {
            if (signal.aborted) return;
            const parent = entry.parentId ? await outcomes.get(entry.parentId) : undefined;
            if (signal.aborted) return;
            try {
              // Keep the forest intact when a parent failed; unrelated rows still import.
              if (entry.parentId && !parent) throw new Error("The parent could not be imported");
              const data = entry.data;
              const id = crypto.randomUUID();
              const url = `${current.tracker.stateStore}${id}.ttl`;
              let reserved: StoredTask | undefined;
              let task: StoredTask;
              try {
                task = await this.store.createTask(
                  current,
                  {
                    ...data,
                    state: "open",
                    creator: data.creator ?? this.webId,
                    ...(data.allDay
                      ? { dueDate: new Date(`${data.allDay}T00:00:00`) }
                      : data.due
                        ? { dueDate: data.due }
                        : {}),
                    rank: data.position,
                    ...(parent ? { parent: parent.task.id } : {}),
                    categoryTypes: [
                      ...(data.labelIds ?? []),
                      ...(data.sectionId ? [data.sectionId] : []),
                    ],
                  },
                  id,
                  (resource) => {
                    reserved = {
                      ...resource,
                      task: new TaskItem(`${url}#it`, resource.dataset, DataFactory),
                    };
                  },
                );
              } catch (error) {
                // A lost response may have committed. Count only our exact reserved payload.
                const existing = await this.optionalTask(url);
                if (
                  !reserved ||
                  !existing ||
                  !isomorphic([...reserved.dataset], [...existing.dataset])
                )
                  throw error;
                task = existing;
              }
              confirmed.push(task);
              return task;
            } catch {
              failed++;
              return undefined;
            } finally {
              onProgress(++completed);
            }
          };
          const outcome = run();
          outcomes.set(entry.id, outcome);
          return outcome;
        });
        return {
          result: { imported: confirmed.length, failed },
          commit: (state: TasksSnapshot): TasksSnapshot => {
            const previous = state.tasks[project.url];
            const items = new Map((previous?.items ?? []).map((task) => [task.url, task]));
            for (const task of confirmed) items.set(task.url, task);
            return {
              ...state,
              tasks: {
                ...state.tasks,
                [project.url]: { ...previous, status: "ready", items: [...items.values()] },
              },
            };
          },
        };
      },
      () => {},
      [project.url],
      () => {},
    );
  }
  /** One reservation and captured draft shared by every retry, including batch-owned toasts. */
  prepareTaskCreate(
    project: StoredProject,
    data: NewTask,
    onRetry?: () => void,
    /** Stable import identity; a matching UID on 412 belongs to another import. */
    reservation?: { id: string; onConflict: () => void },
  ): () => Promise<StoredTask | undefined> {
    const id = reservation?.id ?? crypto.randomUUID();
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new TypeError("Invalid task identifier.");
    const url = `${project.tracker.stateStore}${id}.ttl`;
    const details: TaskDetails = {
      ...data,
      title: data.title.trim(),
      project: project.tracker.id,
      creator: data.creator ?? this.webId,
      state: data.state ?? "open",
      created: data.created ?? new Date(),
      ...(data.allDay
        ? { dueDate: new Date(`${data.allDay}T00:00:00`) }
        : data.due
          ? { dueDate: data.due }
          : {}),
      allDay: data.allDay,
      rank: this.appendPosition(project, data).position,
      categoryTypes: [
        ...new Set([
          ...(data.categoryTypes ?? []),
          ...(data.sectionId ? [data.sectionId] : []),
          ...(data.labelIds ?? []),
        ]),
      ],
    };
    const dataset = createTask(url, details);
    const optimistic = {
      url,
      dataset,
      task: new TaskItem(`${url}#it`, dataset, DataFactory),
      etag: null,
    };
    const attempt = (reconcile = false): Promise<StoredTask | undefined> =>
      this.mutate(
        (state) => {
          // Reconciliation may already have loaded a create whose response was lost.
          if (state.tasks[project.url]?.items.some((item) => item.url === url)) return state;
          const placement = this.appendPosition(project, data, state);
          let next = state;
          for (const patch of placement.renumber ?? []) {
            const sibling = next.tasks[project.url]?.items.find((item) => item.url === patch.url);
            if (sibling)
              next = replaceTask(
                next,
                project.url,
                sibling.url,
                changeTask(sibling, (task) => {
                  task.rank = patch.position;
                }),
              );
          }
          return replaceTask(
            next,
            project.url,
            url,
            changeTask(optimistic, (task) => {
              task.rank = placement.position;
            }),
          );
        },
        async () => {
          const current = this.project(project.url);
          if (`${current.tracker.stateStore}${id}.ttl` !== url) throw new ModelError(409, url);
          const existing = reconcile ? await this.optionalTask(url) : undefined;
          if (existing && reservation && existing.task.calendarUid !== data.calendarUid)
            throw new ModelError(412, url);
          if (existing)
            return {
              result: existing,
              commit: (state) => replaceTask(state, project.url, url, existing),
            };
          const placement = this.appendPosition(current, data, this.baseline);
          details.rank = placement.position;
          const updated: StoredTask[] = [];
          for (const patch of placement.renumber ?? [])
            updated.push(
              await this.store.updateTask(this.task(project.url, patch.url), (task) => {
                task.rank = patch.position;
              }),
            );
          let task: StoredTask;
          try {
            task = await this.store.createTask(current, details, id);
          } catch (error) {
            if (!reservation || !(error instanceof ModelError) || error.status !== 412) throw error;
            const raced = await this.optionalTask(url);
            if (!raced || !data.calendarUid || raced.task.calendarUid !== data.calendarUid)
              throw error;
            reservation.onConflict();
            task = raced;
          }
          return {
            result: task,
            commit: (state) => {
              let next = state;
              for (const sibling of updated)
                next = replaceTask(next, project.url, sibling.url, sibling);
              return replaceTask(next, project.url, task.url, task);
            },
          };
        },
        onRetry ?? (() => void run()),
        [url],
      );
    let attempted = false;
    let saved: StoredTask | undefined;
    let running: Promise<StoredTask | undefined> | undefined;
    const run = (): Promise<StoredTask | undefined> => {
      if (saved) return Promise.resolve(saved);
      if (running) return running;
      const reconcile = attempted;
      attempted = true;
      running = attempt(reconcile)
        .then((task) => {
          saved = task;
          return task;
        })
        .finally(() => {
          running = undefined;
        });
      return running;
    };
    return run;
  }
  private async optionalTask(url: string): Promise<StoredTask | undefined> {
    try {
      return await this.store.readTask(url);
    } catch (error) {
      if (error instanceof ModelError && [404, 410].includes(error.status)) return undefined;
      throw error;
    }
  }
  private appendPosition(
    project: StoredProject,
    data: NewTask,
    snapshot = this.snapshot,
  ): DropPosition {
    const position = data.position ?? data.rank;
    if (position !== undefined) return { position };
    const sectionId =
      data.sectionId ??
      project.tracker.sections.find((section) => data.categoryTypes?.includes(section.id))?.id;
    const siblings = (snapshot.tasks[project.url]?.items ?? [])
      .map((item) => toTaskView(item, project))
      .filter((task) => task.sectionId === sectionId && task.parentId === data.parent)
      .sort(compareTasks("manual"));
    return siblings.length ? positionForDrop(siblings, siblings.length) : { position: 1 };
  }
  /** Serialize tracker writes with other mutations, rechecking names against the latest baseline. */
  ensureLabels(
    project: StoredProject,
    names: readonly string[],
    onRetry?: () => void,
    onFailure?: MutationFailure,
    signal?: AbortSignal,
  ): Promise<StoredProject | undefined> {
    const current = this.baseline.projects.find((item) => item.url === project.url);
    if (!this.pending.length && current && !missingLabels(current, names).length)
      return Promise.resolve(current);
    const define = (tracker: TaskTracker) => {
      for (const name of missingLabels({ ...project, tracker }, names)) {
        const source = this.snapshot.projects
          .flatMap((item) => item.tracker.labels)
          .find((label) => label.name.toLowerCase() === name.toLowerCase());
        tracker.defineCategory("Label", name, undefined, source?.color);
      }
    };
    return this.updateProject(project, define, onRetry, onFailure, signal);
  }
  updateTask(
    item: StoredTask,
    change: (task: TaskItem) => void,
    /** Composite operations retry their complete intent rather than this write alone. */
    onRetry?: () => void,
  ): Promise<StoredTask | undefined> {
    const project = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    // The tracker link is optional RDF. Container membership determines ownership.
    // A removed/archived record also makes a late UI callback a harmless no-op.
    if (!project) return Promise.resolve(undefined);
    const apply: Patch = (state) => {
      const current = state.tasks[project.url]?.items.find((task) => task.url === item.url);
      return current
        ? replaceTask(state, project.url, item.url, changeTask(current, change))
        : state;
    };
    return this.mutate(
      apply,
      async () => {
        const task = await this.store.updateTask(this.task(project.url, item.url), change);
        this.undoRepairs.get(item.url)?.supersede(task);
        return { result: task, commit: (state) => replaceTask(state, project.url, item.url, task) };
      },
      onRetry ??
        (() => {
          void this.updateTask(item, change);
        }),
      [item.url],
    );
  }
  /**
   * Several task edits as ONE optimistic patch and one serialized write, so a
   * renumbering drop never shows, or persists, a half-applied order. Writes go
   * in order (callers order them so every prefix is safe), each conditional; a
   * lost response counts once the read-back holds exactly our revision. When a
   * write definitely did not land, the confirmed writes are reverted newest
   * first, stopping at the first failed revert so the pod always holds a
   * prefix of the writes. When its outcome is unknown, the forward prefix
   * stays. Either way `onRetry` replays the whole intent.
   */
  updateTasks(
    edits: readonly { item: StoredTask; change: (task: TaskItem) => void }[],
    onRetry: () => void,
  ): Promise<StoredTask[] | undefined> {
    const owned = edits.map((edit) => ({
      ...edit,
      project: this.snapshot.projects.find((project) =>
        this.snapshot.tasks[project.url]?.items.some((task) => task.url === edit.item.url),
      ),
    }));
    if (!owned.length || owned.some((edit) => !edit.project)) return Promise.resolve(undefined);
    const apply: Patch = (state) => {
      let next = state;
      for (const { item, change, project } of owned) {
        const url = (project as StoredProject).url;
        const current = next.tasks[url]?.items.find((task) => task.url === item.url);
        if (current) next = replaceTask(next, url, item.url, changeTask(current, change));
      }
      return next;
    };
    return this.mutate(
      apply,
      async () => {
        const written: { before: StoredTask; after: StoredTask; projectUrl: string }[] = [];
        for (const { item, change, project } of owned) {
          const projectUrl = (project as StoredProject).url;
          const before = this.task(projectUrl, item.url);
          const outcome = await this.writeChange(before, change);
          if ("error" in outcome) {
            if (!outcome.unknown) await this.revertWrites(written);
            throw outcome.error;
          }
          written.push({ before, after: outcome.after, projectUrl });
        }
        for (const { after } of written) this.undoRepairs.get(after.url)?.supersede(after);
        return {
          result: written.map(({ after }) => after),
          commit: (state) =>
            written.reduce(
              (next, { after, projectUrl }) => replaceTask(next, projectUrl, after.url, after),
              state,
            ),
        };
      },
      onRetry,
      owned.map((edit) => edit.item.url),
    );
  }
  /**
   * One conditional write. Without a response the read-back decides: our exact
   * revision (apart from dct:modified) landed; the original ETag did not land;
   * anything else (no read, or another writer's revision) is unknown.
   */
  private async writeChange(
    before: StoredTask,
    change: (task: TaskItem) => void,
  ): Promise<{ after: StoredTask } | { error: unknown; unknown: boolean }> {
    try {
      return { after: await this.store.updateTask(before, change) };
    } catch (error) {
      // A 4xx is a definite rejection; only a lost or failed response may have landed.
      if (error instanceof ModelError && error.status >= 400 && error.status < 500)
        return { error, unknown: false };
      let current: StoredTask | undefined;
      try {
        current = await this.optionalTask(before.url);
      } catch {
        return { error, unknown: true };
      }
      if (current?.etag === before.etag) return { error, unknown: false };
      const stamp = new Date(0);
      const ours = changeTask(before, (task) => {
        change(task);
        task.modified = stamp;
      });
      if (!current) return { error, unknown: true };
      const read = changeTask(current, (task) => {
        task.modified = stamp;
      });
      return isomorphic([...read.dataset], [...ours.dataset])
        ? { after: current }
        : { error, unknown: true };
    }
  }
  /**
   * Restore confirmed writes newest first, each over our own revision only.
   * The first failure stops: older writes stay, so the pod keeps a prefix.
   */
  private async revertWrites(written: readonly { before: StoredTask; after: StoredTask }[]) {
    for (const { before, after } of written.toReversed()) {
      try {
        await this.store.updateTask({ ...before, etag: after.etag }, () => {});
      } catch {
        return; // The failure refresh shows what remains; Retry re-plans from it.
      }
    }
  }
  /** The URL a task moved to in this session, or undefined if it has not moved. */
  movedTo(url: string): string | undefined {
    return this.movedTasks.get(url);
  }
  moveTaskToProject(item: StoredTask, target: StoredProject): Promise<StoredTask | undefined> {
    // A retained move (destination possibly written) must not become a second copy.
    const retained = this.unresolvedMoves.get(item.url);
    if (retained?.target === target.url) return retained.run();
    const source = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!source) return Promise.resolve(undefined);
    if (source.url === target.url) return Promise.resolve(item);
    const id = crypto.randomUUID();
    const url = `${target.tracker.stateStore}${id}.ttl`;
    let operation: TaskMove | undefined;
    let settled: StoredTask | undefined;
    let notified = false;
    const relocate = (state: TasksSnapshot, moved: StoredTask, confirmed = false) => {
      let next = replaceTask(replaceTask(state, source.url, item.url), target.url, url, moved);
      for (const project of state.projects)
        for (const child of state.tasks[project.url]?.items ?? []) {
          const saved = confirmed ? operation?.references.get(child.url) : undefined;
          if (saved || child.task.parent === item.task.id || child.task.clonedFrom === item.task.id)
            next = replaceTask(
              next,
              project.url,
              child.url,
              saved ??
                changeTask(child, (task) => {
                  if (task.parent === item.task.id) task.parent = moved.task.id;
                  if (task.clonedFrom === item.task.id) task.clonedFrom = moved.task.id;
                }),
            );
        }
      return next;
    };
    const attempt = (): Promise<StoredTask | undefined> =>
      this.mutate(
        (state) => {
          const current = state.tasks[source.url]?.items.find((task) => task.url === item.url);
          const from = state.projects.find((project) => project.url === source.url);
          const to = state.projects.find((project) => project.url === target.url);
          if (!current || !from || !to) return state;
          const dataset = createTask(url, projectMoveData(current, from, to));
          return relocate(state, {
            url,
            dataset,
            etag: null,
            task: new TaskItem(`${url}#it`, dataset, DataFactory),
          });
        },
        async () => {
          if (settled) return { result: settled, commit: (state) => state };
          // Once compensated, plan afresh: new references, source revision and data.
          if (operation?.canReplan) operation = undefined;
          operation ??= this.store.prepareTaskMove(
            this.task(source.url, item.url),
            this.project(source.url),
            this.project(target.url),
            id,
          );
          const moved = await operation.run();
          settled = moved;
          return { result: moved, commit: (state) => relocate(state, moved, true) };
        },
        () => {
          void run();
        },
        [item.url, url],
      ).then((moved) => {
        if (moved && !notified) {
          notified = true;
          this.movedTasks.set(item.url, moved.url);
          for (const listener of this.moveListeners) listener({ from: item.url, to: moved.url });
        }
        return moved;
      });
    const run = (): Promise<StoredTask | undefined> =>
      attempt().then((moved) => {
        if (moved && this.unresolvedMoves.get(item.url)?.run === run)
          this.unresolvedMoves.delete(item.url);
        return moved;
      });
    this.unresolvedMoves.set(item.url, { target: target.url, run });
    return run();
  }
  /** Include hidden rows: Undo visibility must never change recurrence or ancestry planning. */
  completedDeletionPlan(candidates?: ReadonlySet<string>) {
    const tasks = Object.values(this.baseline.tasks).flatMap((load) =>
      load.items.map(({ task }) => ({
        id: task.id,
        parentId: task.parent,
        state: task.state === "closed" ? ("closed" as const) : ("open" as const),
        derivedFrom: task.clonedFrom,
      })),
    );
    const history = completedHistoryToKeep(tasks, candidates);
    return { ...completedParentsToKeep(tasks, candidates, history), history };
  }
  private completedDeletionIncomplete(tasks = this.baseline.tasks): boolean {
    return (
      this.baseline.status !== "ready" ||
      this.projectFailures.size > 0 ||
      this.baseline.projects.some((project) => !tasks[project.url]) ||
      Object.values(tasks).some(
        (load) => load.status !== "ready" || load.refreshing || (load.warningCount ?? 0) > 0,
      )
    );
  }
  /** Strict refresh shares the write queue; failed reads cannot authorize destructive planning. */
  refreshCompletedDeletion(): Promise<TaskView[] | undefined> {
    return this.mutate(
      (state) => state,
      async () => {
        this.completedDeletionBlocked = true;
        const tasks = { ...this.baseline.tasks };
        const views: TaskView[] = [];
        for (const project of this.baseline.projects) {
          const current = this.project(project.url);
          const items = await this.store.listTasks(current.tracker.stateStore as string, {
            strict: true,
          });
          const projected = projectTasks(current, items);
          tasks[current.url] = { status: "ready", ...projected };
          views.push(...projected.views);
        }
        if (this.completedDeletionIncomplete(tasks))
          throw new Error("Couldn't refresh tasks before deletion");
        this.completedDeletionBlocked = false;
        return { result: views, commit: (state) => ({ ...state, tasks }) };
      },
      () => {},
      [],
      () => {},
      undefined,
      true,
    );
  }
  deleteTask(
    item: StoredTask,
    options: { silent?: boolean; completedOnly?: boolean } = {},
  ): Promise<boolean | undefined> {
    const project = this.baseline.projects.find((project) => {
      const folder = project.tracker.stateStore;
      return (
        this.baseline.tasks[project.url]?.items.some((task) => task.url === item.url) ||
        (folder !== undefined && item.url.startsWith(folder))
      );
    });
    if (!project) return Promise.resolve(undefined);
    const remove: Patch = (state) => replaceTask(state, project.url, item.url);
    return this.mutate(
      remove,
      async () => {
        if (
          options.completedOnly &&
          (this.completedDeletionBlocked || this.completedDeletionIncomplete())
        ) {
          this.completedDeletionBlocked = true;
          throw new Error("Couldn't revalidate tasks before deletion. Retry to refresh them.");
        }
        const optionalTask = (url: string) =>
          this.optionalTask(url).catch((error: unknown) => {
            this.completedDeletionBlocked = true;
            throw error;
          });
        const current = this.baseline.tasks[project.url]?.items.find(
          (task) => task.url === item.url,
        );
        // Retry may follow reconciliation of a committed DELETE whose response was lost.
        if (!current) {
          if (await optionalTask(item.url)) throw new ModelError(409, item.url);
          return { result: true, commit: remove };
        }
        if (options.completedOnly) {
          // Descendants settle first. Any remaining child (including a failed DELETE)
          // protects its ancestors, as does all recurring-task history.
          if (
            current.task.state !== "closed" ||
            Object.values(this.baseline.tasks).some((load) =>
              load.items.some(({ task }) => task.parent === current.task.id),
            ) ||
            this.completedDeletionPlan(new Set([current.task.id])).history.has(current.task.id)
          )
            return { result: false, commit: (state) => state };
        }
        try {
          await this.store.deleteTask(current);
        } catch (error) {
          // A transport failure or error response can follow a successful deletion.
          // Only a confirmed 404/410 makes that ambiguous outcome successful.
          if (await optionalTask(current.url)) throw error;
        }
        return { result: true, commit: remove };
      },
      () => {
        void this.deleteTask(item, options);
      },
      [item.url],
      options.silent ? () => {} : this.onFailure,
      undefined,
      options.completedOnly,
    );
  }
  /** Temporary visibility owned by the delayed-delete controller, independent of pod writes. */
  hideTask(url: string, hidden: boolean) {
    if (hidden) this.hiddenTasks.add(url);
    else this.hiddenTasks.delete(url);
    this.emit();
  }
  completeTask(
    item: StoredTask,
    now = new Date(),
    options: { forever?: boolean } = {},
  ): Promise<CompletionPlan | undefined> {
    const unresolved = this.unresolvedCompletions.get(item.url);
    if (unresolved) return unresolved();
    const project = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    const orphans = (project && this.snapshot.tasks[project.url]?.items)?.filter(
      (copy) =>
        copy.task.state === "closed" &&
        copy.task.clonedFrom === item.task.id &&
        copy.task.completionOperations.has(copy.url) &&
        !item.task.completionOperations.has(copy.url),
    );
    if (project && orphans?.length) return this.recoverCompletion(project, item, orphans, now);
    const plan = planComplete(item, this.snapshot.views, now, options);
    if (plan.kind === "advance") return this.advanceTask(item, plan);
    return this.updateTask(item, (task) => {
      task.state = "closed";
      task.endedAt = now;
    }).then((task) => (task ? plan : undefined));
  }
  /** Undo retains occurrence ownership across lost responses and retries each write conditionally. */
  undoCompletion(item: StoredTask, plan: CompletionPlan): Promise<boolean | undefined> {
    const existing = this.undoOperations.get(plan);
    if (existing) return existing();
    const repair = this.undoRepairs.get(item.url);
    if (repair) return repair.run();
    const project = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!project) return Promise.resolve(undefined);
    const undo = planUndo(plan);
    const restore = (task: TaskItem) => {
      if (undo.kind === "reopen") {
        task.state = "open";
        task.endedAt = undefined;
      } else {
        task.dueDate = undo.original.dueDate;
        task.allDay = undo.original.allDay;
        task.reminders = undo.original.reminders ?? [];
      }
    };
    const matches = (task: StoredTask) => {
      const intended = changeTask(task, restore);
      return isomorphic([...task.dataset], [...intended.dataset]);
    };
    const copyUrl = plan.kind === "advance" ? plan.copyUrl : undefined;
    const reservedCopy = this.completionCopies.get(plan);
    let finished = false;
    let superseded = false;
    // Once confirmed, Retry owns only copy cleanup, never another scheduling restore.
    let restored: StoredTask | undefined;
    let restorePending = false;
    let running: Promise<boolean | undefined> | undefined;
    const repairOperation: UndoRepair = {
      run: () => run(),
      supersede: (current) => {
        if (
          finished ||
          !restored ||
          (current.etag === restored.etag &&
            isomorphic([...current.dataset], [...restored.dataset]))
        )
          return false;
        finished = true;
        superseded = true;
        restorePending = false;
        this.undoRepairs.delete(item.url);
        this.onNotice("Undo was overtaken by a newer change");
        return true;
      },
    };
    const copyMatches = (copy: StoredTask) =>
      !!reservedCopy?.etag &&
      copy.etag === reservedCopy.etag &&
      isomorphic([...copy.dataset], [...reservedCopy.dataset]);
    const forward = (task: TaskItem) => {
      if (plan.kind !== "advance") return;
      task.dueDate = plan.original.dueDate;
      task.allDay = plan.original.allDay;
      task.reminders = plan.original.reminders ?? [];
    };
    const rejectChangedCopy = async (compensate: boolean) => {
      // A copy can change between the preflight read and its conditional DELETE.
      // Compensate only our scheduling restore, preserving unrelated concurrent edits.
      if (restorePending && compensate) {
        let current = await this.store.readTask(item.url);
        if (matches(current)) {
          try {
            current = await this.store.updateTask(current, forward);
          } catch (error) {
            current = await this.store.readTask(item.url);
            if (!isomorphic([...current.dataset], [...changeTask(current, forward).dataset]))
              throw error;
          }
        }
      }
      restorePending = false;
      this.undoRepairs.delete(item.url);
      throw new Error("Couldn't undo: the completed copy was changed elsewhere");
    };
    const attempt = (cleanupOnly = !!restored): Promise<boolean | undefined> =>
      this.mutate(
        (state) => {
          if (cleanupOnly || finished) return state;
          const current = state.tasks[project.url]?.items.find((task) => task.url === item.url);
          let next = current
            ? replaceTask(state, project.url, item.url, changeTask(current, restore))
            : state;
          if (copyUrl) next = replaceTask(next, project.url, copyUrl);
          return next;
        },
        async () => {
          if (finished) return { result: !superseded, commit: (state) => state };
          let current = await this.store.readTask(item.url);
          if (repairOperation.supersede(current))
            return {
              result: false,
              commit: (state) => replaceTask(state, project.url, item.url, current),
            };
          if (!restored && plan.kind === "advance" && !matches(current)) {
            const expected = changeTask(current, (task) => {
              task.dueDate = plan.original.dueDate;
              task.allDay = plan.original.allDay;
              task.reminders = plan.original.reminders ?? [];
            });
            if (
              !current.task.completionOperations.has(copyUrl as string) ||
              !isomorphic([...current.dataset], [...expected.dataset])
            )
              throw new ModelError(409, item.url);
          }
          let copy: StoredTask | undefined;
          if (copyUrl) {
            copy = await this.optionalTask(copyUrl);
            if (copy && !copyMatches(copy)) await rejectChangedCopy(false);
          }
          if (!restored && !matches(current)) {
            if (copyUrl) {
              restorePending = true;
              this.undoRepairs.set(item.url, repairOperation);
            }
            try {
              current = await this.store.updateTask(current, restore);
            } catch (error) {
              const reconciled = await this.store.readTask(item.url);
              if (!matches(reconciled)) {
                restorePending = false;
                this.undoRepairs.delete(item.url);
                throw error;
              }
              current = reconciled;
            }
          }
          // The original is confirmed restored before the irreversible copy removal.
          restored = current;
          if (copy) {
            restorePending = true;
            this.undoRepairs.set(item.url, repairOperation);
            try {
              await this.store.deleteTask(copy);
            } catch (error) {
              const reconciled = await this.optionalTask(copy.url);
              if (reconciled) {
                if (!copyMatches(reconciled)) await rejectChangedCopy(!cleanupOnly);
                throw error;
              }
            }
          }
          restorePending = false;
          this.undoRepairs.delete(item.url);
          finished = true;
          const original = current;
          return {
            result: true,
            commit: (state) => {
              const next = replaceTask(state, project.url, item.url, original);
              return copyUrl ? replaceTask(next, project.url, copyUrl) : next;
            },
          };
        },
        () => {
          void run();
        },
        [item.url, ...(copyUrl ? [copyUrl] : [])],
      );
    const run = (): Promise<boolean | undefined> => {
      if (finished) return Promise.resolve(!superseded);
      const repair = this.undoRepairs.get(item.url);
      if (repair && repair !== repairOperation) return repair.run();
      if (copyUrl) this.undoRepairs.set(item.url, repairOperation);
      running ??= attempt().finally(() => {
        running = undefined;
        if (!restorePending && this.undoRepairs.get(item.url) === repairOperation)
          this.undoRepairs.delete(item.url);
      });
      return running;
    };
    this.undoOperations.set(plan, run);
    return run();
  }
  /** A persisted occurrence without its original's marker is the same completion after reload. */
  private recoverCompletion(
    project: StoredProject,
    item: StoredTask,
    orphans: StoredTask[],
    now: Date,
  ): Promise<CompletionPlan | undefined> {
    const recent = orphans.toSorted(
      (a, b) => (b.task.endedAt?.getTime() ?? 0) - (a.task.endedAt?.getTime() ?? 0),
    );
    const orphan =
      recent.find((copy) =>
        item.task.allDay !== undefined
          ? copy.task.allDay === item.task.allDay
          : copy.task.allDay === undefined &&
            copy.task.dueDate?.getTime() === item.task.dueDate?.getTime(),
      ) ?? (recent[0] as StoredTask);
    const excluded = new Set(orphans.map((copy) => copy.url));
    const replan = (current: StoredTask, views: readonly TaskView[]): CompletionPlan => ({
      ...planComplete(
        current,
        views.filter((view) => !excluded.has(view.url)),
        now,
      ),
      copyUrl: orphan.url,
    });
    let plan = replan(
      item,
      this.snapshot.views.filter((view) => view.projectUrl === project.url),
    );
    const change = (task: TaskItem) => {
      if (plan.kind === "advance") {
        task.dueDate = plan.original.dueDate;
        task.allDay = plan.original.allDay;
        task.reminders = plan.original.reminders ?? [];
      } else {
        task.state = "closed";
        task.endedAt = now;
      }
      task.completionOperations.add(orphan.url);
    };
    let running: Promise<CompletionPlan | undefined> | undefined;
    const run = (refresh = false): Promise<CompletionPlan | undefined> => {
      running ??= this.mutate(
        (state) => {
          const current = state.tasks[project.url]?.items.find((task) => task.url === item.url);
          return current && !current.task.completionOperations.has(orphan.url)
            ? replaceTask(state, project.url, item.url, changeTask(current, change))
            : state;
        },
        async () => {
          this.project(project.url);
          let current = refresh
            ? await this.store.readTask(item.url)
            : this.task(project.url, item.url);
          if (refresh && !current.task.completionOperations.has(orphan.url)) {
            // A conflict means the task changed; plan from its fresh scheduling inputs.
            const currentProject = this.project(project.url);
            const siblings = await this.store.listTasks(
              currentProject.tracker.stateStore as string,
            );
            plan = replan(current, projectTasks(currentProject, siblings).views);
          }
          if (!current.task.completionOperations.has(orphan.url)) {
            try {
              current = await this.store.updateTask(current, change);
            } catch (error) {
              if (!(error instanceof ModelError && [409, 412].includes(error.status))) throw error;
              const latest = await this.store.readTask(item.url);
              if (!latest.task.completionOperations.has(orphan.url)) throw error;
              current = latest;
            }
          }
          return {
            result: plan,
            commit: (state) => replaceTask(state, project.url, item.url, current),
          };
        },
        () => {
          void resume();
        },
        [item.url, orphan.url],
      ).then((result) => {
        running = undefined;
        if (result && this.unresolvedCompletions.get(item.url) === resume)
          this.unresolvedCompletions.delete(item.url);
        return result;
      });
      return running;
    };
    const resume = () => run(true);
    this.unresolvedCompletions.set(item.url, resume);
    return run();
  }
  /** Retain the copy reservation until both writes or its compensation are confirmed. */
  advanceTask(
    item: StoredTask,
    initial: Extract<CompletionPlan, { kind: "advance" }>,
  ): Promise<CompletionPlan | undefined> {
    const unresolved = this.unresolvedCompletions.get(item.url);
    if (unresolved) return unresolved();
    const project = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!project) return Promise.resolve(undefined);
    const id = crypto.randomUUID();
    const url = `${project.tracker.stateStore}${id}.ttl`;
    initial.copyUrl = url;
    let plan: CompletionPlan = initial;
    const now = initial.copy.endedAt as Date;
    let copyPending = false;
    let compensating = false;
    let replan = false;
    let reservedCopy: StoredTask | undefined;
    let settled: { result: CompletionPlan; commit: Patch } | undefined;
    const finish = (original: StoredTask, copy?: StoredTask) => {
      this.undoRepairs.get(item.url)?.supersede(original);
      if (reservedCopy) this.completionCopies.set(plan, reservedCopy);
      settled = {
        result: plan,
        commit: (state) =>
          replaceTask(replaceTask(state, project.url, url, copy), project.url, item.url, original),
      };
      return settled;
    };
    const wasAdvanced = (original: StoredTask) => original.task.completionOperations.has(url);
    const isOccurrence = (copy: StoredTask) =>
      copy.task.clonedFrom === item.task.id && copy.task.completionOperations.has(url);
    const confirmCopy = (copy: StoredTask) => {
      // A read validator proves ownership only with the exact reserved payload.
      // Never replace a known write validator with a newer client's revision.
      if (
        reservedCopy &&
        !reservedCopy.etag &&
        isomorphic([...copy.dataset], [...reservedCopy.dataset])
      )
        reservedCopy = { ...reservedCopy, etag: copy.etag };
    };
    const requireOwnedCopy = (copy: StoredTask) => {
      confirmCopy(copy);
      if (
        !reservedCopy?.etag ||
        copy.etag !== reservedCopy.etag ||
        !isomorphic([...copy.dataset], [...reservedCopy.dataset])
      )
        throw new ModelError(409, url);
    };
    const dataset = createTask(url, { ...initial.copy, completionOperations: [url] });
    const copy = {
      url,
      dataset,
      etag: null,
      task: new TaskItem(`${url}#it`, dataset, DataFactory),
    };
    const advance = (task: TaskItem, completion: Extract<CompletionPlan, { kind: "advance" }>) => {
      task.dueDate = completion.original.dueDate;
      task.allDay = completion.original.allDay;
      task.reminders = completion.original.reminders ?? [];
      // Earlier clients may still need their marker to reconcile a lost response.
      task.completionOperations.add(url);
    };
    const attempt = (retry = false): Promise<CompletionPlan | undefined> =>
      this.mutate(
        (state) => {
          if (retry) return state;
          const current = state.tasks[project.url]?.items.find((task) => task.url === item.url);
          return current
            ? replaceTask(
                replaceTask(state, project.url, url, copy),
                project.url,
                item.url,
                changeTask(current, (task) => advance(task, initial)),
              )
            : state;
        },
        async () => {
          if (settled) return { result: settled.result, commit: (state) => state };
          const currentProject = this.project(project.url);
          let current = retry
            ? await this.store.readTask(item.url)
            : this.task(project.url, item.url);
          let existingCopy: StoredTask | undefined;
          if (copyPending) {
            const existing = await this.optionalTask(url);
            if (wasAdvanced(current)) {
              if (existing && !isOccurrence(existing)) throw new ModelError(409, url);
              if (existing) confirmCopy(existing);
              return finish(current, existing);
            }
            if (existing) {
              if (!isOccurrence(existing)) throw new ModelError(409, url);
              confirmCopy(existing);
              if (compensating) {
                // Only a definite rejection authorizes compensation, never a lost response.
                requireOwnedCopy(existing);
                await this.store.deleteTask(existing);
              } else existingCopy = existing;
            }
            copyPending = !!existingCopy;
            compensating = false;
          }
          if (`${currentProject.tracker.stateStore}${id}.ttl` !== url)
            throw new ModelError(409, url);
          if (retry && replan) {
            const siblings = await this.store.listTasks(
              currentProject.tracker.stateStore as string,
            );
            plan = planComplete(current, projectTasks(currentProject, siblings).views, now);
            replan = false;
          } else if (!retry && current.etag !== item.etag) {
            // A queued edit changed the scheduling inputs before this write started.
            plan = planComplete(
              current,
              this.snapshot.views.filter((view) => view.url !== url),
              now,
            );
          }
          if (plan.kind === "close") {
            if (current.task.state !== "closed")
              current = await this.store.updateTask(current, (task) => {
                task.state = "closed";
                task.endedAt = now;
              });
            return finish(current);
          }
          plan.copyUrl = url;
          copyPending = true; // The PUT can commit even when its response is lost.
          const copy =
            existingCopy ??
            (await this.store.createTask(
              currentProject,
              { ...plan.copy, completionOperations: [url] },
              id,
              (resource) => {
                reservedCopy = {
                  ...resource,
                  task: new TaskItem(`${url}#it`, resource.dataset, DataFactory),
                };
              },
            ));
          confirmCopy(copy);
          const completion = plan;
          try {
            const original = await this.store.updateTask(current, (task) =>
              advance(task, completion),
            );
            return finish(original, copy);
          } catch (error) {
            // A rejected precondition proves this update did not commit.
            if (error instanceof ModelError && error.status >= 400 && error.status < 500) {
              compensating = true;
              replan = true;
            }
            // Reconcile an ambiguous update before deleting its occurrence.
            const original = await this.store.readTask(item.url);
            if (wasAdvanced(original)) return finish(original, copy);
            if (!compensating) throw error;
            requireOwnedCopy(copy);
            await this.store.deleteTask(copy);
            copyPending = false;
            compensating = false;
            throw error;
          }
        },
        () => {
          void resume();
        },
        [item.url, url],
      );
    let running: Promise<CompletionPlan | undefined> | undefined;
    const run = (retry: boolean): Promise<CompletionPlan | undefined> => {
      running ??= attempt(retry).then((result) => {
        running = undefined;
        if (result && this.unresolvedCompletions.get(item.url) === resume)
          this.unresolvedCompletions.delete(item.url);
        return result;
      });
      return running;
    };
    const resume = () => run(true);
    this.unresolvedCompletions.set(item.url, resume);
    return run(false);
  }
  createProject(title: string): Promise<StoredProject | undefined> {
    return this.prepareProjectCreate(title)();
  }
  /** Retain project ownership and its reservation when a composite submission retries. */
  prepareProjectCreate(
    title: string,
    onRetry?: () => void,
    onFailure?: MutationFailure,
    signal?: AbortSignal,
  ): () => Promise<StoredProject | undefined> {
    const url = `${this.store.projects}pending-${crypto.randomUUID()}.ttl`;
    const { tracker, dataset } = createTracker(url, title, `${url}/`, [this.webId], new Date());
    const optimistic = { url, tracker, dataset, etag: null };
    let created: StoredProject | undefined;
    const operation: ProjectCreation = { owner: crypto.randomUUID() };
    const position = this.snapshot.projects.length;
    const attempt = (retry = false): Promise<StoredProject | undefined> =>
      this.mutate(
        (state) => replaceProject(state, created ?? optimistic),
        async () => {
          created ??= await this.store.createProject(title, false, operation);
          const current = retry ? await this.store.readProject(created.url) : created;
          const project =
            current.tracker.position === position
              ? current
              : await this.store.updateProject(current, (tracker) => {
                  tracker.position = position;
                });
          return { result: project, commit: (state) => replaceProject(state, project) };
        },
        onRetry ?? (() => void run()),
        [url],
        onFailure,
        signal,
      );
    let attempted = false;
    let saved: StoredProject | undefined;
    let running: Promise<StoredProject | undefined> | undefined;
    const run = (): Promise<StoredProject | undefined> => {
      if (saved) return Promise.resolve(saved);
      if (running) return running;
      const retry = attempted;
      attempted = true;
      running = attempt(retry)
        .then((project) => {
          saved = project;
          return project;
        })
        .finally(() => {
          running = undefined;
        });
      return running;
    };
    return run;
  }
  updateProject(
    project: StoredProject,
    change: (tracker: TaskTracker) => void,
    /** Composite operations retry their complete intent rather than this write alone. */
    onRetry?: () => void,
    onFailure?: MutationFailure,
    signal?: AbortSignal,
  ): Promise<StoredProject | undefined> {
    const attempt = (retry = false): Promise<StoredProject | undefined> =>
      this.mutate(
        (state) => {
          const current = state.projects.find((item) => item.url === project.url);
          return current ? replaceProject(state, changeProject(current, change)) : state;
        },
        async () => {
          const current = retry
            ? await this.store.readProject(project.url)
            : this.project(project.url);
          const intended = changeProject(current, change);
          const result = isomorphic([...current.dataset], [...intended.dataset])
            ? current
            : await this.store.updateProject(current, change);
          return { result, commit: (state) => replaceProject(state, result) };
        },
        onRetry ??
          (() => {
            void attempt(true);
          }),
        [project.url],
        onFailure,
        signal,
      );
    return attempt();
  }
  /** Hold the mutation queue from the strict listing through task and class removal, on Retry too.
   * Preflight items only identify saving indicators; queued writes may change the membership. */
  deleteLabel(project: StoredProject, labelIds: readonly string[], preflight: StoredTask[]) {
    const clearTypes = (task: TaskItem) => {
      for (const id of labelIds) task.types.delete(id);
    };
    const attempt = (): Promise<StoredProject | undefined> =>
      this.mutate(
        (state) => state,
        async () => {
          // Always read back the tracker, including after a lost class-removal response.
          const current = await this.store.readProject(project.url);
          if (current.tracker.stateStore !== project.tracker.stateStore)
            throw new ModelError(409, project.url);
          const items = await this.store.listTasks(current.tracker.stateStore as string, {
            strict: true,
          });
          const confirmed: StoredTask[] = [];
          for (const item of items)
            confirmed.push(
              labelIds.some((id) => item.task.types.has(id))
                ? await this.store.updateTask(item, clearTypes)
                : item,
            );
          // Conditional task writes must all succeed before the conditional tracker write.
          const hasClass = labelIds.some(
            (id) => current.dataset.match(DataFactory.namedNode(id)).size > 0,
          );
          const result = hasClass
            ? await this.store.updateProject(current, (tracker) => {
                for (const id of labelIds)
                  for (const quad of tracker.dataset.match(DataFactory.namedNode(id)))
                    tracker.dataset.delete(quad);
              })
            : current;
          return {
            result,
            commit: (state) => {
              let next = replaceProject(state, result);
              for (const item of confirmed) next = replaceTask(next, project.url, item.url, item);
              return next;
            },
          };
        },
        () => {
          void attempt();
        },
        preflight
          .filter((item) => labelIds.some((id) => item.task.types.has(id)))
          .map((item) => item.url),
      );
    return attempt();
  }
  /** Fresh reads and conditional writes share the task mutation queue, including Retry. */
  syncProjectMember(
    project: StoredProject,
    webId: string,
    granted: boolean,
    { silent = false } = {},
  ) {
    const unassigned = new Set<string>();
    const restored = new Set<string>();
    let byMember = this.removedAssignments.get(project.url);
    if (!byMember) {
      byMember = new Map();
      this.removedAssignments.set(project.url, byMember);
    }
    let removed = byMember.get(webId);
    if (!removed) {
      removed = new Map();
      byMember.set(webId, removed);
    }
    const assignments = removed;
    const attempt = (): Promise<StoredProject | undefined> =>
      this.mutate(
        (state) => state,
        async () => {
          const projects = this.isOwnProject(project.url) ? this.store.projects : undefined;
          requireProjectFolder(project.url, project.tracker.stateStore, projects);
          const current = await this.store.readProject(project.url);
          const folder = requireProjectFolder(project.url, current.tracker.stateStore, projects);
          const confirmed: StoredTask[] = [];
          if (!granted) {
            const items = await this.store.listTasks(folder, { strict: true, skipInvalid: true });
            for (const item of items) {
              if (item.task.assignee !== webId) {
                confirmed.push(item);
                continue;
              }
              let updated: StoredTask;
              try {
                updated = await this.store.updateTask(item, (task) => {
                  task.assignee = undefined;
                });
              } catch (error) {
                // A lost response can still have committed. Confirm before counting or retrying.
                updated = await this.store.readTask(item.url);
                if (updated.task.assignee !== undefined) throw error;
              }
              confirmed.push(updated);
              assignments.set(item.url, updated.etag);
              unassigned.add(item.url);
            }
          } else {
            for (const [url, etag] of assignments) {
              let item: StoredTask;
              try {
                item = await this.store.readTask(url);
              } catch (error) {
                if (!(error instanceof ModelError && error.status === 404)) throw error;
                assignments.delete(url);
                continue;
              }
              if (!etag || item.etag !== etag || item.task.assignee !== undefined) {
                assignments.delete(url);
                continue;
              }
              try {
                confirmed.push(
                  await this.store.updateTask(item, (task) => {
                    task.assignee = webId;
                  }),
                );
              } catch (error) {
                // A concurrent edit always wins. Retry still uses the saved post-unassign ETag.
                if (!(error instanceof ModelError && error.status === 412)) throw error;
                assignments.delete(url);
                continue;
              }
              assignments.delete(url);
              restored.add(url);
            }
          }
          const members = new Set(current.tracker.groupMembers);
          if (granted) members.add(webId);
          else members.delete(webId);
          const result =
            members.has(webId) === current.tracker.groupMembers.includes(webId)
              ? current
              : await this.store.updateProject(current, (tracker) =>
                  tracker.setGroupMembers([...members]),
                );
          if (!silent) {
            if (unassigned.size) this.onNotice(`Unassigned ${unassigned.size} tasks`);
            if (restored.size) this.onNotice(`Restored ${restored.size} assignments`);
          }
          unassigned.clear();
          restored.clear();
          return {
            result,
            commit: (state) => {
              let next = replaceProject(state, result);
              for (const item of confirmed) next = replaceTask(next, project.url, item.url, item);
              return next;
            },
          };
        },
        () => {
          void attempt();
        },
        [project.url],
        (error, retry) => {
          // ShareDialog owns feedback for its actions and background reconciliation.
          if (!silent) this.onFailure(new ProjectMembersSyncError(error), retry);
        },
      );
    return attempt();
  }
  renameProject = (project: StoredProject, title: string) =>
    this.updateProject(project, (tracker) => {
      tracker.title = title.trim();
    });
  setProjectColor = (project: StoredProject, color: string | undefined) => {
    const selected = projectColour(color);
    if (color !== undefined && !selected) throw new TypeError("Unknown project colour.");
    return this.updateProject(project, (tracker) => {
      tracker.color = selected?.hex;
    });
  };
  archiveProject = (project: StoredProject) => {
    const archivedAt = new Date();
    return this.updateProject(project, (tracker) => {
      tracker.archivedAt = archivedAt;
    });
  };
  moveProject(project: StoredProject, direction: "up" | "down") {
    const projects = this.snapshot.projects.filter((item) => item.url !== this.inboxUrl);
    const ordered = moveItem(
      projects,
      projects.findIndex((item) => item.url === project.url),
      direction,
    );
    return Promise.all(
      ordered.map((item, index) =>
        this.updateProject(item, (tracker) => {
          tracker.position = index + 1;
        }),
      ),
    );
  }
  addSection = (project: StoredProject, name: string) => {
    const current = this.snapshot.projects.find((item) => item.url === project.url) ?? project;
    const position = current.tracker.sections.length + 1;
    return this.updateProject(project, (tracker) => {
      tracker.defineCategory("Section", name.trim(), position);
    });
  };
  renameSection = (project: StoredProject, id: string, name: string) =>
    this.updateProject(project, (tracker) => tracker.updateSection(id, { name: name.trim() }));
  moveSection(project: StoredProject, id: string, direction: "up" | "down") {
    const current = this.snapshot.projects.find((item) => item.url === project.url) ?? project;
    const sections = current.tracker.sections;
    const positions = moveItem(
      sections,
      sections.findIndex((item) => item.id === id),
      direction,
    ).map((section, index) => ({ id: section.id, position: index + 1 }));
    return this.updateProject(project, (tracker) => {
      for (const section of positions)
        tracker.updateSection(section.id, { position: section.position });
    });
  }
  deleteSection(project: StoredProject, id: string) {
    const apply: Patch = (state) => {
      const current = state.projects.find((item) => item.url === project.url);
      if (!current?.tracker.sections.some((section) => section.id === id)) return state;
      let next = replaceProject(
        state,
        changeProject(current, (tracker) => tracker.removeSection(id)),
      );
      for (const task of state.tasks[project.url]?.items ?? [])
        next = replaceTask(
          next,
          project.url,
          task.url,
          changeTask(task, (value) => value.types.delete(id)),
        );
      return next;
    };
    return this.mutate(
      apply,
      async () => {
        const result = await this.store.deleteSection(this.project(project.url), id);
        const items = await this.store.listTasks(result.tracker.stateStore as string);
        return {
          result,
          commit: (state) => ({
            ...replaceProject(state, result),
            tasks: { ...state.tasks, [project.url]: { status: "ready", items } },
          }),
        };
      },
      () => {
        void this.deleteSection(project, id);
      },
    );
  }
  deleteProject(project: StoredProject) {
    const remove: Patch = (state) => ({
      ...state,
      projects: state.projects.filter((item) => item.url !== project.url),
      tasks: Object.fromEntries(Object.entries(state.tasks).filter(([url]) => url !== project.url)),
    });
    return this.mutate(
      remove,
      async () => {
        await this.store.deleteProject(this.project(project.url));
        return { result: true, commit: remove };
      },
      () => {
        void this.deleteProject(project);
      },
    );
  }
}
