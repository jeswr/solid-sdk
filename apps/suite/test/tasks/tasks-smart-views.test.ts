// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import type { TasksContextValue } from "../../src/apps/tasks/state/tasks-context";
import { act, click, h, key, mount } from "../drive-ui-dom";
import type { Pod } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const now = new Date("2026-11-02T10:00:00Z");
let cache: TasksCache;
let pod: Pod;
const replace = vi.fn();
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/today",
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/clock", () => ({ useNow: () => now }));
function api(snapshot = cache.getSnapshot()): TasksContextValue {
  return {
    ...snapshot,
    cache,
    inboxUrl: cache.inboxUrl,
    webId: "https://alice.example/#me",
    loadTasks: cache.loadTasks.bind(cache),
    retry: cache.retry,
    createTask: cache.createTask.bind(cache),
    updateTask: cache.updateTask.bind(cache),
    updateProject: cache.updateProject.bind(cache),
    deleteTask: cache.deleteTask.bind(cache),
    createProject: cache.createProject.bind(cache),
    ensureLabels: cache.ensureLabels.bind(cache),
    moveTaskToProject: cache.moveTaskToProject.bind(cache),
    renameProject: cache.renameProject,
    archiveProject: cache.archiveProject,
    deleteProject: cache.deleteProject.bind(cache),
    moveProject: cache.moveProject.bind(cache),
    addSection: cache.addSection,
    renameSection: cache.renameSection,
    moveSection: cache.moveSection.bind(cache),
    deleteSection: cache.deleteSection.bind(cache),
  };
}
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => api(useSyncExternalStore(cache.subscribe, cache.getSnapshot)),
}));

import { toast } from "@jeswr/suite-ui";

import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { CompletedView } from "../../src/apps/tasks/components/views/completed-view";
import { LabelView } from "../../src/apps/tasks/components/views/label-view";
import { TodayView } from "../../src/apps/tasks/components/views/today-view";
import { UpcomingView } from "../../src/apps/tasks/components/views/upcoming-view";
import {
  deleteLabel,
  labelTargets,
  renameLabel,
  rescheduleTasks,
} from "../../src/apps/tasks/state/view-actions";

function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function region(host: ParentNode, title: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>("section")].find(
    (element) => element.querySelector("h2")?.textContent === title,
  );
  if (!found) throw new Error(`Missing group: ${title}`);
  return found;
}
const titles = (root: ParentNode) =>
  [...root.querySelectorAll(".tsk-task-title")].map((element) => element.textContent);
