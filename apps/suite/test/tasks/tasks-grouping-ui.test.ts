// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";
import { view } from "./tasks-views-fixtures";

let cache: TasksCache;
let projected: TaskView[] | undefined;
let pathname = "/tasks/inbox";
const now = new Date("2026-11-02T10:00:00Z");
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (listener) => {
          window.addEventListener("popstate", listener);
          return () => window.removeEventListener("popstate", listener);
        },
        () => window.location.search,
      ),
    ),
}));
vi.mock("../../src/apps/tasks/state/clock", () => ({ useNow: () => now }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    views: projected ?? cache.getSnapshot().views,
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
  }),
}));

import { SortMenu } from "../../src/apps/tasks/components/sort-menu";
import { CompletedView } from "../../src/apps/tasks/components/views/completed-view";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";
import { UpcomingView } from "../../src/apps/tasks/components/views/upcoming-view";

const titles = (root: ParentNode) =>
  [...root.querySelectorAll(".tsk-task-title")].map((element) => element.textContent);
const button = (text: string) => {
  const element = [
    ...document.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="menuitemradio"]'),
  ].find((el) => el.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
};
async function select(element: HTMLSelectElement, value: string) {
  await act(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    window.dispatchEvent(new Event("popstate"));
  });
}
async function type(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(new Event("popstate"));
  });
}

beforeEach(async () => {
  projected = undefined;
  localStorage.clear();
  pathname = "/tasks/inbox";
  window.history.replaceState(null, "", pathname);
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  cache = (await frameCache()).cache;
});
afterEach(() => vi.restoreAllMocks());

it("operates grouping with the keyboard, persists per view, collapses headers and blocks reorder", async () => {
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.createTask(inbox, { title: "Zulu", priority: "high", position: 1 });
  await cache.createTask(inbox, { title: "Alpha", priority: "high", position: 2 });
  await cache.createTask(inbox, { title: "Last", position: 3 });
  const app = () =>
    h("main", null, h(SortMenu, { viewId: pathname }), h(ProjectView, { inbox: true }));
  const { host, unmount } = await mount(app());
  const trigger = host.querySelector(".tsk-sort") as HTMLElement;
  await act(() => trigger.focus());
  await key(trigger, "Enter");
  const groupBy = button("Group by");
  await act(() => groupBy.focus());
  await key(groupBy, "ArrowRight");
  expect(
    [...document.querySelectorAll('[role="menuitemradio"]')].some(
      (el) => el.textContent === "Project",
    ),
  ).toBe(false);
  const priority = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    .filter((el) => el.textContent === "Priority")
    .at(-1);
  if (!priority) throw new Error("Missing grouping Priority");
  await act(() => priority.focus());
  await key(priority, "Enter");
  expect(JSON.parse(localStorage.getItem("suite.tasks.prefs") ?? "{}").groupBy).toEqual({
    [pathname]: "priority",
  });
  expect([...host.querySelectorAll("h2")].map((el) => el.textContent)).toEqual(["P1", "P4"]);
  expect(host.querySelectorAll(".tsk-drag-handle")).toHaveLength(0);
  expect(host.textContent).toContain("Manual reordering is unavailable while tasks are grouped.");
  expect(host.querySelector(".tsk-view-group .tsk-count")?.textContent).toContain("2");
  const update = vi.spyOn(cache.store, "updateTask");
  const row = host.querySelector("[data-tsk-row]") as HTMLElement;
  await act(() => {
    row.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(update).not.toHaveBeenCalled();
  await click(button("P1"));
  expect(button("P1").getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector(".tsk-view-group [hidden]")).not.toBeNull();
  await click(button("P1"));
  await key(row, "F10", true);
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].some((el) => el.textContent === "Move up"),
  ).toBe(false);
  await key(document.activeElement as Element, "Escape");
  await unmount();
  const second = await mount(app());
  expect([...second.host.querySelectorAll("h2")].map((el) => el.textContent)).toEqual(["P1", "P4"]);
  expect(titles(second.host)).toEqual(["Zulu", "Alpha", "Last"]);
});

