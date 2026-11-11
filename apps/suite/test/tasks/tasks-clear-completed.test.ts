// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { StoredProject, StoredTask } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { now, type Pod } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let pod: Pod;
let project: StoredProject;
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/completed",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
function api() {
  return {
    ...cache.getSnapshot(),
    cache,
    inboxUrl: cache.inboxUrl,
    updateTask: cache.updateTask.bind(cache),
    moveTaskToProject: cache.moveTaskToProject.bind(cache),
    ensureLabels: cache.ensureLabels.bind(cache),
  };
}
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => {
    useSyncExternalStore(cache.subscribe, cache.getSnapshot);
    return api();
  },
}));

import { toast } from "@jeswr/suite-ui";
import { DeleteCompletedButton } from "../../src/apps/tasks/components/delete-completed";
import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { CompletedView } from "../../src/apps/tasks/components/views/completed-view";
import { deleteCompletedTasks } from "../../src/apps/tasks/state/bulk-actions";

const success = vi.mocked(toast.success);
const error = vi.mocked(toast.error);

function button(text: string, root: ParentNode = document): HTMLElement {
  const element = [...root.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing ${text}`);
  return element;
}
type Notice = {
  duration?: number;
  description?: string;
  action?: { onClick: () => void };
  onAutoClose?: () => void;
  onDismiss?: () => void;
};
function notice(spy = success): Notice {
  return spy.mock.calls.at(-1)?.[1] as unknown as Notice;
}
async function create(title: string, details: Parameters<TasksCache["createTask"]>[1] = { title }) {
  const item = await cache.createTask(project, {
    state: "closed",
    endedAt: now,
    ...details,
    title,
  });
  if (!item) throw new Error("Missing task");
  return item;
}
async function settle() {
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });
}
async function confirm() {
  await click(button("Delete completed tasks"));
  await click(button("Delete", document.querySelector('[role="alertdialog"]') as Element));
}
beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  const result = await frameCache();
  ({ cache, pod } = result);
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing Home");
  project = home;
  await cache.loadTasks(project);
});

it("disables the sidebar entry with a keyboard-reachable explanation, then enables it", async () => {
  const { host, unmount } = await mount(h(TasksSidebar));
  const trigger = host.querySelector('[aria-label="Project actions for Home"]') as HTMLElement;
  await key(trigger, "ArrowDown");
  const entry = button("Delete completed tasks");
  expect(entry.getAttribute("aria-disabled")).toBe("true");
  await act(() => entry.focus());
  await vi.waitFor(() =>
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("No completed tasks"),
  );
  await key(entry, "Enter");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await key(entry, "Escape");
  await unmount();
  await create("Done");
  const next = await mount(h(TasksSidebar));
  await key(
    next.host.querySelector('[aria-label="Project actions for Home"]') as Element,
    "ArrowDown",
  );
  const enabled = button("Delete completed tasks");
  expect(enabled.getAttribute("aria-disabled")).toBe("false");
  await click(enabled);
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(dialog.textContent).toContain("Delete 1 completed tasks?");
  expect(dialog.textContent).toContain(
    "They'll be removed from Home. You can undo this for a few seconds.",
  );
  expect(button("Delete", dialog).getAttribute("data-variant")).toBe("destructive");
  await click(button("Cancel", dialog));
  expect(success).not.toHaveBeenCalled();
});

it("offers deletion in Completed only when filtered to a project, and explains an empty project", async () => {
  const { host } = await mount(h("main", null, h(CompletedView)));
  expect(host.textContent).not.toContain("Delete completed tasks");
  await click(button("Home", host));
  expect((button("Delete completed tasks", host) as HTMLButtonElement).disabled).toBe(true);
  await act(() => (button("Delete completed tasks", host).parentElement as HTMLElement).focus());
  await vi.waitFor(() =>
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("No completed tasks"),
  );
});

it("deletes completed resources beyond pagination with one Undo while retaining recurrence history", async () => {
  const parent = await create("Parent");
  const child = await create("Child", { title: "Child", parent: parent.task.id });
  const grandchild = await create("Grandchild", { title: "Grandchild", parent: child.task.id });
  const recurring = await create("Recurring", {
    title: "Recurring",
    state: "open",
    recurrence: { frequency: "DAILY" },
    due: now,
  });
  await cache.completeTask(recurring, now);
  for (let index = 0; index < 48; index++) await create(`Done ${index}`);
  const inbox = cache.getSnapshot().projects[0] as StoredProject;
  await cache.createTask(inbox, { title: "Other project", state: "closed", endedAt: now });
  const before = cache.getSnapshot().views;
  const { host } = await mount(h("main", null, h(CompletedView)));
  await click(button("Home", host));
  await confirm();
  expect(success).toHaveBeenCalledOnce();
  expect(success.mock.calls[0]?.[0]).toBe("Deleted 51 tasks");
  expect(notice().description).toBe("Kept 1 items needed by repeating tasks");
  expect(notice().duration).toBe(8000);
  expect(
    cache
      .getSnapshot()
      .views.map((task) => task.title)
      .sort(),
  ).toEqual(["Other project", "Recurring", "Recurring"]);
  expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  await act(() => notice().action?.onClick());
  expect(cache.getSnapshot().views).toEqual(before);
  expect([parent, child, grandchild].every((item) => pod.files.has(item.url))).toBe(true);
  await act(() => notice().onAutoClose?.());
  expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
});

it.each([
  412, 503,
])("summarises a %s partial failure once, restores failed rows, retries only failures, and sends If-Match", async (status) => {
  const items: StoredTask[] = [];
  for (let index = 0; index < 7; index++) items.push(await create(`Done ${index}`));
  const failed = items[2] as StoredTask;
  const remove = cache.deleteTask.bind(cache);
  let active = 0;
  let peak = 0;
  vi.spyOn(cache, "deleteTask").mockImplementation(async (item, options) => {
    peak = Math.max(peak, ++active);
    try {
      return await remove(item, options);
    } finally {
      active--;
    }
  });
  pod.intercept = (request) =>
    request.method === "DELETE" && request.url === failed.url
      ? new Response(null, { status })
      : undefined;
  await mount(h(DeleteCompletedButton, { project }));
  await confirm();
  const closing = notice();
  await act(() => {
    closing.onAutoClose?.();
    closing.onDismiss?.();
  });
  await settle();
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(peak).toBe(4);
  expect(error).toHaveBeenCalledWith(
    "Deleted 6 of 7 — 1 failed",
    expect.objectContaining({ description: "Failed: Done 2" }),
  );
  expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["Done 2"]);
  for (const item of items) {
    const requests = pod.requests.filter(
      (request) => request.method === "DELETE" && request.url === item.url,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("If-Match")).toBe(item.etag);
  }
  pod.intercept = undefined;
  pod.requests.length = 0;
  await act(() => notice(error).action?.onClick());
  await settle();
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 1 task", expect.anything()),
  );
  expect(
    pod.requests.filter((request) => request.method === "DELETE").map((request) => request.url),
  ).toEqual([failed.url]);
});

it("keeps open descendants and their completed ancestors while deleting safe completed descendants", async () => {
  const root = await create("Root");
  const parent = await create("Parent", { title: "Parent", parent: root.task.id });
  const open = await create("Open", { title: "Open", state: "open", parent: parent.task.id });
  const done = await create("Done", { title: "Done", parent: parent.task.id });
  await mount(h(DeleteCompletedButton, { project }));
  await confirm();
  expect(notice().description).toContain("Kept 1 open sub-task");
  await act(() => notice().onAutoClose?.());
  await settle();
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith(
      "Deleted 1 task",
      expect.objectContaining({ description: expect.stringContaining("Kept 1 open sub-task") }),
    ),
  );
  expect([root, parent, open].every((item) => pod.files.has(item.url))).toBe(true);
  expect(pod.files.has(done.url)).toBe(false);
  expect((await cache.store.readTask(open.url)).task.parent).toBe(parent.task.id);
  expect(deleteCompletedTasks(project, api())).toBe(0);
  expect(success).toHaveBeenLastCalledWith(
    "No completed tasks deleted",
    expect.objectContaining({ description: expect.stringContaining("Kept 1 open sub-task") }),
  );
});

it("rechecks refreshed edits before deletion so reopened tasks and new open children survive", async () => {
  const reopened = await create("Reopened");
  const parent = await create("Parent");
  await mount(h(DeleteCompletedButton, { project }));
  await confirm();
  const closing = notice();
  await act(async () => {
    await cache.store.updateTask(reopened, (task) => {
      task.state = "open";
    });
    await cache.loadTasks(project, true);
    await create("New child", { title: "New child", state: "open", parent: parent.task.id });
    closing.onAutoClose?.();
  });
  await settle();
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith(
      "Deleted 0 tasks",
      expect.objectContaining({ description: expect.stringContaining("Kept 1 open sub-task") }),
    ),
  );
  expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  expect(cache.getSnapshot().views).toHaveLength(3);
});

it.each([
  "reopened",
  "new",
])("refreshes a %s open child during Undo without a cache refresh", async (change) => {
  const parent = await create("Parent");
  const child =
    change === "reopened"
      ? await create("Child", { title: "Child", parent: parent.task.id })
      : undefined;
  deleteCompletedTasks(project, api());
  const closing = notice();
  const open = child
    ? await cache.store.updateTask(child, (task) => {
        task.state = "open";
      })
    : await cache.store.createTask(project, {
        title: "Child",
        state: "open",
        parent: parent.task.id,
      });
  await act(() => closing.onAutoClose?.());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 0 tasks", expect.anything()),
  );
  expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  expect(pod.files.has(parent.url)).toBe(true);
  expect((await cache.store.readTask(open.url)).task.parent).toBe(parent.task.id);
  expect(notice().description).toContain("Kept 1 open sub-task");
});

it.each([
  "reopen",
  "edit",
])("settles descendants first and keeps all ancestors after a child DELETE conflicts (%s)", async (change) => {
  const root = await create("Root");
  const parent = await create("Parent", { title: "Parent", parent: root.task.id });
  const child = await create("Child", { title: "Child", parent: parent.task.id });
  const sibling = await create("Sibling", { title: "Sibling", parent: root.task.id });
  deleteCompletedTasks(project, api());
  const closing = notice();
  pod.intercept = async (request) => {
    if (request.method === "DELETE" && request.url === child.url) {
      await cache.store.updateTask(child, (task) => {
        if (change === "reopen") task.state = "open";
        else task.title = "Edited elsewhere";
      });
    }
    return undefined;
  };
  await act(() => closing.onAutoClose?.());
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect([root, parent, child].every((item) => pod.files.has(item.url))).toBe(true);
  expect(pod.files.has(sibling.url)).toBe(false);
  expect(
    pod.requests.filter((request) => request.method === "DELETE").map((request) => request.url),
  ).toEqual([child.url, sibling.url]);
  expect(notice(error).description).toContain(
    change === "reopen" ? "Kept 1 open sub-task" : "Kept 2 changed tasks",
  );
});

it("deletes a completed subtree in descendant order", async () => {
  const parent = await create("Parent");
  const child = await create("Child", { title: "Child", parent: parent.task.id });
  const grandchild = await create("Grandchild", { title: "Grandchild", parent: child.task.id });
  deleteCompletedTasks(project, api());
  await act(() => notice().onAutoClose?.());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 3 tasks", expect.anything()),
  );
  expect(
    pod.requests.filter((request) => request.method === "DELETE").map((request) => request.url),
  ).toEqual([grandchild.url, child.url, parent.url]);
  expect(cache.getSnapshot().views).toEqual([]);
});

it("keeps the subtree if its refresh fails and refreshes again on Retry", async () => {
  const parent = await create("Parent");
  const child = await create("Child", { title: "Child", parent: parent.task.id });
  deleteCompletedTasks(project, api());
  pod.intercept = (request) =>
    request.method === "GET" && request.url === parent.url
      ? new Response(null, { status: 503 })
      : undefined;
  await act(() => notice().onAutoClose?.());
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  expect([parent, child].every((item) => pod.files.has(item.url))).toBe(true);
  expect(cache.getSnapshot().tasks[project.url]?.status).toBe("error");
  pod.intercept = undefined;
  await act(() => notice(error).action?.onClick());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 2 tasks", expect.anything()),
  );
  expect(cache.getSnapshot().views).toEqual([]);
});

it.each([
  "task 503",
  "task 404",
  "container",
  "tracker",
  "tracker 404",
  "tracker 410",
  "projects",
  "confirmation",
])("stops every remaining delete after incomplete reconciliation (%s), until Retry revalidates", async (failure) => {
  const failed = await create("Failed");
  const parent = await create("Parent");
  const other = cache.getSnapshot().projects[0] as StoredProject;
  const child = (await cache.createTask(other, {
    title: "Child",
    state: "closed",
    endedAt: now,
    parent: parent.task.id,
  })) as StoredTask;
  const remaining = [parent];
  for (let index = 0; index < 5; index++) remaining.push(await create(`Done ${index}`));
  deleteCompletedTasks(project, api());
  const closing = notice();
  await cache.store.updateTask(child, (task) => {
    task.state = "open";
  });
  let reconciling = false;
  let readFailed = false;
  const retainedProjects: boolean[] = [];
  const unsubscribe = cache.subscribe(() => {
    const snapshot = cache.getSnapshot();
    if (snapshot.tasks[other.url]?.error)
      retainedProjects.push(snapshot.projects.some((project) => project.url === other.url));
  });
  const failedRead =
    failure === "container"
      ? other.tracker.stateStore
      : failure.startsWith("tracker")
        ? other.url
        : failure === "projects"
          ? cache.store.projects
          : failure === "confirmation"
            ? failed.url
            : child.url;
  pod.intercept = (request) => {
    if (request.method === "DELETE" && request.url === failed.url) {
      reconciling = true;
      return new Response(null, { status: 503 });
    }
    if (reconciling && !readFailed && request.method === "GET" && request.url === failedRead) {
      readFailed = true;
      return new Response(null, {
        status: failure.endsWith("404") ? 404 : failure.endsWith("410") ? 410 : 503,
      });
    }
    return undefined;
  };
  await act(() => closing.onAutoClose?.());
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  unsubscribe();
  expect(readFailed).toBe(true);
  expect(
    pod.requests.filter((request) => request.method === "DELETE").map((request) => request.url),
  ).toEqual([failed.url]);
  if (failure.startsWith("tracker")) {
    expect(retainedProjects.length).toBeGreaterThan(0);
    expect(retainedProjects.every(Boolean)).toBe(true);
  }
  expect([failed, child, ...remaining].every((item) => pod.files.has(item.url))).toBe(true);
  const visible = new Set(cache.getSnapshot().views.map((view) => view.url));
  expect([failed, ...remaining].every((item) => visible.has(item.url))).toBe(true);
  expect(error.mock.calls[0]?.[0]).toBe("Deleted 0 of 7 — 7 failed");
  pod.intercept = undefined;
  await act(() => notice(error).action?.onClick());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 6 tasks", expect.anything()),
  );
  expect(pod.files.has(parent.url)).toBe(true);
  expect((await cache.store.readTask(child.url)).task.parent).toBe(parent.task.id);
  expect(remaining.slice(1).every((item) => !pod.files.has(item.url))).toBe(true);
});

it.each([
  "count",
  "until",
])("retains history for an open %s-bounded series through pending deletion, Undo, and reload", async (bound) => {
  const recurring = await create("Repeating", {
    title: "Repeating",
    state: "open",
    due: now,
    recurrence: {
      frequency: "DAILY",
      ...(bound === "count" ? { count: 2 } : { until: new Date("2026-10-26T12:00:00Z") }),
    },
  });
  await cache.completeTask(recurring, now);
  const history = cache.getSnapshot().views.find((view) => view.derivedFrom === recurring.task.id);
  expect(history).toBeDefined();
  await create("Done");
  expect(deleteCompletedTasks(project, api())).toBe(1);
  expect(notice().description).toContain("Kept 1 items needed by repeating tasks");
  expect(cache.getSnapshot().views.some((view) => view.url === history?.url)).toBe(true);
  const deleting = notice();
  const pending = cache
    .getSnapshot()
    .tasks[project.url]?.items.find((item) => item.url === recurring.url) as StoredTask;
  const completion = await cache.completeTask(pending, now);
  if (!completion) throw new Error("Missing completion plan");
  expect(completion.kind).toBe("close");
  expect(await cache.undoCompletion(pending, completion)).toBe(true);
  await act(() => deleting.action?.onClick());
  expect(deleteCompletedTasks(project, api())).toBe(1);
  await act(() => notice().onAutoClose?.());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 1 task", expect.anything()),
  );
  await cache.loadTasks(project, true);
  const current = cache
    .getSnapshot()
    .tasks[project.url]?.items.find((item) => item.url === recurring.url) as StoredTask;
  expect((await cache.completeTask(current, now))?.kind).toBe("close");
  expect((await cache.store.readTask(recurring.url)).task.state).toBe("closed");
  expect(deleteCompletedTasks(project, api())).toBe(1);
  expect(notice().description).toBe("Kept 1 items needed by repeating tasks");
  await act(() => notice().onAutoClose?.());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 1 task", expect.anything()),
  );
  expect(cache.getSnapshot().views.map((view) => view.url)).toEqual([history?.url]);
});

it("counts unbounded history when COUNT is added and the task completes during Undo", async () => {
  const recurring = await create("Repeating", {
    title: "Repeating",
    state: "open",
    due: now,
    recurrence: { frequency: "DAILY" },
  });
  await cache.completeTask(recurring, now);
  const history = cache.getSnapshot().views.find((view) => view.derivedFrom === recurring.task.id);
  await create("Done");
  expect(deleteCompletedTasks(project, api())).toBe(1);
  const closing = notice();
  expect(notice().description).toBe("Kept 1 items needed by repeating tasks");
  expect(cache.getSnapshot().views.some((view) => view.url === history?.url)).toBe(true);
  const current = await cache.updateTask(await cache.store.readTask(recurring.url), (task) => {
    task.recurrence = { frequency: "DAILY", count: 2 };
  });
  expect((await cache.completeTask(current as StoredTask, now))?.kind).toBe("close");
  expect((await cache.store.readTask(recurring.url)).task.state).toBe("closed");
  await act(() => closing.onAutoClose?.());
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 1 task", expect.anything()),
  );
  expect(notice().description).toContain("Kept 1 items needed by repeating tasks");
  expect(pod.files.has(history?.url as string)).toBe(true);
});

it.each([
  [false, true],
  [true, true],
  [true, false],
])("confirms a committed DELETE after response loss (failed confirmation: %s, tracker link: %s) and retries idempotently", async (failConfirmation, trackerLink) => {
  let item = await create("Done");
  if (!trackerLink)
    item = (await cache.updateTask(item, (task) => {
      task.project = undefined;
    })) as StoredTask;
  let deleted = false;
  let failedRead = false;
  pod.intercept = (request) => {
    if (request.method === "DELETE" && request.url === item.url) {
      pod.files.delete(item.url);
      deleted = true;
      throw new TypeError("Response lost");
    }
    if (
      deleted &&
      failConfirmation &&
      !failedRead &&
      request.method === "GET" &&
      request.url === item.url
    ) {
      failedRead = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  };
  deleteCompletedTasks(project, api());
  await act(() => notice().onAutoClose?.());
  if (failConfirmation) {
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(cache.getSnapshot().views).toEqual([]);
    await act(() => notice(error).action?.onClick());
  }
  await vi.waitFor(() =>
    expect(success).toHaveBeenLastCalledWith("Deleted 1 task", expect.anything()),
  );
  expect(error).toHaveBeenCalledTimes(failConfirmation ? 1 : 0);
  expect(pod.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  expect(pod.requests.find((request) => request.method === "DELETE")?.headers.get("If-Match")).toBe(
    item.etag,
  );
  expect(
    pod.requests
      .slice(pod.requests.findIndex((request) => request.method === "DELETE") + 1)
      .some((request) => request.method === "GET" && request.url === item.url),
  ).toBe(true);
});
