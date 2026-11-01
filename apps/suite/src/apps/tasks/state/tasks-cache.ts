// AUTHORED-BY Codex GPT-6
import { isomorphic } from "rdf-isomorphic";
import { ModelError } from "../lib/model/errors";
import { DataFactory } from "../lib/model/rdf";
import type { ProjectCreation, StoredProject, StoredTask, TaskStore } from "../lib/model/store";
import { createTask, type TaskDetails, TaskItem } from "../lib/model/task";
import { createTracker, type TaskTracker } from "../lib/model/tracker";
import { type CompletionPlan, planComplete } from "../lib/views/completion";
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
  /** Includes failed tracker reads and registered-container listings.
   * Entries are keyed by tracker or container URL. Resources retain their URL and ETag. */
  tasks: Record<string, TaskLoad>;
  saving: string[];
  views: TaskView[];
}
export interface NewTask {
  title: string;
  sectionId?: string | undefined;
  due?: Date | undefined;
  allDay?: string | undefined;
  position?: number | undefined;
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
  /** Keep the original URL reserved across failures and repeated completion actions. */
  private unresolvedCompletions = new Map<string, () => Promise<CompletionPlan | undefined>>();
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
    const id = crypto.randomUUID();
    const url = `${project.tracker.stateStore}${id}.ttl`;
    const details: TaskDetails = {
      title: data.title.trim(),
      project: project.tracker.id,
      creator: this.webId,
      state: "open",
      created: new Date(),
      ...(data.allDay
        ? { dueDate: new Date(`${data.allDay}T00:00:00`) }
        : data.due
          ? { dueDate: data.due }
          : {}),
      allDay: data.allDay,
      rank: data.position,
      categoryTypes: data.sectionId ? [data.sectionId] : [],
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
        (state) => replaceTask(state, project.url, url, optimistic),
        async () => {
          const current = this.project(project.url);
          if (`${current.tracker.stateStore}${id}.ttl` !== url) throw new ModelError(409, url);
          const task =
            (reconcile ? await this.optionalTask(url) : undefined) ??
            (await this.store.createTask(current, details, id));
          return {
            result: task,
            commit: (state) => replaceTask(state, project.url, task.url, task),
          };
        },
        () => {
          void attempt(true);
        },
        [url],
      );
    return attempt();
  }
  private async optionalTask(url: string): Promise<StoredTask | undefined> {
    try {
      return await this.store.readTask(url);
    } catch (error) {
      if (error instanceof ModelError && [404, 410].includes(error.status)) return undefined;
      throw error;
    }
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
  completeTask(item: StoredTask, now = new Date()): Promise<CompletionPlan | undefined> {
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
    const plan = planComplete(item, this.snapshot.views, now);
    if (plan.kind === "advance") return this.advanceTask(item, plan);
    return this.updateTask(item, (task) => {
      task.state = "closed";
      task.endedAt = now;
    }).then((task) => (task ? plan : undefined));
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
    let settled: { result: CompletionPlan; commit: Patch } | undefined;
    const finish = (original: StoredTask, copy?: StoredTask) => {
      settled = {
        result: plan,
        commit: (state) =>
          replaceTask(replaceTask(state, project.url, url, copy), project.url, item.url, original),
      };
      return settled;
    };
    const wasAdvanced = (original: StoredTask) => original.task.completionOperations.has(url);
    const ownsCopy = (copy: StoredTask) =>
      copy.task.clonedFrom === item.task.id && copy.task.completionOperations.has(url);
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
              if (existing && !ownsCopy(existing)) throw new ModelError(409, url);
              return finish(current, existing);
            }
            if (existing) {
              if (!ownsCopy(existing)) throw new ModelError(409, url);
              if (compensating) {
                // Only a definite rejection authorizes compensation, never a lost response.
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
            ));
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
        () => {
          void attempt(true);
        },
        [url],
      );
    return attempt();
  }
  updateProject(
    project: StoredProject,
    change: (tracker: TaskTracker) => void,
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
        () => {
          void attempt(true);
        },
        [project.url],
      );
    return attempt();
  }
  renameProject = (project: StoredProject, title: string) =>
    this.updateProject(project, (tracker) => {
      tracker.title = title.trim();
    });
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
