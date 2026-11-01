// AUTHORED-BY Claude Opus 5.5
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, h, mount } from "../drive-ui-dom";
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
import { TasksDnd } from "../../src/apps/tasks/components/dnd/tasks-dnd";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";

/** jsdom has no layout: stack rows 50px apart, section headers and add rows in between. */
function layout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const order = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-tsk-row], .tsk-section-header, div:has(> .tsk-add-row)",
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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("keyboard drag and drop", () => {
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
    expect(liveRegion()).toContain("Moved 'Pay rent' to Doing, position 1.");
    expect(toast.success).toHaveBeenCalledWith("Moved to Doing");
    expect((await result.store.readTask(moved?.url as string)).task.types.has(doing)).toBe(true);
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