async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function labels() {
  const inbox = cache.getSnapshot().projects[0] as StoredProject;
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing Home");
  await cache.loadTasks(home);
  for (const [project, name] of [
    [inbox, "bills"],
    [home, "Bills"],
  ] as const) {
    const updated = await cache.ensureLabels(project, [name]);
    if (!updated) throw new Error("Missing label");
    await cache.createTask(updated, {
      title: `${project.tracker.title} rent`,
      labelIds: updated.tracker.labels.map((label) => label.id),
    });
  }
  return { inbox, home };
}
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  vi.clearAllMocks();
  ({ cache, pod } = await frameCache());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Today", () => {
  it("returns focus to Reschedule all on Escape and to the heading when Overdue disappears", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Late", allDay: "2026-11-01" });
    const { host } = await mount(h("main", null, h(TodayView)));
    const opener = button("Reschedule all", host);
    await act(() => opener.focus());
    await click(opener);
    await key(document.activeElement as Element, "Escape");
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    });
    expect(cache.getSnapshot().views[0]?.allDay).toBe("2026-11-01");
    await click(opener);
    await click(button("Today", document.querySelector('[role="dialog"]') ?? document));
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector("h1")));
    });
    expect(host.textContent).not.toContain("Overdue");
  });

  it("moves focus across groups after completion, then to the empty-state action", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Late", allDay: "2026-11-01" });
    await cache.createTask(inbox, { title: "Today task", allDay: "2026-11-02" });
    const { host } = await mount(h("main", null, h(TodayView)));
    const row = host.querySelector<HTMLElement>("[data-tsk-row]") as HTMLElement;
    const next = region(host, "Today").querySelector<HTMLElement>("[data-tsk-row]") as HTMLElement;
    expect(host.querySelectorAll('[data-tsk-row][tabindex="0"]')).toHaveLength(1);
    await act(() => row.focus());
    await key(row, "ArrowDown");
    expect(document.activeElement).toBe(next);
    await key(next, "ArrowUp");
    expect(document.activeElement).toBe(row);
    await key(row, " ");
    await key(row, "e");
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(next));
    });
    await key(next, " ");
    await key(next, "e");
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(button("Add task", host)));
    });
  });

  it("groups and counts overdue separately, orders all-day before time, and reschedules all through updates", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Timed today", due: new Date("2026-11-02T17:00:00Z") });
    await cache.createTask(inbox, { title: "All day", allDay: "2026-11-02" });
    await cache.createTask(inbox, {
      title: "Overdue timed",
      due: new Date("2026-11-01T17:00:00Z"),
    });
    await cache.createTask(inbox, { title: "Overdue early", allDay: "2026-10-30" });
    const updates = vi.spyOn(cache, "updateTask");
    const { host } = await mount(h("main", null, h(TodayView)));
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(document.title).toBe("Today · Tasks · Solid Suite");
    expect(host.textContent).toContain("Monday, 2 November");
    expect(host.querySelector(".tsk-heading-line .tsk-count")?.textContent).toBe("4 tasks");
    expect(region(host, "Overdue").querySelector("[data-destructive]")?.textContent).toBe(
      "2 tasks",
    );
    expect(titles(region(host, "Overdue"))).toEqual(["Overdue early", "Overdue timed"]);
    expect(titles(region(host, "Today"))).toEqual(["All day", "Timed today"]);
    await click(button("Overdue", host));
    expect(region(host, "Overdue").querySelector("[hidden]")).not.toBeNull();
    await click(button("Overdue", host));
    await click(button("Reschedule all", host));
    await click(button("Today", document.querySelector('[role="dialog"]') ?? document));
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    expect(updates).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Rescheduled 2 tasks");
    expect(titles(region(host, "Today"))).toEqual([
      "All day",
      "Overdue early",
      "Timed today",
      "Overdue timed",
    ]);
    expect([...host.querySelectorAll("h2")].map((heading) => heading.textContent)).not.toContain(
      "Overdue",
    );
    expect(
      cache
        .getSnapshot()
        .views.find((task) => task.title === "Overdue timed")
        ?.due?.getHours(),
    ).toBe(17);
  });

  it("renders the exact empty copy and opens quick add", async () => {
    const open = vi.fn();
    window.addEventListener("tasks:quick-add", open);
    try {
      const { host } = await mount(h("main", null, h(TodayView)));
      expect(host.textContent).toContain("Nothing due today");
      expect(host.textContent).toContain("Enjoy the quiet, or add a task for today");
      await click(button("Add task", host));
      expect(open).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("tasks:quick-add", open);
    }
  });

  it("counts rolled-back writes as failures while continuing the batch", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Fail", allDay: "2026-11-01" });
    await cache.createTask(inbox, { title: "Save", allDay: "2026-11-01" });
    const tasks = api();
    const update = tasks.updateTask;
    tasks.updateTask = vi.fn((item, change) =>
      item.task.title === "Fail" ? Promise.resolve(undefined) : update(item, change),
    );
    const result = await rescheduleTasks(tasks.views, "2026-11-02", tasks);
    expect(result.done.map((task) => task.title)).toEqual(["Save"]);
    expect(result.failed.map(({ item }) => item.title)).toEqual(["Fail"]);
    expect(cache.getSnapshot().views.find((task) => task.title === "Fail")?.allDay).toBe(
      "2026-11-01",
    );
    expect(toast.success).toHaveBeenCalledWith("Rescheduled 1 tasks");
  });
});

