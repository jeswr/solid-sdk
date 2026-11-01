// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { missingLabels } from "../lib/compose/planning";
import { projectMoveData } from "../lib/detail/task-data";
import { ModelError } from "../lib/model/errors";
import { DataFactory } from "../lib/model/rdf";
import type { StoredProject, StoredTask, TaskStore } from "../lib/model/store";
import { createTask, type TaskDetails, TaskItem } from "../lib/model/task";
import { createTracker, type TaskTracker } from "../lib/model/tracker";
import { type CompletionPlan, planComplete } from "../lib/views/completion";
import { type DropPosition, positionForDrop } from "../lib/views/positions";
import { compareTasks } from "../lib/views/project-groups";
import { type TaskView, toTaskView } from "../lib/views/types";
import { changeProject, changeTask, moveItem, optimisticValue, sortedProjects } from "./mutations";

export interface TaskLoad {
  status: "loading" | "ready" | "error";
  items: StoredTask[];
  /** Invalid RDF tasks skipped while projecting this project's last load. */
  warningCount?: number;
  error?: unknown;
}
export interface TasksSnapshot {
  status: "loading" | "ready" | "error";
  error?: unknown;
  projects: StoredProject[];
  /** Includes failed tracker reads even before a project has loaded successfully.
   * Entries are keyed by tracker document URL. Resources retain their URL and ETag. */
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
export type MutationFailure = (error: unknown, retry: () => void) => void;
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
  private tail: Promise<unknown> = Promise.resolve();
  private started: Promise<void> | undefined;
  private epoch = 0;
  private reads = new Map<string, Promise<void>>();
  private dirtyReads = new Set<string>();
  private projectRead = 0;
  private taskReadGenerations = new Map<string, number>();
  private projectFailures = new Map<string, unknown>();
  readonly inboxUrl: string;
  constructor(
    readonly store: TaskStore,
    private readonly onFailure: MutationFailure,
    private readonly webId: string,
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
      const projected = projectTasks(project, load.items);
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
  async refreshProjects(): Promise<void> {
    const epoch = this.epoch;
    const generation = ++this.projectRead;
    const failures = new Map<string, unknown>();
    const projects = await this.store.listProjects((url, error) => failures.set(url, error));
    if (epoch !== this.epoch || generation !== this.projectRead) return;
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
    const project = this.baseline.projects.find((item) => item.url === url);
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
  private async readTasks(project: StoredProject) {
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
          items: previous?.items ?? [],
        },
      },
    };
    this.emit();
    try {
      const items = await this.store.listTasks(stateStore);
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
  ): Promise<T | undefined> {
    const entry = { apply, urls };
    this.pending.push(entry);
    ++this.epoch;
    this.emit();
    const run = this.tail.then(async () => {
      try {
        const { result, commit } = await write();
        this.baseline = commit(this.baseline);
        return result;
      } catch (error) {
        // A section/project operation can partially succeed; reconcile its confirmed resources.
        try {
          await this.refreshProjects();
          for (const project of this.baseline.projects)
            if (this.baseline.tasks[project.url] && !this.baseline.tasks[project.url]?.error)
              await this.readTasks(project);
        } catch {
          /* The baseline plus the remaining queue is still safe to render. */
        }
        this.onFailure(error, retry);
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
  /** One reservation and captured draft shared by every retry, including batch-owned toasts. */
  prepareTaskCreate(
    project: StoredProject,
    data: NewTask,
    onRetry?: () => void,
  ): () => Promise<StoredTask | undefined> {
    const id = crypto.randomUUID();
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
          const task = await this.store.createTask(current, details, id);
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
    return this.updateProject(project, define);
  }
  updateTask(item: StoredTask, change: (task: TaskItem) => void): Promise<StoredTask | undefined> {
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
        return { result: task, commit: (state) => replaceTask(state, project.url, item.url, task) };
      },
      () => {
        void this.updateTask(item, change);
      },
      [item.url],
    );
  }
  moveTaskToProject(item: StoredTask, target: StoredProject): Promise<StoredTask | undefined> {
    const source = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!source) return Promise.resolve(undefined);
    if (source.url === target.url) return Promise.resolve(item);
    const id = crypto.randomUUID();
    const url = `${target.tracker.stateStore}${id}.ttl`;
    const relocate = (state: TasksSnapshot, moved: StoredTask) =>
      replaceTask(replaceTask(state, source.url, item.url), target.url, url, moved);
    return this.mutate(
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
        const moved = await this.store.moveTaskToProject(
          this.task(source.url, item.url),
          this.project(source.url),
          this.project(target.url),
          id,
        );
        return { result: moved, commit: (state) => relocate(state, moved) };
      },
      () => {
        void this.moveTaskToProject(item, target);
      },
      [item.url, url],
    );
  }
  deleteTask(item: StoredTask): Promise<boolean | undefined> {
    const project = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!project) return Promise.resolve(undefined);
    const remove: Patch = (state) => replaceTask(state, project.url, item.url);
    return this.mutate(
      remove,
      async () => {
        await this.store.deleteTask(this.task(project.url, item.url));
        return { result: true, commit: remove };
      },
      () => {
        void this.deleteTask(item);
      },
    );
  }
  /** Retain the copy reservation until both writes or its compensation are confirmed. */
  advanceTask(item: StoredTask, initial: Extract<CompletionPlan, { kind: "advance" }>) {
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
    let updateAttempted = false;
    let settled: { result: CompletionPlan; commit: Patch } | undefined;
    const finish = (original: StoredTask, copy?: StoredTask) => {
      settled = {
        result: plan,
        commit: (state) =>
          replaceTask(replaceTask(state, project.url, url, copy), project.url, item.url, original),
      };
      return settled;
    };
    const wasAdvanced = (original: StoredTask) =>
      updateAttempted &&
      plan.kind === "advance" &&
      original.task.state === "open" &&
      original.task.dueDate?.getTime() === plan.next.getTime() &&
      original.task.allDay === plan.original.allDay;
    const dataset = createTask(url, initial.copy);
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
          if (copyPending) {
            const existing = await this.optionalTask(url);
            if (existing) {
              if (wasAdvanced(current)) return finish(current, existing);
              // Never create another occurrence until the old reservation is gone.
              await this.store.deleteTask(existing);
            }
            copyPending = false;
            updateAttempted = false;
          }
          if (`${currentProject.tracker.stateStore}${id}.ttl` !== url)
            throw new ModelError(409, url);
          if (retry) {
            const siblings = await this.store.listTasks(
              currentProject.tracker.stateStore as string,
            );
            plan = planComplete(current, projectTasks(currentProject, siblings).views, now);
          } else if (current.etag !== item.etag) {
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
          const copy = await this.store.createTask(currentProject, plan.copy, id);
          const completion = plan;
          try {
            updateAttempted = true;
            const original = await this.store.updateTask(current, (task) =>
              advance(task, completion),
            );
            return finish(original, copy);
          } catch (error) {
            // A rejected precondition proves this update did not commit.
            if (error instanceof ModelError && error.status >= 400 && error.status < 500)
              updateAttempted = false;
            // Reconcile an ambiguous update before deleting its occurrence.
            const original = await this.store.readTask(item.url);
            if (wasAdvanced(original)) return finish(original, copy);
            await this.store.deleteTask(copy);
            copyPending = false;
            updateAttempted = false;
            throw error;
          }
        },
        () => {
          void attempt(true);
        },
        [item.url, url],
      );
    return attempt();
  }
  createProject(title: string): Promise<StoredProject | undefined> {
    const url = `${this.store.projects}pending-${crypto.randomUUID()}.ttl`;
    const { tracker, dataset } = createTracker(url, title, `${url}/`, [this.webId], new Date());
    const optimistic = { url, tracker, dataset, etag: null };
    let created: StoredProject | undefined;
    let position: number | undefined;
    const attempt = (): Promise<StoredProject | undefined> =>
      this.mutate(
        (state) => replaceProject(state, created ?? optimistic),
        async () => {
          created ??= await this.store.createProject(title);
          position ??= this.baseline.projects.length;
          const current =
            this.baseline.projects.find((project) => project.url === created?.url) ?? created;
          const project = await this.store.updateProject(current, (tracker) => {
            tracker.position = position;
          });
          return { result: project, commit: (state) => replaceProject(state, project) };
        },
        () => {
          void attempt();
        },
      );
    return attempt();
  }
  updateProject(
    project: StoredProject,
    change: (tracker: TaskTracker) => void,
  ): Promise<StoredProject | undefined> {
    return this.mutate(
      (state) => {
        const current = state.projects.find((item) => item.url === project.url);
        return current ? replaceProject(state, changeProject(current, change)) : state;
      },
      async () => {
        const result = await this.store.updateProject(this.project(project.url), change);
        return { result, commit: (state) => replaceProject(state, result) };
      },
      () => {
        void this.updateProject(project, change);
      },
    );
  }
  renameProject = (project: StoredProject, title: string) =>
    this.updateProject(project, (tracker) => {
      tracker.title = title.trim();
    });
  archiveProject = (project: StoredProject) =>
    this.updateProject(project, (tracker) => {
      tracker.archivedAt = new Date();
    });
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
  addSection = (project: StoredProject, name: string) =>
    this.updateProject(project, (tracker) => {
      tracker.defineCategory("Section", name.trim(), tracker.sections.length + 1);
    });
  renameSection = (project: StoredProject, id: string, name: string) =>
    this.updateProject(project, (tracker) => tracker.updateSection(id, { name: name.trim() }));
  moveSection(project: StoredProject, id: string, direction: "up" | "down") {
    return this.updateProject(project, (tracker) => {
      const sections = tracker.sections;
      for (const [index, section] of moveItem(
        sections,
        sections.findIndex((item) => item.id === id),
        direction,
      ).entries())
        tracker.updateSection(section.id, { position: index + 1 });
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
