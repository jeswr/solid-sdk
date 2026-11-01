// AUTHORED-BY Codex GPT-6.1-Sol
import { type ReactNode, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { decodeRef, encodeRef } from "../../src/lib/refs";
import { act, click, deferred, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let route = { pathname: "/tasks/inbox", query: "" };
const routeListeners = new Set<() => void>();
const router = { replace: vi.fn(), push: vi.fn() };
function useRoute() {
  return useSyncExternalStore(
    (listener) => {
      routeListeners.add(listener);
      return () => {
        routeListeners.delete(listener);
      };
    },
    () => route,
  );
}
vi.mock("next/navigation", () => ({
  usePathname: () => useRoute().pathname,
  useSearchParams: () => new URLSearchParams(useRoute().query),
  useParams: () => ({}),
  useRouter: () => router,
}));
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: { webId } }),
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children, details }: { children: ReactNode; details: ReactNode }) =>
    h("main", null, children, details),
}));
vi.mock("../../src/apps/tasks/components/sidebar", () => ({ TasksSidebar: () => null }));
vi.mock("../../src/apps/tasks/components/sort-menu", () => ({ SortMenu: () => null }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  TasksProvider: ({ children }: { children: ReactNode }) => children,
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    webId,
    inboxUrl: cache.inboxUrl,
    createTask: cache.createTask.bind(cache),
    updateTask: cache.updateTask.bind(cache),
    updateProject: cache.updateProject.bind(cache),
    moveTaskToProject: cache.moveTaskToProject.bind(cache),
    deleteTask: cache.deleteTask.bind(cache),
  }),
}));

import { TaskDetail } from "../../src/apps/tasks/components/detail/task-detail";
import { TasksApp } from "../../src/apps/tasks/components/tasks-app";

