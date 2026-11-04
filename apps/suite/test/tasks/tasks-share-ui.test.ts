// AUTHORED-BY Codex GPT-6.1-Sol
import { type ReactNode, useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { MemorySharingAdapter } from "../../src/shell/share/memory-adapter";
import { ShareError } from "../../src/shell/share/types";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { now, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let path = "/tasks/inbox";
let ref: string | undefined;
let adapter: MemorySharingAdapter;
let sharingAvailable = true;
const bob = "https://bob.example/profile#me";
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useParams: () => ({ ref }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: { webId } }),
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({
    sidebar,
    actions,
    children,
  }: {
    sidebar: ReactNode;
    actions: ReactNode;
    children: ReactNode;
  }) => h("div", null, sidebar, h("header", null, actions), h("main", null, children)),
}));
vi.mock("../../src/apps/tasks/state/reminders", () => ({ useReminderScheduler: () => {} }));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  TasksProvider: ({ children }: { children: ReactNode }) => children,
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    webId,
    inboxUrl: cache.inboxUrl,
    shareAdapter: () => adapter,
    sharingAvailable,
    updateTask: cache.updateTask.bind(cache),
    updateProject: cache.updateProject.bind(cache),
    renameProject: cache.renameProject,
    createTask: cache.createTask.bind(cache),
    addSection: cache.addSection,
  }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { toast } from "@jeswr/suite-ui";
import { TaskDetail } from "../../src/apps/tasks/components/detail/task-detail";
import { TasksApp } from "../../src/apps/tasks/components/tasks-app";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";
import {
  setPreferencesIdentity,
  sharedProjectsKey,
  useTasksPreferences,
} from "../../src/apps/tasks/state/preferences";

