// AUTHORED-BY Codex GPT-6.1-Sol

import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
let cache: TasksCache;
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => {
    const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
    return {
      ...snapshot,
      cache,
      inboxUrl: cache.inboxUrl,
      createTask: cache.createTask.bind(cache),
      updateTask: cache.updateTask.bind(cache),
      deleteTask: cache.deleteTask.bind(cache),
      addSection: cache.addSection,
    };
  },
}));

import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { TaskList } from "../../src/apps/tasks/components/task-list";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";
import { TodayView } from "../../src/apps/tasks/components/views/today-view";
import { UpcomingView } from "../../src/apps/tasks/components/views/upcoming-view";
import { useNow } from "../../src/apps/tasks/state/clock";
import { useTasks } from "../../src/apps/tasks/state/tasks-context";

function Listing() {
  const tasks = useTasks();
  return h(
    "main",
    null,
    h(TaskList, {
      project: tasks.projects[0],
      rows: tasks.views
        .filter((task) => task.state === "open")
        .map((task) => ({ task, depth: 0 as const })),
    }),
  );
}
function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function populated(titles: string[]) {
  const result = await frameCache();
  cache = result.cache;
  for (const title of titles) await cache.createTask(result.inbox, { title });
  const view = await mount(h(Listing));
  return { ...result, ...view };
}
beforeEach(() => {
  localStorage.clear();
});

it("offers Skip this occurrence only on open recurring rows and advances without history", async () => {
  const frame = await frameCache();
  cache = frame.cache;
  const recurring = await cache.createTask(frame.inbox, {
    title: "Review",
    allDay: "2026-11-20",
    recurrence: { frequency: "MONTHLY", byDay: ["Friday"], bySetPos: 3 },
  });
  await cache.createTask(frame.inbox, { title: "Plain" });
  if (!recurring) throw new Error("Missing recurring task");
  await mount(h(Listing));
  await key(
    document.querySelector("button[aria-label=\"Actions for 'Plain'\"]") as Element,
    "ArrowDown",
  );
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].some(
      (item) => item.textContent === "Skip this occurrence",
    ),
  ).toBe(false);
  await key(document.querySelector('[role="menu"]') as Element, "Escape");
  await key(
    document.querySelector("button[aria-label=\"Actions for 'Review'\"]") as Element,
    "ArrowDown",
  );
  await click(button("Skip this occurrence"));
  await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
  expect((await frame.store.readTask(recurring.url)).task.allDay).toBe("2026-12-18");
  expect(cache.getSnapshot().views).toHaveLength(2);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  { view: "project", status: 503 },
  { view: "cross-project", status: 503 },
  { view: "project", status: 403 },
  { view: "cross-project", status: 403 },
  { view: "project", status: 401 },
  { view: "cross-project", status: 401 },
])("shows and retries a cold-load $status tracker failure in the $view view", async ({
  view,
  status,
}) => {
  const result = await frameCache();
  const home = await result.store.createProject("Home");
  await result.store.createTask(home, {
    title: "Recovered task",
    state: "open",
    dueDate: new Date("2026-01-01T12:00:00Z"),
  });
  await result.cache.createTask(result.inbox, {
    title: "Healthy project",
    due: new Date("2026-01-01T12:00:00Z"),
  });
  result.pod.intercept = (request) =>
    request.url === home.url && request.method === "GET"
      ? new Response(null, { status })
      : undefined;
  cache = new TasksCache(result.store, vi.fn(), webId);
  await cache.start();
  await cache.loadTasks(result.inbox);
  expect(cache.getSnapshot().projects.some((project) => project.url === home.url)).toBe(false);
  expect(cache.getSnapshot().tasks[home.url]?.status).toBe("error");
  const { host } = await mount(
    h("main", null, view === "project" ? h(ProjectView, { projectUrl: home.url }) : h(TodayView)),
  );
  expect(button("Retry", host)).toBeTruthy();
  expect(host.textContent).not.toContain("not found");
  if (view === "cross-project") expect(host.textContent).toContain("Healthy project");
  result.pod.intercept = undefined;
  await click(button("Retry", host));
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().tasks[home.url]?.status).toBe("ready"));
  });
  expect(host.textContent).toContain("Recovered task");
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
  ).toBe(false);
});