it("offers Project in cross-project views and sorts names within grouped headers", async () => {
  pathname = "/tasks/today";
  localStorage.setItem(
    "suite.tasks.prefs",
    JSON.stringify({ groupBy: { [pathname]: "priority" }, sort: { [pathname]: "name" } }),
  );
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.createTask(inbox, { title: "Zulu", priority: "high" });
  await cache.createTask(inbox, { title: "Alpha", priority: "high" });
  const { GroupedTasks } = await import("../../src/apps/tasks/components/views/grouped-tasks");
  const { host } = await mount(
    h(
      "main",
      null,
      h(SortMenu, { viewId: pathname, crossProject: true }),
      h(GroupedTasks, { rows: cache.getSnapshot().views, children: "Ungrouped" }),
    ),
  );
  expect(titles(host)).toEqual(["Alpha", "Zulu"]);
  await key(host.querySelector(".tsk-sort") as Element, "Enter");
  await act(() => button("Group by").focus());
  await key(button("Group by"), "ArrowRight");
  expect(button("Project")).toBeDefined();
});

it("links Upcoming presets and custom bounds without losing unrelated query parameters", async () => {
  pathname = "/tasks/upcoming";
  window.history.replaceState(null, "", `${pathname}?task=keep`);
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.createTask(inbox, { title: "Near", allDay: "2026-11-03" });
  await cache.createTask(inbox, { title: "Far", allDay: "2026-11-20" });
  const { host } = await mount(h("main", null, h(UpcomingView)));
  expect(titles(host)).toEqual(["Near"]);
  const control = host.querySelector("select") as HTMLSelectElement;
  await act(() => control.focus());
  await select(control, "next30");
  expect(titles(host)).toEqual(["Near", "Far"]);
  expect(window.location.search).toBe("?task=keep&from=2026-11-02&to=2026-12-01");
  await select(control, "custom");
  const from = host.querySelectorAll<HTMLInputElement>(".suite-date-field input")[0];
  const to = host.querySelectorAll<HTMLInputElement>(".suite-date-field input")[1];
  if (!from || !to) throw new Error("Missing range inputs");
  expect(from.labels?.[0]?.textContent).toBe("From");
  expect(to.labels?.[0]?.textContent).toBe("To");
  await type(to, "4 November 2026");
  expect(titles(host)).toEqual(["Near"]);
  await type(from, "5 November 2026");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("on or before");
  expect(window.location.search).toContain("from=2026-11-02&to=2026-11-04");
  await type(to, "20 November 2026");
  expect(window.location.search).toContain("from=2026-11-05&to=2026-11-20");
  expect(titles(host)).toEqual(["Far"]);
});

it("filters Completed by completion date, resets pagination on a changed URL range, and keeps project filters", async () => {
  pathname = "/tasks/completed";
  window.history.replaceState(null, "", pathname);
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  projected = [
    ...Array.from({ length: 51 }, (_, i) =>
      view(`Recent ${i}`, { projectUrl: inbox.url, state: "closed", completedAt: now }),
    ),
    view("Older", {
      projectUrl: inbox.url,
      state: "closed",
      completedAt: new Date("2026-10-15T14:00:00Z"),
    }),
  ];
  const { host } = await mount(h("main", null, h(CompletedView)));
  expect(titles(host)).toHaveLength(50);
  await click(button("Show more"));
  expect(titles(host)).toHaveLength(51);
  await select(host.querySelector("select") as HTMLSelectElement, "last30");
  expect(titles(host)).toHaveLength(50);
  expect(host.textContent).toContain("All projects");
  await click(button("Show more"));
  expect(titles(host)).toContain("Older");
  await act(() => {
    window.history.replaceState(null, "", `${pathname}?from=2026-10-15&to=2026-10-15`);
    window.dispatchEvent(new Event("popstate"));
  });
  expect(titles(host)).toEqual(["Older"]);
  expect(host.textContent).not.toContain("Show more");
});