describe("Upcoming", () => {
  it("renders default locale preferences when both week-info APIs are missing", async () => {
    const method = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "getWeekInfo");
    const property = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "weekInfo");
    Object.defineProperties(Intl.Locale.prototype, {
      getWeekInfo: { configurable: true, value: undefined },
      weekInfo: { configurable: true, value: undefined },
    });
    try {
      const { host } = await mount(h("main", null, h(UpcomingView)));
      expect(host.querySelectorAll(".tsk-day-cell")).toHaveLength(7);
      expect(host.querySelector(".tsk-day-cell")?.getAttribute("data-day-key")).toBe("2026-11-02");
    } finally {
      for (const [key, descriptor] of [
        ["getWeekInfo", method],
        ["weekInfo", property],
      ] as const) {
        if (descriptor) Object.defineProperty(Intl.Locale.prototype, key, descriptor);
        else Reflect.deleteProperty(Intl.Locale.prototype, key);
      }
    }
  });

  it("honours weekStart, shifts seven days, shows overdue only from Today, and opens a day composer", async () => {
    localStorage.setItem("suite.tasks.prefs", JSON.stringify({ weekStart: "sunday" }));
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Late", allDay: "2026-10-31" });
    await cache.createTask(inbox, { title: "Monday task", allDay: "2026-11-02" });
    await cache.createTask(inbox, { title: "Future", allDay: "2026-11-16" });
    const { host } = await mount(h("main", null, h(UpcomingView)));
    expect(host.querySelectorAll(".tsk-day-cell")).toHaveLength(7);
    expect(host.querySelector(".tsk-day-cell")?.getAttribute("data-day-key")).toBe("2026-11-01");
    expect(
      host.querySelector('.tsk-day-cell[data-day-key="2026-11-02"]')?.getAttribute("aria-label"),
    ).toContain("1 task");
    expect(host.querySelector(".tsk-day-cell[data-today]")).not.toBeNull();
    expect([...host.querySelectorAll("h2")].map((heading) => heading.textContent)).not.toContain(
      "Overdue",
    );
    expect(region(host, "Later").querySelector("[hidden]")).not.toBeNull();
    await click(button("Later", host));
    expect(titles(region(host, "Later"))).toEqual(["Future"]);
    await click(host.querySelector('[aria-label="Next week"]') as Element);
    expect(host.querySelector(".tsk-day-cell")?.getAttribute("data-day-key")).toBe("2026-11-08");
    await click(host.querySelector('[aria-label="Previous week"]') as Element);
    expect(host.querySelector(".tsk-day-cell")?.getAttribute("data-day-key")).toBe("2026-11-01");
    await click(button("Today", host));
    expect(titles(region(host, "Overdue"))).toEqual(["Late"]);
    const cell = host.querySelector('.tsk-day-cell[data-day-key="2026-11-04"]') as HTMLElement;
    cell.scrollIntoView = vi.fn();
    await click(cell);
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    expect(cell.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    expect(document.activeElement?.getAttribute("data-day-key")).toBe("2026-11-04");
    await click(button("Add task", region(host, "Wed 4 Nov")));
    expect(host.querySelector(".tsk-composer-chips")?.textContent).toContain("Due Wed");
    const input = host.querySelector<HTMLInputElement>(".tsk-composer input[placeholder]");
    if (!input) throw new Error("Missing day composer");
    await type(input, "Agenda addition");
    await act(() =>
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          cache.getSnapshot().views.find((task) => task.title === "Agenda addition")?.allDay,
        ).toBe("2026-11-04"),
      );
    });
  });

  it("opens Reschedule from the row keyboard menu and preserves 17:00", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Evening task", due: new Date("2026-11-03T17:00:00Z") });
    const { host } = await mount(h("main", null, h(UpcomingView)));
    const row = host.querySelector<HTMLElement>("[data-tsk-row]") as HTMLElement;
    await act(() => row.focus());
    await key(row, "F10", true);
    await click(button("Reschedule…", document.querySelector('[role="menu"]') ?? document));
    await click(button("Next week", document.querySelector('[role="dialog"]') ?? document));
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    expect(cache.getSnapshot().views[0]?.due?.toISOString()).toBe("2026-11-09T17:00:00.000Z");
  });
});