const button = (text: string, root: ParentNode = document) => {
  const element = [...root.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing ${text}`);
  return element;
};
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
  localStorage.clear();
  setPreferencesIdentity(undefined);
  setPreferencesIdentity(webId);
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  sharingAvailable = true;
  ref = undefined;
  path = "/tasks/inbox";
  vi.stubGlobal("matchMedia", window.matchMedia);
  adapter = new MemorySharingAdapter(
    { people: [{ webId, role: "owner" }], general: { mode: "restricted" }, canManage: true },
    0,
  );
});
it("opens the shared shell dialog from TopBar and the sidebar project menu; uses Tasks copy and capabilities", async () => {
  const f = await frameCache();
  cache = f.cache;
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  ref = encodeRef(home.url);
  path = `/tasks/p/${ref}`;
  const { host } = await mount(h(TasksApp, null, "Project content"));
  await click(button("Share", host.querySelector("header") as HTMLElement));
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Only you"),
    );
  });
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Notify people");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Link sharing isn't available on this storage.",
  );
  const query = document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]');
  if (!query) throw new Error("Missing people picker");
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(query, bob);
    query.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key(query, "Enter");
  await click(button("Add", document.querySelector('[role="dialog"]') as HTMLElement));
  await act(async () => {
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Shared Home with 1 people"));
  });
  await click(button("Done", document.querySelector('[role="dialog"]') as HTMLElement));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Project actions for Home"]');
  if (!trigger) throw new Error("Missing menu");
  await key(trigger, "Enter");
  await click(button("Share", document.querySelector('[role="menu"]') as HTMLElement));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Share Home");
});
it("records an opened external tracker, lists Shared with me, and keeps the saved title on a 403", async () => {
  const f = await frameCache();
  cache = f.cache;
  const url = "https://bob.example/projects/home.ttl";
  const shared = createTracker(
    url,
    "Bob's Home",
    "https://bob.example/projects/home/",
    [bob, webId],
    now,
  );
  f.pod.seed(url, await serialize(shared.dataset));
  await f.pod.emptyContainer(shared.tracker.stateStore as string);
  ref = encodeRef(url);
  path = `/tasks/p/${ref}`;
  const { host } = await mount(h(TasksApp, null, h(ProjectView, { projectUrl: url })));
  await act(async () => {
    await vi.waitFor(() => expect(host.textContent).toContain("Shared with me"));
  });
  expect(host.querySelector(`nav a[href="${path}"]`)?.textContent).toContain("Bob's Home");
  expect(JSON.parse(localStorage.getItem(sharedProjectsKey(webId)) ?? "[]")).toEqual([
    { url, title: "Bob's Home" },
  ]);
  f.pod.intercept = (request) =>
    request.url === url ? new Response(null, { status: 403 }) : undefined;
  await act(() => cache.refreshProjects());
  expect(host.textContent).toContain("You no longer have access to Bob's Home");
  expect(host.textContent).toContain("Ask the owner to share this project");
  expect(host.textContent).not.toContain("Request access");
});
it("shows the assignee hint and avatar only for shared assigned tasks", async () => {
  const f = await frameCache();
  cache = f.cache;
  await cache.syncProjectMember(f.inbox, bob, true);
  const task = await cache.createTask(f.inbox, { title: "Assigned task", assignee: bob });
  if (!task) throw new Error("Missing task");
  function Details() {
    const state = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
    const project = state.projects[0];
    const item = state.tasks[f.inbox.url]?.items.find((item) => item.url === task?.url);
    return project && item ? h(TaskDetail, { stored: item, project, onClose: vi.fn() }) : null;
  }
  const { host } = await mount(h("main", null, h(ProjectView, { inbox: true }), h(Details)));
  expect(host.textContent).toContain("bob.example will see this when they open the project");
  expect(host.querySelector('[aria-label="Assigned to bob"]')).toBeTruthy();
  await act(() =>
    cache.updateTask(task, (item) => {
      item.assignee = webId;
    }),
  );
  expect(host.textContent).not.toContain("will see this when they open the project");
});

it("hides Share from TopBar and the row menu when session sharing is unavailable", async () => {
  const f = await frameCache();
  cache = f.cache;
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  ref = encodeRef(home.url);
  path = `/tasks/p/${ref}`;
  sharingAvailable = false;
  const { host } = await mount(h(TasksApp, null, "Project"));
  expect(host.querySelector("header")?.textContent).not.toContain("Share");
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Project actions for Home"]');
  if (!trigger) throw new Error("Missing row menu");
  await key(trigger, "Enter");
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Rename");
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Share");
});
it("removes a shared sidebar entry from preferences and the refresh cache", async () => {
  const f = await frameCache();
  cache = f.cache;
  const url = "https://bob.example/home.ttl";
  const shared = createTracker(url, "Bob's Home", url.replace(/\.ttl$/, "/"), [bob, webId], now);
  f.pod.seed(url, await serialize(shared.dataset));
  ref = encodeRef(url);
  path = `/tasks/p/${ref}`;
  const { host } = await mount(h(TasksApp, null, "Project"));
  await act(async () => {
    await vi.waitFor(() => expect(host.textContent).toContain("Shared with me"));
  });
  const trigger = host.querySelector<HTMLButtonElement>(
    `[aria-label="Project actions for Bob's Home"]`,
  );
  if (!trigger) throw new Error("Missing shared row menu");
  await key(trigger, "Enter");
  await click(
    button("Remove from Shared with me", document.querySelector('[role="menu"]') as HTMLElement),
  );
  expect(JSON.parse(localStorage.getItem(sharedProjectsKey(webId)) ?? "[]")).toEqual([]);
  expect(host.querySelector(`nav a[href="${path}"]`)).toBeNull();
  f.pod.requests.length = 0;
  await act(() => cache.refreshProjects());
  expect(f.pod.requests.some((request) => request.url === url)).toBe(false);
});
it.each([
  "http://bob.example/home.ttl",
  "https://bob.example/bad.ttl",
])("does not persist an unsuccessful shared link %s", async (url) => {
  const f = await frameCache();
  cache = f.cache;
  if (url.startsWith("https:")) {
    const shared = createTracker(url, "Bad", "https://bob.example/drive/", [bob], now);
    f.pod.seed(url, await serialize(shared.dataset));
  }
  ref = encodeRef(url);
  path = `/tasks/p/${ref}`;
  await mount(h(TasksApp, null, h(ProjectView, { projectUrl: url })));
  await act(() => cache.openProject(url));
  expect(JSON.parse(localStorage.getItem(sharedProjectsKey(webId)) ?? "[]")).toEqual([]);
});
it("renders malformed foreign assignee IRIs in the row, picker and detail hint", async () => {
  const f = await frameCache();
  cache = f.cache;
  const invalid = "http://a%zz/";
  const project = await f.store.updateProject(f.inbox, (tracker) =>
    tracker.setGroupMembers([webId, bob]),
  );
  const task = await f.store.createTask(project, { title: "Foreign assignment", state: "open" });
  const data = await f.pod.dataset(task.url);
  node(task.task.id, data).setIri(`${NS.WF}assignee`, invalid);
  f.pod.seed(task.url, await serialize(data));
  await cache.refreshProjects();
  await cache.loadTasks(project, true);
  const item = await f.store.readTask(task.url);
  const { host } = await mount(
    h(
      "main",
      null,
      h(ProjectView, { inbox: true }),
      h(TaskDetail, { stored: item, project, onClose: vi.fn() }),
    ),
  );
  expect(host.querySelector('[aria-label="Assigned to http://a%zz/"]')).toBeTruthy();
  expect(host.textContent).toContain("http://a%zz/ will see this when they open the project");
});
it.each([
  true,
  false,
])("restores task assignments through dialog Undo only when used (%s)", async (undo) => {
  const f = await frameCache();
  cache = f.cache;
  await cache.syncProjectMember(f.inbox, bob, true);
  const task = await cache.createTask(f.inbox, { title: "Assigned", assignee: bob });
  if (!task) throw new Error("Missing task");
  await adapter.setPerson(f.inbox.url, bob, "editor");
  const setPerson = adapter.setPerson.bind(adapter);
  vi.spyOn(adapter, "setPerson").mockImplementation(async (url, person, role, options) => {
    await setPerson(url, person, role, options);
    await cache.syncProjectMember(f.inbox, person, role !== null);
  });
  ref = encodeRef(f.inbox.url);
  path = `/tasks/p/${ref}`;
  const { host } = await mount(h(TasksApp, null, "Project"));
  await click(button("Share", host.querySelector("header") as HTMLElement));
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(bob),
    );
  });
  const row = document.querySelector(`[role="dialog"] li[aria-label="${bob}"]`);
  const select = row?.querySelector<HTMLButtonElement>('button[role="combobox"]');
  if (!select) throw new Error("Missing role select");
  await key(select, " ");
  const remove = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent === "Remove access",
  );
  if (!remove) throw new Error("Missing Remove access");
  await key(remove, "Enter");
  await act(async () => {
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(`Removed access for ${bob}`, expect.anything()),
    );
  });
  expect((await f.store.readTask(task.url)).task.assignee).toBeUndefined();
  if (undo) {
    const options = vi
      .mocked(toast)
      .mock.calls.find(([message]) => message === `Removed access for ${bob}`)?.[1];
    await act(async () => {
      options?.action &&
        typeof options.action === "object" &&
        "onClick" in options.action &&
        options.action.onClick(new MouseEvent("click") as never);
    });
    await act(async () => {
      await vi.waitFor(async () =>
        expect((await f.store.readTask(task.url)).task.assignee).toBe(bob),
      );
    });
  } else {
    await click(button("Done", document.querySelector('[role="dialog"]') as HTMLElement));
    expect((await f.store.readTask(task.url)).task.assignee).toBeUndefined();
  }
});

it("shows saved-access member-sync copy without a contradictory success toast", async () => {
  const f = await frameCache();
  cache = f.cache;
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  ref = encodeRef(home.url);
  path = `/tasks/p/${ref}`;
  const setPerson = adapter.setPerson.bind(adapter);
  vi.spyOn(adapter, "setPerson").mockImplementationOnce(async (...args) => {
    await setPerson(...args);
    throw new ShareError("members-sync");
  });
  const { host } = await mount(h(TasksApp, null, "Project"));
  await click(button("Share", host.querySelector("header") as HTMLElement));
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Only you"),
    );
  });
  const query = document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]');
  if (!query) throw new Error("Missing people picker");
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(query, bob);
    query.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key(query, "Enter");
  await click(button("Add", document.querySelector('[role="dialog"]') as HTMLElement));
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Access was saved, but the project's member list wasn't updated.",
      ),
    );
  });
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    "Can't reach your storage",
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("keeps the dialog usable with one member-sync warning across repeated opens", async () => {
  const f = await frameCache();
  cache = f.cache;
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  ref = encodeRef(home.url);
  path = `/tasks/p/${ref}`;
  const load = adapter.load.bind(adapter);
  vi.spyOn(adapter, "load").mockImplementation(async (...args) => ({
    ...(await load(...args)),
    warning: "members-sync",
  }));
  const { host } = await mount(h(TasksApp, null, "Project"));
  for (let attempt = 0; attempt < 2; attempt++) {
    await click(button("Share", host.querySelector("header") as HTMLElement));
    await act(async () => {
      await vi.waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.querySelectorAll('[role="alert"]')).toHaveLength(1);
        expect(dialog?.querySelector('[role="alert"]')?.textContent).toBe(
          new ShareError("members-sync").message,
        );
        expect(dialog?.querySelector<HTMLInputElement>('input[role="combobox"]')?.disabled).toBe(
          false,
        );
      });
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      "Can't load sharing",
    );
    await click(button("Done", document.querySelector('[role="dialog"]') as HTMLElement));
  }
  expect(toast).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("keeps Shared with me per WebID and never shows another account's list", async () => {
  const project = { url: "https://bob.example/projects/home.ttl", title: "Bob's Home" };
  localStorage.setItem(sharedProjectsKey(webId), JSON.stringify([project]));
  // A list in the browser-wide record (older builds) is never read.
  localStorage.setItem("suite.tasks.prefs", JSON.stringify({ sharedProjects: [project] }));
  let seen: ReturnType<typeof useTasksPreferences> | undefined;
  function Probe() {
    seen = useTasksPreferences();
    return null;
  }
  await mount(h(Probe));
  expect(seen?.preferences.sharedProjects).toEqual([project]);
  expect(seen?.preferences.sharedOwner).toBe(webId);
  const carol = "https://carol.example/profile#me";
  await act(() => setPreferencesIdentity(carol));
  expect(seen?.preferences.sharedProjects).toEqual([]);
  expect(seen?.preferences.sharedOwner).toBe(carol);
  const other = { url: "https://dan.example/projects/plan.ttl", title: "Plan" };
  await act(() => seen?.dispatch({ type: "sharedProject", ...other }));
  expect(JSON.parse(localStorage.getItem(sharedProjectsKey(carol)) ?? "[]")).toEqual([other]);
  expect(JSON.parse(localStorage.getItem(sharedProjectsKey(webId)) ?? "[]")).toEqual([project]);
  // Other preferences stay browser-wide and never carry a shared list.
  await act(() => seen?.dispatch({ type: "showCompleted", value: true }));
  expect(JSON.parse(localStorage.getItem("suite.tasks.prefs") ?? "{}")).not.toHaveProperty(
    "sharedProjects",
  );
  // Signed out: nothing is shown and nothing is recorded.
  await act(() => setPreferencesIdentity(undefined));
  expect(seen?.preferences.sharedProjects).toEqual([]);
  await act(() => seen?.dispatch({ type: "sharedProject", ...project }));
  expect(seen?.preferences.sharedProjects).toEqual([]);
  // Another tab changing this account's list is picked up.
  await act(() => setPreferencesIdentity(carol));
  localStorage.setItem(sharedProjectsKey(carol), "[]");
  await act(() =>
    window.dispatchEvent(new window.StorageEvent("storage", { key: sharedProjectsKey(carol) })),
  );
  expect(seen?.preferences.sharedProjects).toEqual([]);
});
