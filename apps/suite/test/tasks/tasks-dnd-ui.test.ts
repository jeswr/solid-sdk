// AUTHORED-BY Claude Opus 5.5

import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { act, h, mount } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
let pathname = "/tasks/inbox";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
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
      moveTaskToProject: cache.moveTaskToProject.bind(cache),
      ensureLabels: cache.ensureLabels.bind(cache),
      renameProject: cache.renameProject,
      addSection: cache.addSection,
      renameSection: cache.renameSection,
      moveSection: cache.moveSection.bind(cache),
      deleteSection: cache.deleteSection.bind(cache),
    };
  },
}));

import { toast } from "@jeswr/suite-ui";
import { BoardView } from "../../src/apps/tasks/components/board/board-view";
import { TasksDnd } from "../../src/apps/tasks/components/dnd/tasks-dnd";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";

/** jsdom has no layout: stack rows 50px apart, section headers and add rows in between. */
function layout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const order = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-tsk-row]:not(button), .tsk-card, .tsk-board-body, .tsk-section-header, div:has(> .tsk-add-row)",
      ),
    ];
    const index = order.indexOf(this);
    const top = index < 0 ? -1000 : 100 + index * 50;
    return new DOMRect(40, top, 600, 44);
  });
}
const code = (value: string) =>
  act(async () => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new KeyboardEvent("keydown", { code: value, key: value, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const liveRegion = () =>
  [...document.querySelectorAll('[aria-live="assertive"]')]
    .map((node) => node.textContent)
    .join("");
/** The drop outcome, announced once the write settles. */
const dropStatus = () => document.querySelector("[data-tsk-drop-status]")?.textContent ?? "";
const settle = () =>
  act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });

beforeEach(() => {
  pathname = "/tasks/inbox";
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("keyboard drag and drop", () => {
  it.each([
    ["priority", "body"],
    ["priority", "card"],
    ["assignee", "body"],
    ["assignee", "card"],
  ] as const)("names the destination row when keyboard dragging onto a %s lane %s", async (group, target) => {
    pathname = "/tasks/p/inbox/board";
    const result = await frameCache();
    cache = result.cache;
    const bob = "https://bob.test/profile#me";
    await cache.createTask(result.inbox, { title: "Moving", priority: "high" });
    await cache.createTask(result.inbox, {
      title: "Destination",
      priority: "medium",
      assignee: bob,
    });
    localStorage.setItem(
      "suite.tasks.prefs",
      JSON.stringify({ boardGrouping: { [encodeRef(result.inbox.url)]: group } }),
    );
    layout();
    const { host } = await mount(h(TasksDnd, null, h(BoardView, { projectUrl: result.inbox.url })));
    const handle = host.querySelector<HTMLElement>("[aria-label=\"Move 'Moving'\"]");
    if (!handle) throw new Error("Missing drag handle");
    await act(() => handle.focus());
    await code("Space");
    await code("ArrowUp");
    const origin = group === "priority" ? "P1" : "Unassigned";
    expect(liveRegion()).toBe(`'Moving' is over No section in ${origin}.`);
    // Pass the origin card to enter the next lane's empty body, then its card.
    await code("ArrowDown");
    await code("ArrowDown");
    const destination = group === "priority" ? "P2" : bob;
    expect(liveRegion()).toBe(`'Moving' is over No section in ${destination}.`);
    if (target === "card") {
      await code("ArrowDown");
      expect(liveRegion()).toBe(`'Moving' is before 'Destination' in ${destination}.`);
    }
    await code("Space");
    await settle();
    expect(dropStatus()).toBe(
      `Moved 'Moving' to No section in ${destination}, position ${target === "card" ? 1 : 2}.`,
    );
    const moved = cache.getSnapshot().views.find((task) => task.title === "Moving");
    expect(group === "priority" ? moved?.priority : moved?.assignee).toBe(
      group === "priority" ? 2 : bob,
    );
  });

  it.each([
    "priority",
    "assignee",
    "label",
  ] as const)("handles pointer drops across %s lanes, including soft WIP warnings and label rejection", async (group) => {
    pathname = "/tasks/p/inbox/board";
    const result = await frameCache();
    cache = result.cache;
    await cache.addSection(result.inbox, "Doing");
    const current = cache.getSnapshot().projects[0] as StoredProject;
    const section = current.tracker.sections[0];
    if (!section) throw new Error("Missing section");
    const bob = "https://bob.test/profile#me";
    await cache.updateProject(current, (tracker) => {
      tracker.setSectionWipLimit(section.id, 1);
      tracker.setGroupMembers([bob]);
      tracker.defineCategory("Label", "Red");
    });
    await cache.createTask(current, {
      title: "Existing",
      sectionId: section.id,
      priority: "medium",
    });
    const moved = await cache.createTask(current, { title: "Moving" });
    if (!moved) throw new Error("Missing task");
    localStorage.setItem(
      "suite.tasks.prefs",
      JSON.stringify({ boardGrouping: { [encodeRef(current.url)]: group } }),
    );
    layout();
    const { host } = await mount(h(TasksDnd, null, h(BoardView, { projectUrl: current.url })));
    const name = group === "priority" ? "P1" : group === "assignee" ? bob : "Red";
    const target = host.querySelector<HTMLElement>(
      `.tsk-swimlane[aria-label="${name}"] .tsk-board-column[aria-label="Doing"] .tsk-board-body`,
    );
    const handle = host.querySelector<HTMLElement>("[aria-label=\"Move 'Moving'\"]");
    if (!target || !handle) throw new Error("Missing drop target");
    const from = handle.closest(".tsk-card")?.getBoundingClientRect().top ?? 0;
    const to = target.getBoundingClientRect().top + 20;
    const pointer = (type: string, y: number) =>
      Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: 60, clientY: y }), {
        isPrimary: true,
        pointerType: "mouse",
      });
    result.pod.requests.length = 0;
    await act(() => handle.dispatchEvent(pointer("pointerdown", from + 20)));
    await act(() => document.dispatchEvent(pointer("pointermove", from + 10)));
    await act(() => document.dispatchEvent(pointer("pointermove", to)));
    await act(() => document.dispatchEvent(pointer("pointerup", to)));
    await settle();
    const saved = (await result.store.readTask(moved.url)).task;
    if (group === "label") {
      expect(result.pod.mutations()).toHaveLength(0);
      expect(saved.types.has(section.id)).toBe(false);
      expect(dropStatus()).toContain("Tasks cannot be moved between Label rows");
    } else {
      expect(result.pod.mutations()).toHaveLength(1);
      expect(result.pod.mutations()[0]?.headers.get("If-Match")).toBe(moved.etag);
      expect(saved.types.has(section.id)).toBe(true);
      if (group === "priority") expect(saved.priority).toBe("high");
      else expect(saved.assignee).toBe(bob);
      expect(dropStatus()).toContain("Over WIP limit");
      expect(host.querySelector("[data-over-wip] .tsk-count")?.textContent).toBe("2 / 1");
    }
  });

  it.each([
    "/tasks/p/inbox/board",
    "/tasks/p/inbox/board/",
  ])("reorders flat board cards before a child without changing parent links at %s", async (path) => {
    pathname = path;
    const result = await frameCache();
    cache = result.cache;
    const root = await cache.createTask(result.inbox, { title: "Root" });
    if (!root) throw new Error("Missing root");
    const child = await cache.createTask(result.inbox, { title: "Child", parent: root.task.id });
    const created = await cache.createTask(result.inbox, { title: "Other" });
    if (!child || !created) throw new Error("Missing cards");
    await cache.updateTask(child, (task) => {
      task.rank = 2;
    });
    const other = await cache.updateTask(created, (task) => {
      task.rank = 3;
    });
    if (!other) throw new Error("Missing ranked card");
    layout();
    const { host } = await mount(
      h(TasksDnd, null, h("main", null, h(BoardView, { projectUrl: result.inbox.url }))),
    );
    const order = () => [...host.querySelectorAll(".tsk-card-title")].map((el) => el.textContent);
    expect(order()).toEqual(["Root", "Child", "Other"]);
    result.pod.requests.length = 0;
    const handle = host.querySelector<HTMLElement>("button[aria-label=\"Move 'Other'\"]");
    const over = host.querySelector<HTMLElement>(`[data-task-url="${child.url}"]`);
    if (!handle || !over) throw new Error("Missing drag target");
    const from = handle.closest(".tsk-card")?.getBoundingClientRect().top ?? 0;
    const to = over.getBoundingClientRect().top + 5;
    const pointer = (type: string, y: number) =>
      Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: 60, clientY: y }), {
        isPrimary: true,
        pointerType: "mouse",
      });
    await act(() => handle.dispatchEvent(pointer("pointerdown", from + 20)));
    await act(() => document.dispatchEvent(pointer("pointermove", from + 10)));
    await act(() => document.dispatchEvent(pointer("pointermove", to)));
    expect(liveRegion()).toContain("'Other' is before 'Child'.");
    await act(() => document.dispatchEvent(pointer("pointerup", to)));
    await settle();
    expect((await result.store.readTask(other.url)).task.parent).toBeUndefined();
    expect((await result.store.readTask(child.url)).task.parent).toBe(root.task.id);
    expect(order()).toEqual(["Root", "Other", "Child"]);
    expect(result.pod.mutations()).toHaveLength(1);
    expect(result.pod.mutations()[0]?.headers.get("If-Match")).toBe(other.etag);
  });

  it("picks up a row by its handle, moves it into the next section and announces each phase", async () => {
    const result = await frameCache();
    cache = result.cache;
    await cache.addSection(result.inbox, "Doing");
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    const doing = inbox.tracker.sections[0]?.id as string;
    await cache.createTask(inbox, { title: "Pay rent" });
    await cache.createTask(inbox, { title: "Water plants", sectionId: doing });
    layout();
    const { host } = await mount(
      h(TasksDnd, null, h("main", null, h(ProjectView, { inbox: true }))),
    );
    const handle = host.querySelector<HTMLElement>("button[aria-label=\"Move 'Pay rent'\"]");
    if (!handle) throw new Error("Missing handle");
    expect(handle.getAttribute("aria-roledescription")).toBe("draggable");
    expect(
      document.getElementById(handle.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("press Space or Enter on its drag handle");
    await act(() => handle.focus());
    await code("Space");
    expect(liveRegion()).toContain("Picked up 'Pay rent'.");
    // Down: the No section add row, then the Doing header, then Doing's first row.
    await code("ArrowDown");
    await code("ArrowDown");
    expect(liveRegion()).toContain("'Pay rent' is over Doing.");
    await code("ArrowDown");
    expect(liveRegion()).toContain("'Pay rent' is before 'Water plants'.");
    await code("Space");
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    const moved = cache.getSnapshot().views.find((task) => task.title === "Pay rent");
    expect(moved?.sectionId).toBe(doing);
    expect(moved?.position).toBeLessThan(
      cache.getSnapshot().views.find((task) => task.title === "Water plants")?.position ?? 0,
    );
    // Dropping says "Moving…"; success is announced only once the write has settled.
    expect(liveRegion()).toContain("Moving 'Pay rent'…");
    expect(liveRegion()).not.toContain("Moved 'Pay rent'");
    expect(dropStatus()).toBe("Moved 'Pay rent' to Doing, position 1.");
    expect(toast.success).toHaveBeenCalledWith("Moved to Doing");
    expect((await result.store.readTask(moved?.url as string)).task.types.has(doing)).toBe(true);
  });

  it("announces a rolled-back drop as a failure, never as moved", async () => {
    const result = await frameCache();
    cache = result.cache;
    await cache.createTask(result.inbox, { title: "First" });
    await cache.createTask(result.inbox, { title: "Second" });
    layout();
    const { host } = await mount(
      h(TasksDnd, null, h("main", null, h(ProjectView, { inbox: true }))),
    );
    result.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 500 }) : undefined;
    await act(() =>
      host.querySelector<HTMLElement>("button[aria-label=\"Move 'First'\"]")?.focus(),
    );
    await code("Space");
    await code("ArrowDown");
    await code("Space");
    await settle();
    expect(liveRegion()).toContain("Moving 'First'…");
    expect(dropStatus()).toBe("Couldn't move 'First'.");
    expect(liveRegion()).not.toContain("Moved 'First'");
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["First", "Second"]);
    // A successful Retry replaces the failure with the outcome.
    result.pod.intercept = undefined;
    const [, retry] = result.failures.mock.calls[0] as [unknown, () => void];
    await act(async () => retry());
    await settle();
    await act(async () => {
      await vi.waitFor(() => expect(dropStatus()).toBe("Moved 'First' to No section, position 2."));
    });
  });

  it("in a sorted list, rows stand for their section: no reordering, no position", async () => {
    localStorage.setItem("suite.tasks.prefs", JSON.stringify({ sort: { "/tasks/inbox": "name" } }));
    const result = await frameCache();
    cache = result.cache;
    await cache.addSection(result.inbox, "Doing");
    const inbox = cache.getSnapshot().projects[0] as StoredProject;
    const doing = inbox.tracker.sections[0]?.id as string;
    // Manual order is Zebra, Apple; the name sort shows Apple first.
    await cache.createTask(inbox, { title: "Zebra" });
    await cache.createTask(inbox, { title: "Apple" });
    await cache.createTask(inbox, { title: "Water plants", sectionId: doing });
    layout();
    const { host } = await mount(
      h(TasksDnd, null, h("main", null, h(ProjectView, { inbox: true }))),
    );
    const rows = () => [...host.querySelectorAll<HTMLElement>("[data-tsk-row]")];
    expect(rows().map((row) => row.textContent?.match(/Apple|Zebra|Water plants/)?.[0])).toEqual([
      "Apple",
      "Zebra",
      "Water plants",
    ]);
    result.pod.requests.length = 0;
    await act(() =>
      host.querySelector<HTMLElement>("button[aria-label=\"Move 'Apple'\"]")?.focus(),
    );
    await code("Space");
    await code("ArrowDown");
    // A row of its own section is no target in a sorted list.
    expect(liveRegion()).toContain("'Apple' is over No section.");
    expect(rows()[1]?.dataset.drop).toBeUndefined();
    await code("Space");
    expect(liveRegion()).toContain("'Apple' was dropped in its original place.");
    expect(result.pod.mutations()).toEqual([]);
    // A row in another section moves the task into that section, announced without a position.
    await act(() =>
      host.querySelector<HTMLElement>("button[aria-label=\"Move 'Zebra'\"]")?.focus(),
    );
    await code("Space");
    for (let step = 0; step < 4; step++) await code("ArrowDown");
    expect(liveRegion()).toContain("'Zebra' is over Doing.");
    expect(rows().find((row) => row.textContent?.includes("Water plants"))?.dataset.drop).toBe(
      "inside",
    );
    await code("Space");
    await settle();
    expect(dropStatus()).toBe("Moved 'Zebra' to Doing.");
    expect(cache.getSnapshot().views.find((task) => task.title === "Zebra")?.sectionId).toBe(doing);
  });

  it("cancels with Escape without writing", async () => {
    const result = await frameCache();
    cache = result.cache;
    await cache.createTask(result.inbox, { title: "First" });
    await cache.createTask(result.inbox, { title: "Second" });
    layout();
    const { host } = await mount(
      h(TasksDnd, null, h("main", null, h(ProjectView, { inbox: true }))),
    );
    const handle = host.querySelector<HTMLElement>("button[aria-label=\"Move 'First'\"]");
    await act(() => handle?.focus());
    result.pod.requests.length = 0;
    await code("Space");
    await code("ArrowDown");
    expect(liveRegion()).toContain("'First' is after 'Second'.");
    await code("Escape");
    expect(liveRegion()).toContain("Cancelled moving 'First'.");
    expect(result.pod.mutations()).toEqual([]);
  });
});