describe("Completed", () => {
  it.each([
    "first",
    "last",
  ])("focuses the next or previous group when reopening its %s task, then the heading", async (which) => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    await cache.createTask(inbox, { title: "Today done", state: "closed", endedAt: now });
    await cache.createTask(inbox, {
      title: "Yesterday done",
      state: "closed",
      endedAt: new Date("2026-11-01T12:00:00Z"),
    });
    const { host } = await mount(h("main", null, h(CompletedView)));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-tsk-row]")];
    const row = rows[which === "first" ? 0 : 1] as HTMLElement;
    const remaining = rows[which === "first" ? 1 : 0] as HTMLElement;
    await act(() => row.focus());
    await click(row.querySelector("input") as Element);
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(remaining));
    });
    await click(remaining.querySelector("input") as Element);
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector("h1")));
    });
  });

  it("groups by completion day, renders occurrence metadata, and reopens with endedAt removed", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    const first = await cache.createTask(inbox, {
      title: "Finished",
      state: "closed",
      endedAt: now,
      clonedFrom: `${inbox.url}#source`,
    });
    await cache.createTask(inbox, {
      title: "Yesterday done",
      state: "closed",
      endedAt: new Date("2026-11-01T12:00:00Z"),
    });
    const { host } = await mount(h("main", null, h(CompletedView)));
    expect(titles(region(host, "Today"))).toEqual(["Finished"]);
    expect(titles(region(host, "Yesterday"))).toEqual(["Yesterday done"]);
    expect(host.querySelector('[title="Occurrence of a recurring task"]')).not.toBeNull();
    expect(host.querySelector("time")?.textContent).toBe("10:00");
    const checkbox = host.querySelector<HTMLInputElement>(
      "input[aria-label=\"Reopen 'Finished'\"]",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    await click(checkbox);
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    const saved = cache
      .getSnapshot()
      .tasks[inbox.url]?.items.find((task) => task.url === first?.url);
    expect(saved?.task.state).toBe("open");
    expect(saved?.task.endedAt).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith("Reopened");
    expect(titles(host)).not.toContain("Finished");
  });

  it("appends 50-item pages without duplicate day headers and filters before paging", async () => {
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    for (let index = 0; index < 51; index++)
      await cache.createTask(inbox, {
        title: `Done ${index}`,
        state: "closed",
        endedAt: new Date(now.getTime() - index * 1000),
      });
    const home = await cache.createProject("Home");
    if (!home) throw new Error("Missing Home");
    await cache.loadTasks(home);
    await cache.createTask(home, { title: "Home complete", state: "closed", endedAt: now });
    const { host } = await mount(h("main", null, h(CompletedView)));
    expect(titles(host)).toHaveLength(50);
    await click(button("Show more", host));
    expect(titles(host)).toHaveLength(52);
    expect(
      [...host.querySelectorAll("h2")].filter((heading) => heading.textContent === "Today"),
    ).toHaveLength(1);
    await click(button("Home", host));
    expect(titles(host)).toEqual(["Home complete"]);
    expect(host.textContent).not.toContain("Show more");
    await click(button("All projects", host));
    expect(titles(host)).toHaveLength(50);
  });

  it("renders exact empty copy", async () => {
    const { host } = await mount(h("main", null, h(CompletedView)));
    expect(host.textContent).toContain("Nothing completed yet");
    expect(host.textContent).toContain("Completed tasks will show up here");
  });
});