function Detail({ url }: { url: string }) {
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const project = snapshot.projects.find((project) =>
    snapshot.tasks[project.url]?.items.some((task) => task.url === url),
  );
  const stored = project && snapshot.tasks[project.url]?.items.find((task) => task.url === url);
  return stored && project ? h(TaskDetail, { stored, project, onClose: vi.fn() }) : null;
}
function textarea(label: string) {
  const input = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing ${label}`);
  return input;
}
async function type(input: HTMLTextAreaElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function navigate(pathname: string, query = "") {
  await act(() => {
    route = { pathname, query };
    for (const listener of routeListeners) listener();
  });
}
async function moveFromDetails() {
  const project = document.querySelector('[aria-label="Project"]');
  if (!project) throw new Error("Missing project selector");
  await key(project, "Enter");
  const target = [...document.querySelectorAll('[role="option"]')].find(
    (option) => option.textContent === "Target",
  );
  if (!target) throw new Error("Missing target option");
  await click(target);
}
async function setup() {
  const result = await frameCache();
  cache = result.cache;
  const target = await result.store.createProject("Target");
  await cache.refreshProjects();
  await cache.loadTasks(target);
  const parent = await cache.createTask(result.inbox, {
    title: "Parent",
    description: "Confirmed description",
  });
  if (!parent) throw new Error("Missing parent");
  route = { pathname: "/tasks/inbox", query: `task=${encodeRef(parent.url)}&keep=value` };
  return { ...result, target, parent };
}
beforeEach(() => {
  for (const name of [
    "HTMLFormElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "DocumentFragment",
    "ShadowRoot",
    "Document",
  ] as const)
    vi.stubGlobal(name, window[name]);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  router.replace.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("detail edits", () => {
  it("saves yearly recurrence and humanises the date-only marker after a zone change", async () => {
    const { parent, store } = await setup();
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      await cache.updateTask(parent, (task) => {
        task.allDay = "2026-11-03";
      });
      process.env.TZ = "America/Los_Angeles";
      const { host } = await mount(h(Detail, { url: parent.url }));
      const repeat = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Repeat",
      );
      if (!repeat) throw new Error("Missing Repeat");
      await click(repeat);
      const frequency = document.querySelector<HTMLSelectElement>('select[id$="-frequency"]');
      if (!frequency) throw new Error("Missing frequency");
      await act(() => {
        frequency.value = "YEARLY";
        frequency.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
      expect((await store.readTask(parent.url)).task.recurrence?.frequency).toBe("YEARLY");
      expect(host.textContent).toContain("Every year on 3 Nov");
      expect(document.querySelector('[role="alert"]')).toBeNull();
    } finally {
      process.env.TZ = previous;
    }
  });
  it("completes and reopens a child that belongs to another project", async () => {
    const { parent, target, inbox, store } = await setup();
    const child = await cache.createTask(inbox, { title: "Child", parent: parent.task.id });
    if (!child) throw new Error("Missing child");
    const moved = await cache.moveTaskToProject(child, target);
    if (!moved) throw new Error("Missing moved child");
    const { host } = await mount(h(Detail, { url: parent.url }));
    expect(host.textContent).toContain("0/1");
    await click(host.querySelector("input[aria-label=\"Complete 'Child'\"]") as Element);
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    expect((await store.readTask(moved.url)).task.state).toBe("closed");
    expect(host.textContent).toContain("1/1");
    expect((await store.readTask(parent.url)).task.state).toBe("open");
    await click(host.querySelector("input[aria-label=\"Reopen 'Child'\"]") as Element);
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    expect((await store.readTask(moved.url)).task.state).toBe("open");
  });

  it.each([
    "Task title",
    "Description",
  ])("keeps a newer %s draft when an earlier save rolls back", async (label) => {
    const { pod, parent, failures, store } = await setup();
    const gate = deferred<Response>();
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === parent.url ? gate.promise : undefined;
    await mount(h(Detail, { url: parent.url }));
    const field = textarea(label);
    await act(() => field.focus());
    await type(field, "First submission");
    await act(() => field.blur());
    await act(() => field.focus());
    await type(field, "Newer draft");
    await act(() => gate.resolve(new Response(null, { status: 503 })));
    await act(() => vi.waitFor(() => expect(failures).toHaveBeenCalledOnce()));
    expect(field.value).toBe("Newer draft");
    pod.intercept = undefined;
    await act(() => field.blur());
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    const task = (await store.readTask(parent.url)).task;
    expect(label === "Task title" ? task.title : task.description).toBe("Newer draft");
  });

  it("reconciles a failed submitted title when there is no newer draft", async () => {
    const { pod, parent, failures } = await setup();
    const gate = deferred<Response>();
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === parent.url ? gate.promise : undefined;
    await mount(h(Detail, { url: parent.url }));
    const field = textarea("Task title");
    await type(field, "Failed title");
    await act(() => field.blur());
    await act(() => gate.resolve(new Response(null, { status: 503 })));
    await act(() => vi.waitFor(() => expect(failures).toHaveBeenCalledOnce()));
    expect(field.value).toBe("Parent");
  });
});

describe("persistent detail route ownership", () => {
  it.each([
    "close",
    "other-task",
    "other-route",
    "unmount",
  ])("does not reopen a delayed move after %s", async (action) => {
    const { pod, parent, target, inbox } = await setup();
    const second = (await cache.createTask(inbox, { title: "Second" })) as StoredTask;
    const gate = deferred<Response | undefined>();
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === parent.url ? gate.promise : undefined;
    const moving = vi.spyOn(cache, "moveTaskToProject");
    const mounted = await mount(h(TasksApp, null, "List"));
    await moveFromDetails();
    expect(moving).toHaveBeenCalledOnce();
    expect(moving.mock.calls[0]?.map((item) => item.url)).toEqual([parent.url, target.url]);
    if (action === "close") await navigate("/tasks/inbox", "keep=value");
    else if (action === "other-task")
      await navigate("/tasks/inbox", `task=${encodeRef(second.url)}`);
    else if (action === "other-route") await navigate("/tasks/today");
    else await mounted.unmount();
    await act(async () => {
      gate.resolve(undefined);
      await moving.mock.results[0]?.value;
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([false, true])("updates the selected URL after a move (retry: %s)", async (retrying) => {
    const { pod, parent, target, failures, inbox } = await setup();
    await mount(h(TasksApp, null, "List"));
    if (retrying)
      pod.intercept = (request) =>
        request.method === "DELETE" && request.url === parent.url
          ? new Response(null, { status: 503 })
          : undefined;
    await moveFromDetails();
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    if (retrying) {
      expect(router.replace).not.toHaveBeenCalled();
      pod.intercept = undefined;
      const retry = failures.mock.calls[0]?.[1] as () => void;
      await act(() => retry());
      await act(() => vi.waitFor(() => expect(router.replace).toHaveBeenCalledOnce()));
    }
    expect(router.replace).toHaveBeenCalledOnce();
    const href = router.replace.mock.calls[0]?.[0] as string;
    const next = new URL(href, "https://suite.example");
    const movedUrl = decodeRef(next.searchParams.get("task") as string);
    expect(next.pathname).toBe("/tasks/inbox");
    expect(next.searchParams.get("keep")).toBe("value");
    expect(cache.getSnapshot().tasks[target.url]?.items[0]?.url).toBe(movedUrl);
    expect(
      cache.getSnapshot().tasks[inbox.url]?.items.some((task) => task.url === parent.url),
    ).toBe(false);
    await navigate(next.pathname, next.search.slice(1));
    expect(textarea("Task title").value).toBe("Parent");
  });
});
