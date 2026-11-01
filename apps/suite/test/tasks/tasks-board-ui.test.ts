// AUTHORED-BY Claude Opus 5.5
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/p/board",
  useRouter: () => router,
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
import { ViewToggle } from "../../src/apps/tasks/components/view-toggle";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";

const PREFS = "suite.tasks.prefs";
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function project(titles: string[], sections: string[] = []) {
  const result = await frameCache();
  cache = result.cache;
  for (const name of sections) await cache.addSection(result.inbox, name);
  const inbox = cache.getSnapshot().projects[0] as StoredProject;
  for (const title of titles) await cache.createTask(inbox, { title });
  return { ...result, inbox };
}
const viewOf = (title: string) => {
  const found = cache.getSnapshot().views.find((task) => task.title === title);
  if (!found) throw new Error(`Missing ${title}`);
  return found;
};
const status = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('.suite-sr-only[role="status"]')?.textContent;
function press(element: Element, init: KeyboardEventInit) {
  return act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}
function byText(selector: string, text: string, root: ParentNode = document) {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing ${text}`);
  return found;
}
const row = (host: HTMLElement, title: string) =>
  host.querySelector<HTMLElement>(`[data-tsk-row="${viewOf(title).url}"]`) as HTMLElement;
const settle = () =>
  act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });

describe("project board", () => {
  it("renders section columns in order with a leading No section column and priority cards", async () => {
    const { inbox } = await project(["Loose"], ["Doing", "Done"]);
    const doing = cache.getSnapshot().projects[0]?.tracker.sections[0]?.id as string;
    await cache.createTask(inbox, { title: "Urgent", sectionId: doing, priority: "high" });
    const { host } = await mount(h("main", null, h(BoardView, { projectUrl: inbox.url })));
    const columns = [
      ...host.querySelectorAll<HTMLElement>(
        ".tsk-board-column[aria-label], .tsk-board-column[aria-labelledby]",
      ),
    ];
    expect(columns.map((column) => column.getAttribute("aria-label") ?? "No section")).toEqual([
      "No section",
      "Doing",
      "Done",
    ]);
    expect(columns[0]?.querySelector(".tsk-card-title")?.textContent).toBe("Loose");
    const urgent = columns[1]?.querySelector<HTMLElement>(".tsk-card");
    expect(urgent?.textContent).toContain("Urgent");
    expect(urgent?.dataset.priority).toBe("1");
    expect(urgent?.querySelector(".tsk-drag-handle")?.getAttribute("aria-roledescription")).toBe(
      "draggable",
    );
    expect(document.title).toBe("Inbox board · Tasks · Solid Suite");
  });

  it("omits No section when every task has one and moves a card with ⋯ → Move to section…", async () => {
    const { inbox } = await project([], ["Doing", "Done"]);
    const [doing, done] = cache.getSnapshot().projects[0]?.tracker.sections ?? [];
    await cache.createTask(inbox, { title: "Pay rent", sectionId: doing?.id });
    const { host } = await mount(h("main", null, h(BoardView, { projectUrl: inbox.url })));
    expect(host.textContent).not.toContain("No section");
    const menuButton = host.querySelector<HTMLElement>(
      ".tsk-card button[aria-label=\"Actions for 'Pay rent'\"]",
    ) as HTMLElement;
    await key(menuButton, "Enter");
    const sub = byText('[role="menuitem"]', "Move to section…");
    await key(sub, "ArrowRight");
    await act(async () => {
      await vi.waitFor(() => expect(document.querySelector('[role="menuitemradio"]')).toBeTruthy());
    });
    await act(async () => byText('[role="menuitemradio"]', done?.name ?? "").click());
    await settle();
    expect(viewOf("Pay rent").sectionId).toBe(done?.id);
    expect(status(host)).toBe("Moved 'Pay rent' to Done, position 1.");
    expect(toast.success).toHaveBeenCalledWith("Moved to Done");
  });
});

describe("List | Board toggle", () => {
  it("persists the layout per project and navigates; b and Shift+L switch from the keyboard", async () => {
    const { inbox } = await project([]);
    const ref = encodeRef(inbox.url);
    const { host, render } = await mount(h(ViewToggle, { projectUrl: inbox.url, mode: "list" }));
    await act(async () => byText("button", "Board", host).click());
    expect(router.push).toHaveBeenLastCalledWith(`/tasks/p/${ref}/board`);
    expect(JSON.parse(localStorage.getItem(PREFS) ?? "{}").viewMode).toEqual({ [ref]: "board" });
    // The route renders the board.
    await render(h(ViewToggle, { projectUrl: inbox.url, mode: "board" }));
    expect(byText("button", "Board", host).getAttribute("aria-checked")).toBe("true");
    await press(document.body, { key: "L", shiftKey: true });
    expect(router.push).toHaveBeenLastCalledWith(`/tasks/p/${ref}`);
    expect(JSON.parse(localStorage.getItem(PREFS) ?? "{}").viewMode).toEqual({ [ref]: "list" });
    await render(h(ViewToggle, { projectUrl: inbox.url, mode: "list" }));
    router.push.mockClear();
    // Typing in a field never switches; the current layout is a no-op.
    const field = document.createElement("input");
    document.body.append(field);
    await press(field, { key: "b" });
    await press(document.body, { key: "L", shiftKey: true });
    expect(router.push).not.toHaveBeenCalled();
    await press(document.body, { key: "b" });
    expect(router.push).toHaveBeenLastCalledWith(`/tasks/p/${ref}/board`);
    field.remove();
  });

  it("opens a project in its persisted board layout; the Inbox stays a list", async () => {
    const { inbox } = await project(["Pay rent"]);
    const home = (await cache.createProject("Home")) as StoredProject;
    localStorage.setItem(
      PREFS,
      JSON.stringify({
        viewMode: { [encodeRef(home.url)]: "board", [encodeRef(inbox.url)]: "board" },
      }),
    );
    await mount(h("main", null, h(ProjectView, { projectUrl: home.url })));
    expect(router.replace).toHaveBeenCalledWith(`/tasks/p/${encodeRef(home.url)}/board`);
    router.replace.mockClear();
    await mount(h("main", null, h(ProjectView, { inbox: true })));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("keyboard reorder and multi-select", () => {
  it("reorders with Alt+↓ and the ⋯ Move up item, announcing the new place", async () => {
    await project(["First", "Second", "Third"]);
    const { host } = await mount(h("main", null, h(ProjectView, { inbox: true })));
    const first = row(host, "First");
    await act(() => first.focus());
    await press(first, { key: "ArrowDown", altKey: true });
    await settle();
    expect([...host.querySelectorAll(".tsk-task-title")].map((title) => title.textContent)).toEqual(
      ["Second", "First", "Third"],
    );
    expect(status(host)).toBe("Moved 'First' to No section, position 2.");
    const third = row(host, "Third");
    await act(() => third.focus());
    await key(third, "F10", true);
    await click(byText('[role="menuitem"]', "Move up"));
    await settle();
    expect([...host.querySelectorAll(".tsk-task-title")].map((title) => title.textContent)).toEqual(
      ["Second", "Third", "First"],
    );
    expect(status(host)).toBe("Moved 'Third' to No section, position 2.");
  });

  it("extends with Shift+↓, selects all with Ctrl+A and sets priority for the whole selection", async () => {
    const { store } = await project(["a", "b", "c", "d"]);
    const { host } = await mount(h("main", null, h(ProjectView, { inbox: true })));
    const a = row(host, "a");
    await act(() => a.focus());
    await key(a, " ");
    expect(host.querySelector(".tsk-bulk-count")?.textContent).toBe("1 selected");
    await press(a, { key: "ArrowDown", shiftKey: true });
    const b = row(host, "b");
    expect(document.activeElement).toBe(b);
    await press(b, { key: "ArrowDown", shiftKey: true });
    expect(host.querySelector(".tsk-bulk-count")?.textContent).toBe("3 selected");
    await press(row(host, "c"), { key: "ArrowUp", shiftKey: true });
    expect(host.querySelector(".tsk-bulk-count")?.textContent).toBe("2 selected");
    await press(b, { key: "a", ctrlKey: true });
    expect(host.querySelector(".tsk-bulk-count")?.textContent).toBe("4 selected");
    expect(
      [...host.querySelectorAll(".tsk-select")].every(
        (circle) => circle.getAttribute("aria-pressed") === "true",
      ),
    ).toBe(true);
    await click(byText('[role="toolbar"] button', "Priority", host));
    await act(async () => byText(".tsk-bulk-panel button", "P1").click());
    await settle();
    for (const title of ["a", "b", "c", "d"])
      expect((await store.readTask(viewOf(title).url)).task.priority).toBe("high");
    expect(toast.success).toHaveBeenCalledWith("Set P1 on 4 tasks", undefined);
    expect(host.querySelector(".tsk-bulk")).toBeNull();
  });

  it("confirms a multi-task delete and offers one Undo for the batch", async () => {
    await project(["a", "b", "c"]);
    const { host } = await mount(h("main", null, h(ProjectView, { inbox: true })));
    await click(row(host, "a").querySelector(".tsk-select") as Element);
    await click(row(host, "b").querySelector(".tsk-select") as Element);
    expect(host.querySelector(".tsk-bulk-count")?.textContent).toBe("2 selected");
    await click(byText('[role="toolbar"] button', "Delete", host));
    expect(byText('[role="alertdialog"] h2', "Delete 2 tasks? This can't be undone.")).toBeTruthy();
    await click(byText('[role="alertdialog"] button', "Delete"));
    expect([...host.querySelectorAll(".tsk-task-title")].map((title) => title.textContent)).toEqual(
      ["c"],
    );
    expect(toast.success).toHaveBeenCalledWith("Deleted 2 tasks", expect.anything());
    const options = vi.mocked(toast.success).mock.calls.at(-1)?.[1] as unknown as {
      action: { onClick: () => void };
    };
    await act(async () => options.action.onClick());
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(3);
  });

  it("shift-clicks a selection circle to select a range from the last toggled row", async () => {
    await project(["a", "b", "c", "d"]);
    const { host } = await mount(h("main", null, h(ProjectView, { inbox: true })));
    await click(row(host, "a").querySelector(".tsk-select") as Element);
    await act(async () => {
      row(host, "c")
        .querySelector(".tsk-select")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(host.querySelector(".tsk-bulk-count")?.textContent).toBe("3 selected");
    await click(byText('[role="toolbar"] button', "Clear", host));
    expect(host.querySelector(".tsk-bulk")).toBeNull();
  });
});