describe("Label view", () => {
  it("shares focus across project groups and skips rows in collapsed groups", async () => {
    await labels();
    const { host } = await mount(h("main", null, h(LabelView, { label: "bills" })));
    const inbox = region(host, "Inbox").querySelector<HTMLElement>("[data-tsk-row]") as HTMLElement;
    const home = region(host, "Home").querySelector<HTMLElement>("[data-tsk-row]") as HTMLElement;
    await act(() => inbox.focus());
    await key(inbox, "ArrowDown");
    expect(document.activeElement).toBe(home);
    await act(() => button("Home", host).focus());
    await click(button("Home", host));
    expect(inbox.tabIndex).toBe(0);
    await act(() => inbox.focus());
    await key(inbox, "ArrowDown");
    expect(document.activeElement).toBe(inbox);
    await key(inbox, " ");
    await key(inbox, "e");
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector("h1")));
    });
    await click(button("Home", host));
    expect(home.tabIndex).toBe(0);
  });

  it("renames only tracker metadata even when task projections are incomplete", async () => {
    const { home } = await labels();
    const tasks = api();
    const load = tasks.tasks[home.url];
    if (!load) throw new Error("Missing Home load");
    tasks.tasks = { ...tasks.tasks, [home.url]: { ...load, warningCount: 1 } };
    const updateTask = vi.spyOn(tasks, "updateTask");
    const result = await renameLabel("bills", "utilities", tasks);
    expect(result.done).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(updateTask).not.toHaveBeenCalled();
    expect(
      cache
        .getSnapshot()
        .projects.flatMap((project) => project.tracker.labels.map((label) => label.name)),
    ).toEqual(["utilities", "utilities"]);
  });

  it("refuses the whole deletion with an error toast when a ready project skipped a labelled task", async () => {
    await labels();
    const tasks = api();
    const target = labelTargets("bills", tasks.projects)[1];
    if (!target) throw new Error("Missing Home label");
    const bad = await cache.store.createTask(target.project, { title: "Skipped", state: "open" });
    const dataset = await pod.dataset(bad.url);
    for (const id of target.labelIds) node(bad.task.id, dataset).types.add(id);
    const rule = `${bad.url}#recurrence`;
    node(bad.task.id, dataset).iris(`${NS.SCHEDULING}recurrence`).add(rule);
    node(rule, dataset).setText(`${NS.SCHEDULING}frequency`, "FORTNIGHTISH");
    pod.seed(bad.url, await serialize(dataset));
    await cache.loadTasks(target.project, true);
    expect(cache.getSnapshot().tasks[target.project.url]).toMatchObject({
      status: "ready",
      warningCount: 1,
    });
    expect(
      cache.getSnapshot().tasks[target.project.url]?.items.some((item) => item.url === bad.url),
    ).toBe(false);
    const writes = pod.mutations().length;
    const { host } = await mount(h("main", null, h(LabelView, { label: "bills" })));
    await click(button("Delete", host));
    await click(button("Delete", document.querySelector('[role="alertdialog"]') as HTMLElement));
    expect(pod.mutations()).toHaveLength(writes);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Home"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(
      cache.getSnapshot().projects.every((project) => project.tracker.labels.length === 1),
    ).toBe(true);
    expect(
      node(bad.task.id, await pod.dataset(bad.url)).types.has(target.labelIds[0] as string),
    ).toBe(true);
  });

  it.each([
    "missing",
    "loading",
    "error",
  ] as const)("writes nothing when one affected project's task load is %s", async (status) => {
    const { home } = await labels();
    const tasks = api();
    tasks.tasks = { ...tasks.tasks };
    if (status === "missing") delete tasks.tasks[home.url];
    else tasks.tasks[home.url] = { status, items: [] };
    const writes = pod.mutations().length;
    const result = await deleteLabel("bills", tasks);
    expect(result.done).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(pod.mutations()).toHaveLength(writes);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Home"));
  });

  it("unions sidebar counts and groups projects, then confirms rename in both trackers", async () => {
    await labels();
    const updates = vi.spyOn(cache, "updateProject");
    const { host } = await mount(
      h("main", null, h(TasksSidebar), h(LabelView, { label: "bills" })),
    );
    expect(host.querySelectorAll('a[href="/tasks/l/bills"]')).toHaveLength(1);
    expect(host.querySelector('a[href="/tasks/l/bills"]')?.textContent).toContain("2");
    expect(titles(region(host, "Inbox"))).toEqual(["Inbox rent"]);
    expect(titles(region(host, "Home"))).toEqual(["Home rent"]);
    await click(button("Home", region(host, "Home")));
    expect(region(host, "Home").querySelector("[hidden]")).not.toBeNull();
    await click(button("Rename", host));
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Rename @bills in 2 projects?");
    expect(dialog.querySelector("ul")?.textContent).toContain("Home");
    expect(updates).not.toHaveBeenCalled();
    await click(button("Cancel", dialog));
    expect(updates).not.toHaveBeenCalled();
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement).toBe(button("Rename", host)));
    });
    await click(button("Rename", host));
    await type(
      document.querySelector('[role="alertdialog"] input') as HTMLInputElement,
      "utilities",
    );
    await click(button("Rename", document.querySelector('[role="alertdialog"]') as HTMLElement));
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    expect(updates).toHaveBeenCalledTimes(2);
    expect(
      cache
        .getSnapshot()
        .projects.flatMap((project) => project.tracker.labels.map((label) => label.name)),
    ).toEqual(["utilities", "utilities"]);
    expect(replace).toHaveBeenCalledWith("/tasks/l/utilities");
    expect(cache.getSnapshot().views.every((task) => task.labelIds.length === 1)).toBe(true);
  });

  it("confirms deletion and removes types from open and closed tasks before deleting classes", async () => {
    const { inbox } = await labels();
    const updated = cache
      .getSnapshot()
      .projects.find((project) => project.url === inbox.url) as StoredProject;
    await cache.createTask(updated, {
      title: "Closed bill",
      state: "closed",
      endedAt: now,
      labelIds: updated.tracker.labels.map((label) => label.id),
    });
    const updates = vi.spyOn(cache, "updateTask");
    const { host } = await mount(h("main", null, h(LabelView, { label: "bills" })));
    await click(button("Delete", host));
    expect(updates).not.toHaveBeenCalled();
    await click(button("Cancel", document.querySelector('[role="alertdialog"]') as HTMLElement));
    expect(updates).not.toHaveBeenCalled();
    await click(button("Delete", host));
    await click(button("Delete", document.querySelector('[role="alertdialog"]') as HTMLElement));
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    expect(updates).toHaveBeenCalledTimes(3);
    expect(
      cache.getSnapshot().projects.every((project) => project.tracker.labels.length === 0),
    ).toBe(true);
    expect(cache.getSnapshot().views.every((task) => task.labelIds.length === 0)).toBe(true);
    expect(replace).toHaveBeenCalledWith("/tasks/inbox");
  });

  it("keeps a class on failed task removal, preserves other labels, and counts rename failures", async () => {
    await labels();
    const tasks = api();
    const target = labelTargets("bills", tasks.projects)[0];
    if (!target) throw new Error("Missing label target");
    const oldIds = target.labelIds;
    const update = tasks.updateTask;
    tasks.updateTask = vi.fn((item, change) =>
      item.task.title === "Inbox rent" ? Promise.resolve(undefined) : update(item, change),
    );
    const result = await deleteLabel("bills", tasks);
    expect(result.done).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(
      cache
        .getSnapshot()
        .projects.find((project) => project.url === target.project.url)
        ?.tracker.labels.map((label) => label.id),
    ).toEqual(oldIds);
    const broken = api();
    broken.updateProject = vi.fn().mockResolvedValue(undefined);
    const renamed = await renameLabel("bills", "new", broken);
    expect(renamed.done).toHaveLength(0);
    expect(renamed.failed).toHaveLength(1);
    await expect(renameLabel("bills", "  ", api())).rejects.toThrow();
  });

  it("renders the label empty state and a list skeleton while projects load", async () => {
    const { host, render } = await mount(h("main", null, h(LabelView, { label: "missing" })));
    expect(host.textContent).toContain("No tasks with @missing");
    const empty = new (cache.constructor as typeof TasksCache)(
      cache.store,
      vi.fn(),
      "https://alice.example/#me",
    );
    cache = empty;
    await render(h("main", null, h(TodayView)));
    expect(host.querySelector('[aria-busy="true"], [role="status"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Nothing due today");
  });
});
