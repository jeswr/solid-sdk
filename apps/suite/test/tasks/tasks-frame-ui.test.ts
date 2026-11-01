// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn() },
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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Tasks row deletion and focus", () => {
  it("requires the exact confirmation, supports Cancel, and deletes only after Delete", async () => {
    const { host, store } = await populated(["Pay rent"]);
    const deletes = vi.spyOn(store, "deleteTask");
    const row = host.querySelector<HTMLElement>("[data-tsk-row]");
    if (!row) throw new Error("Missing row");
    await act(() => row.focus());
    await key(row, "F10", true);
    await click(button("Delete", document.querySelector('[role="menu"]') ?? document));
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Delete 'Pay rent'?");
    expect(dialog.textContent).toContain("This can't be undone.");
    expect(deletes).not.toHaveBeenCalled();
    await click(button("Cancel", dialog));
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(1);
    expect(deletes).not.toHaveBeenCalled();
    await act(() => row.focus());
    await key(row, "F10", true);
    await click(button("Delete", document.querySelector('[role="menu"]') ?? document));
    await click(button("Delete", document.querySelector('[role="alertdialog"]') ?? document));
    await vi.waitFor(() => expect(deletes).toHaveBeenCalledOnce());
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
    expect(document.activeElement?.textContent).toContain("Last");
    await key(document.activeElement as Element, " ");
    expect(document.activeElement?.textContent).toContain("First");
    await key(document.activeElement as Element, " ");
    expect(rows()).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain("Add task");
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
  expect(host.querySelector("#upcoming")?.textContent).not.toContain("Tomorrow task");
  expect([...host.querySelectorAll("#today .tsk-due")].map((chip) => chip.textContent)).toContain(
    "Today",
  );
  await unmount();
});
