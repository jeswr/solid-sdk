// AUTHORED-BY Codex GPT-6
import { ModelError } from "../lib/model/errors";
import { DataFactory } from "../lib/model/rdf";
import type { StoredProject, StoredTask, TaskStore } from "../lib/model/store";
import { createTask, type TaskDetails, TaskItem } from "../lib/model/task";
import { createTracker, type TaskTracker } from "../lib/model/tracker";
import type { CompletionPlan } from "../lib/views/completion";
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
  /** Entries are keyed by tracker document URL. Stored resources retain their URL and ETag. */
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
    for (const project of projects)
      if (this.projectFailures.has(project.url))
        tasks[project.url] = { status: "loading", items: [] };
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
  loadTasks(project: StoredProject, force = false): Promise<void> {
    if (this.projectFailures.has(project.url)) {
      if (!force) return Promise.resolve();
      return this.refreshProjects().then(() => {
        if (!this.projectFailures.has(project.url)) return this.loadTasks(project, true);
      });
    }
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
      const items = await this.store.listTasks(project.tracker.stateStore as string);
      if (this.projectFailures.has(project.url)) return;
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
      const affected = projects.filter(
        (project) =>
          url.startsWith(project.tracker.stateStore as string) ||
          (project.tracker.stateStore as string).startsWith(url) ||
          url === project.url,
      );
      if (
        url.startsWith(this.store.projects) ||
        this.store.projects.startsWith(url) ||
        affected.some((project) => project.url === url)
      )
        await this.refreshProjects();
      await Promise.all(
        affected
          .filter((project) => !this.projectFailures.has(project.url))
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
    return this.mutate(
      (state) => replaceTask(state, project.url, url, optimistic),
      async () => {
        const task = await this.store.createTask(this.project(project.url), details, id);
        return { result: task, commit: (state) => replaceTask(state, project.url, task.url, task) };
      },
      () => {
        void this.createTask(project, data);
      },
      [url],
    );
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
  /** Both recurring writes form one retry unit; compensate the conditional create on update failure. */
  advanceTask(item: StoredTask, plan: Extract<CompletionPlan, { kind: "advance" }>) {
    const project = this.snapshot.projects.find((project) =>
      this.snapshot.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!project) return Promise.resolve(undefined);
    const id = crypto.randomUUID();
    const url = `${project.tracker.stateStore}${id}.ttl`;
    const dataset = createTask(url, plan.copy);
    const copy = {
      url,
      dataset,
      etag: null,
      task: new TaskItem(`${url}#it`, dataset, DataFactory),
    };
    const advance = (task: TaskItem) => {
      task.dueDate = plan.original.dueDate;
      task.allDay = plan.original.allDay;
      task.reminders = plan.original.reminders ?? [];
    };
    return this.mutate(
      (state) => {
        const current = state.tasks[project.url]?.items.find((task) => task.url === item.url);
        return current
          ? replaceTask(
              replaceTask(state, project.url, url, copy),
              project.url,
              item.url,
              changeTask(current, advance),
            )
          : state;
      },
      async () => {
        const copy = await this.store.createTask(this.project(project.url), plan.copy, id);
        let original: StoredTask;
        try {
          original = await this.store.updateTask(this.task(project.url, item.url), advance);
        } catch (error) {
          await this.store.deleteTask(copy);
          throw error;
        }
        return {
          result: plan,
          commit: (state) =>
            replaceTask(
              replaceTask(state, project.url, copy.url, copy),
              project.url,
              original.url,
              original,
            ),
        };
      },
      () => {
        void this.advanceTask(item, plan);
      },
      [item.url, url],
    );
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
