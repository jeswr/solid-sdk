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
let dismissDetails: (() => void) | undefined;
let replaceState: ReturnType<typeof vi.spyOn>;
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
  SuiteFrame: ({
    children,
    details,
    onDetailsClose,
  }: {
    children: ReactNode;
    details: ReactNode;
    onDetailsClose?: () => void;
  }) => {
    dismissDetails = onDetailsClose;
    return h("main", null, children, details);
  },
}));
vi.mock("../../src/apps/tasks/components/sidebar", () => ({ TasksSidebar: () => null }));
vi.mock("../../src/apps/tasks/components/sort-menu", () => ({ SortMenu: () => null }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));
const { offerNotificationPermission } = vi.hoisted(() => ({
  offerNotificationPermission: vi.fn(),
}));
vi.mock("../../src/apps/tasks/state/reminders", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  offerNotificationPermission,
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
async function type(input: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(() => {
    const prototype =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function input(label: string) {
  const fieldLabel = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === label,
  );
  const field =
    document.querySelector(`input[aria-label="${label}"]`) ??
    (fieldLabel && document.getElementById(fieldLabel.htmlFor));
  if (!(field instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
  return field;
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
  replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("detail edits", () => {
  it("preserves an invalid due-date draft during refresh without saving it on blur", async () => {
    const { pod, parent, store, inbox } = await setup();
    await mount(h(Detail, { url: parent.url }));
    const field = input("Due date");
    await act(() => field.focus());
    await type(field, "not a date");
    await store.updateTask(parent, (task) => {
      task.allDay = "2026-11-04";
    });
    await act(() => cache.loadTasks(inbox, true));
    expect(field.value).toBe("not a date");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const before = pod.mutations().length;
    await act(() => field.blur());
    expect(pod.mutations()).toHaveLength(before);
    expect((await store.readTask(parent.url)).task.allDay).toBe("2026-11-04");
  });
  it.each([
    "Task title",
    "Description",
    "Due date",
  ])("synchronizes an untouched focused %s after a background update without writing on blur", async (label) => {
    const { pod, parent, store, inbox } = await setup();
    const original = await store.updateTask(parent, (task) => {
      task.allDay = "2026-11-03";
    });
    await cache.loadTasks(inbox, true);
    await mount(h(Detail, { url: parent.url }));
    const field = label === "Due date" ? input(label) : textarea(label);
    await act(() => field.focus());
    const before = field.value;
    await store.updateTask(original, (task) => {
      task.title = "Remote title";
      task.description = "Remote description";
      task.allDay = "2026-11-04";
    });
    await act(() => cache.loadTasks(inbox, true));
    expect(field.value).not.toBe(before);
    const mutations = pod.mutations().length;
    await act(() => field.blur());
    expect(pod.mutations()).toHaveLength(mutations);
    const saved = (await store.readTask(parent.url)).task;
    expect(saved.title).toBe("Remote title");
    expect(saved.description).toBe("Remote description");
    expect(saved.allDay).toBe("2026-11-04");
  });
  it.each([
    "Task title",
    "Description",
    "Due date",
  ])("preserves and commits a user-edited %s across a background update", async (label) => {
    const { parent, store, inbox } = await setup();
    const original = await store.updateTask(parent, (task) => {
      task.allDay = "2026-11-03";
    });
    await cache.loadTasks(inbox, true);
    await mount(h(Detail, { url: parent.url }));
    const field = label === "Due date" ? input(label) : textarea(label);
    await act(() => field.focus());
    await type(field, label === "Due date" ? "5 November 2026" : "Local draft");
    const draft = field.value;
    await store.updateTask(original, (task) => {
      task.title = "Remote title";
      task.description = "Remote description";
      task.allDay = "2026-11-04";
    });
    await act(() => cache.loadTasks(inbox, true));
    expect(field.value).toBe(draft);
    await act(() => field.blur());
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    const saved = (await store.readTask(parent.url)).task;
    expect(saved.title).toBe(label === "Task title" ? "Local draft" : "Remote title");
    expect(saved.description).toBe(label === "Description" ? "Local draft" : "Remote description");
    expect(saved.allDay).toBe(label === "Due date" ? "2026-11-05" : "2026-11-04");
  });
  it.each([
    "tracker",
    "task",
  ])("retries the complete label creation and assignment after a rejected %s PUT", async (resource) => {
    const { pod, parent, store, inbox, failures } = await setup();
    await mount(h(Detail, { url: parent.url }));
    const field = input("New label name");
    await type(field, "Bills");
    let failed = false;
    pod.intercept = (request) => {
      if (
        !failed &&
        request.method === "PUT" &&
        request.url === (resource === "tracker" ? inbox.url : parent.url)
      ) {
        failed = true;
        return new Response(null, { status: 503 });
      }
    };
    await act(() =>
      field.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(() => vi.waitFor(() => expect(failures).toHaveBeenCalledOnce()));
    expect(field.value).toBe("Bills");
    expect(cache.getSnapshot().views.find((view) => view.url === parent.url)?.labelIds).toEqual([]);
    const retry = failures.mock.calls[0]?.[1] as () => void;
    await act(() => retry());
    await act(() => vi.waitFor(() => expect(field.value).toBe("")));
    const project = await store.readProject(inbox.url);
    expect(project.tracker.labels.map((label) => label.name)).toEqual(["Bills"]);
    const labelId = project.tracker.labels[0]?.id as string;
    expect((await store.readTask(parent.url)).task.types.has(labelId)).toBe(true);
    expect(cache.getSnapshot().views.find((view) => view.url === parent.url)?.labelIds).toEqual([
      labelId,
    ]);
    expect(failures).toHaveBeenCalledOnce();
  });
  it("retains autocomplete label assignment and colour when tracker creation is retried", async () => {
    const { pod, parent, store, target, inbox, failures } = await setup();
    await store.updateProject(target, (tracker) => {
      tracker.defineCategory("Label", "Bills", undefined, "var(--warning)");
    });
    await cache.refreshProjects();
    await mount(h(Detail, { url: parent.url }));
    let failed = false;
    pod.intercept = (request) => {
      if (!failed && request.method === "PUT" && request.url === inbox.url) {
        failed = true;
        return new Response(null, { status: 503 });
      }
    };
    const field = input("Labels");
    await act(() => field.focus());
    await key(field, "ArrowDown");
    await key(field, "Enter");
    await act(() => vi.waitFor(() => expect(failures).toHaveBeenCalledOnce()));
    const retry = failures.mock.calls[0]?.[1] as () => void;
    await act(() => retry());
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    const project = await store.readProject(inbox.url);
    expect(project.tracker.labels).toHaveLength(1);
    const label = project.tracker.labels[0];
    expect(label?.name).toBe("Bills");
    expect(label?.color).toBe("var(--warning)");
    expect((await store.readTask(parent.url)).task.types.has(label?.id as string)).toBe(true);
  });
  it("keeps a newer label-name draft when an earlier assignment succeeds", async () => {
    const { pod, parent } = await setup();
    await mount(h(Detail, { url: parent.url }));
    const field = input("New label name");
    const gate = deferred<Response | undefined>();
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === parent.url ? gate.promise : undefined;
    await type(field, "Bills");
    await act(() =>
      field.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await type(field, "Next label");
    await act(() => gate.resolve(undefined));
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    expect(field.value).toBe("Next label");
  });
  it("keeps the detail open when a Sheet captures the sub-task composer's Escape", async () => {
    await setup();
    const { host } = await mount(h(TasksApp, null, "List"));
    const trigger = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add sub-task",
    );
    if (!trigger) throw new Error("Missing Add sub-task");
    await click(trigger);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Sub-task title"]');
    if (!field) throw new Error("Missing Sub-task title");
    await act(() => field.focus());
    const captureEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissDetails?.();
    };
    document.addEventListener("keydown", captureEscape, true);
    try {
      await key(field, "Escape");
    } finally {
      document.removeEventListener("keydown", captureEscape, true);
    }
    expect(router.replace).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="Sub-task title"]')).toBeNull();
  });
  it("closes the detail by dropping only the task param from the URL", async () => {
    await setup();
    await mount(h(TasksApp, null, "List"));
    await act(() => dismissDetails?.());
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/tasks/inbox?keep=value");
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("names the breadcrumb after its visible project and section", async () => {
    await setup();
    const { host } = await mount(h(TasksApp, null, "List"));
    const breadcrumb = host.querySelector<HTMLButtonElement>(".tsk-detail-breadcrumb");
    const label = breadcrumb?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/, move task$/);
    expect(label.startsWith(breadcrumb?.textContent?.trim() ?? "missing")).toBe(true);
  });
  it("expands one sub-task row, adds on Enter, and collapses on Escape", async () => {
    const { parent, store, inbox } = await setup();
    const { host } = await mount(h(Detail, { url: parent.url }));
    const add = () =>
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Add sub-task",
      );
    expect(host.querySelector('input[aria-label="Sub-task title"]')).toBeNull();
    const trigger = add();
    if (!trigger) throw new Error("Missing Add sub-task");
    await click(trigger);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Sub-task title"]');
    if (!input) throw new Error("Missing Sub-task title");
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    expect(add()).toBeUndefined();
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Buy soil",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // jsdom does not synthesize a form's implicit Enter submission.
    await act(() =>
      input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    expect(host.textContent).toContain("0/1");
    expect(
      (await store.listTasks(inbox.tracker.stateStore as string)).find(
        (task) => task.task.title === "Buy soil",
      )?.task.parent,
    ).toBe(parent.task.id);
    await key(input, "Escape");
    expect(host.querySelector('input[aria-label="Sub-task title"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(add()));
  });
  it("keeps the all-day calendar day when disabling All day in another timezone", async () => {
    const { parent, store } = await setup();
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      await cache.updateTask(parent, (task) => {
        task.allDay = "2026-11-03";
      });
      expect((await store.readTask(parent.url)).task.dueDate?.toISOString()).toBe(
        "2026-11-02T15:00:00.000Z",
      );
      process.env.TZ = "America/Los_Angeles";
      const { host } = await mount(h(Detail, { url: parent.url }));
      const toggle = host.querySelector('[role="switch"]');
      if (!toggle) throw new Error("Missing All day switch");
      await click(toggle);
      await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
      const task = (await store.readTask(parent.url)).task;
      expect(task.allDay).toBeUndefined();
      expect(task.dueDate).toEqual(new Date("2026-11-03T00:00:00-08:00"));
    } finally {
      process.env.TZ = previous;
    }
  });
  it.each([
    "Due date",
    "Custom reminder",
  ])("refreshes the clock for a %s edit that stays focused across midnight", async (label) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    const { parent, store } = await setup();
    await cache.updateTask(parent, (task) => {
      task.dueDate = new Date("2026-11-10T17:00:00Z");
    });
    const { host } = await mount(h(Detail, { url: parent.url }));
    if (label === "Custom reminder") {
      const add = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Add reminder",
      );
      if (!add) throw new Error("Missing Add reminder");
      await click(add);
      const custom = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Custom…",
      );
      if (!custom) throw new Error("Missing Custom reminder");
      await click(custom);
    }
    const fieldLabel = [...document.querySelectorAll("label")].find(
      (element) => element.textContent === label,
    );
    const field = fieldLabel && document.getElementById(fieldLabel.htmlFor);
    if (!(field instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
    await act(() => field.focus());
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        field,
        label === "Due date" ? "tomorrow" : "tomorrow 9am",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.closest("form")?.textContent).toContain("3 November 2026");
    await act(() => field.blur());
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    const task = (await store.readTask(parent.url)).task;
    if (label === "Due date") expect(task.allDay).toBe("2026-11-03");
    else expect(task.reminders[0]?.time).toEqual(new Date(2026, 10, 3, 9));
  });
  it("offers notification permission after a reminder is saved", async () => {
    const { parent, store } = await setup();
    offerNotificationPermission.mockClear();
    await mount(h(Detail, { url: parent.url }));
    const addButton = () =>
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Add reminder",
      );
    // Without a due date there is nothing to save, so nothing is offered.
    expect(addButton()?.disabled).toBe(true);
    await act(() =>
      cache.updateTask(parent, (task) => {
        task.dueDate = new Date("2026-11-10T17:00:00Z");
      }),
    );
    const add = addButton();
    if (!add) throw new Error("Missing Add reminder");
    await click(add);
    const hourBefore = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "1 hour before",
    );
    if (!hourBefore) throw new Error("Missing 1 hour before");
    let savingAtOffer: string[] | undefined;
    offerNotificationPermission.mockImplementationOnce(() => {
      savingAtOffer = [...cache.getSnapshot().saving];
    });
    await click(hourBefore);
    await act(() => vi.waitFor(() => expect(offerNotificationPermission).toHaveBeenCalledOnce()));
    // Offered only once the write settled.
    expect(savingAtOffer).toEqual([]);
    expect((await store.readTask(parent.url)).task.reminders).toMatchObject([{ offset: "-PT1H" }]);
  });
  it("interprets a relative due-date draft at commit time after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T23:59:00Z"));
    const { parent, store } = await setup();
    await mount(h(Detail, { url: parent.url }));
    const field = input("Due date");
    await act(() => field.focus());
    await type(field, "tomorrow");
    vi.setSystemTime(new Date("2026-11-02T00:01:00Z"));
    await act(() => field.blur());
    await act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
    expect((await store.readTask(parent.url)).task.allDay).toBe("2026-11-03");
  });
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