describe("Tasks row deletion and focus", () => {
  it("prunes a selected task when rescheduling removes it from Today, so e edits the focused row", async () => {
    const result = await frameCache();
    cache = result.cache;
    const today = new Date();
    const dayKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const first = await cache.createTask(result.inbox, {
      title: "Selected today",
      allDay: dayKey(today),
    });
    const second = await cache.createTask(result.inbox, {
      title: "Still today",
      allDay: dayKey(today),
    });
    if (!first || !second) throw new Error("Missing tasks");
    const { host } = await mount(h("main", null, h(TodayView)));
    const row = host.querySelector<HTMLElement>(`[data-tsk-row="${first.url}"]`);
    if (!row) throw new Error("Missing row");
    await act(() => row.focus());
    await key(row, " ");
    expect(row.getAttribute("aria-selected")).toBe("true");
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    await act(() =>
      cache.updateTask(first, (task) => {
        task.allDay = dayKey(tomorrow);
      }),
    );
    expect(host.querySelector(`[data-tsk-row="${first.url}"]`)).toBeNull();
    const remaining = host.querySelector<HTMLElement>("[data-tsk-row]");
    if (!remaining) throw new Error("Missing remaining row");
    await act(() => remaining.focus());
    await key(remaining, "e");
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector(".tsk-inline-title input")).toBeTruthy());
    });
    expect((await result.store.readTask(first.url)).task.state).toBe("open");
    expect((await result.store.readTask(second.url)).task.state).toBe("open");
    // Returning to this view does not resurrect the old selection.
    await key(host.querySelector(".tsk-inline-title input") as Element, "Escape");
    await act(() =>
      cache.updateTask(first, (task) => {
        task.allDay = dayKey(today);
      }),
    );
    expect(host.querySelector(`[data-tsk-row="${first.url}"]`)?.getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("hides immediately with Undo and only deletes on expiry or dismissal", async () => {
    const { host, store } = await populated(["Pay rent"]);
    const { toast } = await import("@jeswr/suite-ui");
    const { pendingDeletes } = await import("../../src/apps/tasks/state/actions");
    const deletes = vi.spyOn(store, "deleteTask");
    const row = host.querySelector<HTMLElement>("[data-tsk-row]");
    if (!row) throw new Error("Missing row");
    await act(() => row.focus());
    await key(row, "F10", true);
    await act(async () => {
      await vi.waitFor(() =>
        expect(button("Delete", document.querySelector('[role="menu"]') ?? document)).toBeTruthy(),
      );
    });
    await click(button("Delete", document.querySelector('[role="menu"]') ?? document));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(0);
    expect(deletes).not.toHaveBeenCalled();
    const call = vi.mocked(toast.success).mock.calls.at(-1);
    expect(call?.[0]).toBe("Deleted 'Pay rent'");
    const action = call?.[1]?.action;
    if (!action || typeof action !== "object" || !("onClick" in action))
      throw new Error("Missing Undo");
    await act(() => action.onClick(new MouseEvent("click") as never));
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(1);
    await act(async () => {
      const view = cache.getSnapshot().views[0];
      if (!view) throw new Error("Missing task");
      const { deleteTask } = await import("../../src/apps/tasks/state/actions");
      await deleteTask(view, { ...cache.getSnapshot(), cache } as never);
      pendingDeletes(cache).flush();
      await vi.waitFor(() => expect(deletes).toHaveBeenCalledOnce());
    });
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain("Add task");
  });

  it("moves real focus to the next row, previous row, then add control after completion", async () => {
    const { host } = await populated(["First", "Middle", "Last"]);
    const rows = () => [...host.querySelectorAll<HTMLElement>("[data-tsk-row]")];
    const middle = rows()[1];
    if (!middle) throw new Error("Missing middle");
    await act(() => middle.focus());
    await key(middle, " ");
    expect(middle.getAttribute("aria-selected")).toBe("true");
    await key(middle, "e");
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(2));
    });
    expect(document.activeElement?.textContent).toContain("Last");
    await key(document.activeElement as Element, " ");
    await key(document.activeElement as Element, "e");
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(1));
    });
    expect(document.activeElement?.textContent).toContain("First");
    await key(document.activeElement as Element, " ");
    await key(document.activeElement as Element, "e");
    await act(async () => {
      await vi.waitFor(() => expect(rows()).toHaveLength(0));
    });
    expect(rows()).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain("Add task");
  });

  it.each([
    true,
    false,
  ])("hands focus to the next row only once a row menu has closed and the list is no longer inert (focus elsewhere: %s)", async (elsewhere) => {
    const { host, inbox } = await populated(["First", "Second"]);
    const [first, second] = [...host.querySelectorAll<HTMLElement>("[data-tsk-row]")];
    if (!first || !second) throw new Error("Missing rows");
    await act(() => first.focus());
    // A row menu (outside the list) takes focus and, like Radix, makes the list inert.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.append(item);
    document.body.append(menu);
    await act(() => item.focus());
    second.setAttribute("inert", "");
    const task = cache.getSnapshot().tasks[inbox.url]?.items[0];
    if (!task) throw new Error("Missing task");
    await act(() => cache.deleteTask(task));
    expect(document.activeElement).toBe(item);
    await act(() => menu.remove());
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await act(frame);
    // focus() on an inert row fails silently in a browser: nothing may move while it is inert.
    expect(document.activeElement).not.toBe(second);
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(() => {
      second.removeAttribute("inert");
      if (elsewhere) outside.focus();
    });
    await act(frame);
    expect(document.activeElement).toBe(elsewhere ? outside : second);
    outside.remove();
  });
  it("keeps focus on another control during a remote row removal", async () => {
    const { host, inbox } = await populated(["First", "Second"]);
    const row = host.querySelector<HTMLElement>("[data-tsk-row]");
    if (!row) throw new Error("Missing row");
    await act(() => row.focus());
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(() => outside.focus());
    const task = cache.getSnapshot().tasks[inbox.url]?.items[0];
    if (!task) throw new Error("Missing task");
    await act(() => cache.deleteTask(task));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

it("opens the composer from Today's empty state over the current view", async () => {
  const result = await frameCache();
  cache = result.cache;
  const open = vi.fn();
  window.addEventListener("tasks:quick-add", open);
  try {
    const { host } = await mount(h("main", null, h(TodayView)));
    expect(host.textContent).toContain("Nothing due today");
    await click(button("Add task", host));
    expect(open).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("tasks:quick-add", open);
  }
});

it("ticks without a task render and refreshes on visibility return, cleaning up its timer", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T23:59:40Z"));
  function Clock() {
    return h("output", null, useNow().toISOString());
  }
  const { host, unmount } = await mount(h(Clock));
  expect(host.textContent).toBe("2026-11-01T23:59:40.000Z");
  await act(() => vi.advanceTimersByTime(20_000));
  expect(host.textContent).toBe("2026-11-02T00:00:00.000Z");
  await act(() => vi.advanceTimersByTime(60_000));
  expect(host.textContent).toBe("2026-11-02T00:01:00.000Z");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.setSystemTime(new Date("2026-11-03T10:17:04Z"));
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(host.textContent).toBe("2026-11-03T10:17:04.000Z");
  await unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes Today, Upcoming, due chips and sidebar counts as clock boundaries pass", async () => {
  const result = await frameCache();
  cache = result.cache;
  await cache.createTask(result.inbox, { title: "Tomorrow task", allDay: "2026-11-02" });
  await cache.createTask(result.inbox, {
    title: "Timed task",
    due: new Date("2026-11-01T16:59:59Z"),
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T16:59:40Z"));
  const { host, unmount } = await mount(
    h(
      "main",
      null,
      h(TasksSidebar),
      h("section", { id: "today" }, h(TodayView)),
      h("section", { id: "upcoming" }, h(UpcomingView)),
    ),
  );
  const badge = () => host.querySelector('a[href="/tasks/today"] .tsk-count');
  expect(badge()?.textContent).toBe("1");
  expect(badge()?.hasAttribute("data-destructive")).toBe(false);
  expect(host.querySelector("#upcoming")?.textContent).toContain("Tomorrow task");
  expect(host.querySelector("#today")?.textContent).not.toContain("Tomorrow task");
  await act(() => vi.advanceTimersByTime(20_000));
  expect(badge()?.getAttribute("data-destructive")).toBe("true");
  expect(host.querySelector("#today .tsk-due")?.getAttribute("data-overdue")).toBe("true");
  vi.setSystemTime(new Date("2026-11-01T23:59:40Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(() => vi.advanceTimersByTime(20_000));
  expect(badge()?.textContent).toBe("2");
  expect(host.querySelector("#today")?.textContent).toContain("Tomorrow task");
  // Upcoming's seven-day agenda includes today; the due chip changes at midnight.
  expect(host.querySelector("#upcoming")?.textContent).toContain("Tomorrow task");
  expect(
    host.querySelector("#upcoming .tsk-day-cell[data-today]")?.getAttribute("data-day-key"),
  ).toBe("2026-11-02");
  expect([...host.querySelectorAll("#today .tsk-due")].map((chip) => chip.textContent)).toContain(
    "Today",
  );
  // WCAG 2.5.3: each chip's accessible name begins with its visible due text.
  for (const chip of host.querySelectorAll("#today .tsk-due"))
    expect(chip.getAttribute("aria-label")).toMatch(
      new RegExp(`^${chip.textContent}, reschedule '(Timed|Tomorrow) task'$`),
    );
  await unmount();
});
