// AUTHORED-BY Codex GPT-6.1-Sol
import { type ReactNode, useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { serialize } from "../../src/apps/tasks/lib/model/rdf";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { MemorySharingAdapter } from "../../src/shell/share/memory-adapter";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { now, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let path = "/tasks/inbox";
let ref: string | undefined;
let adapter: MemorySharingAdapter;
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
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "@jeswr/suite-ui";
import { TaskDetail } from "../../src/apps/tasks/components/detail/task-detail";
import { TasksApp } from "../../src/apps/tasks/components/tasks-app";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";

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
  expect(JSON.parse(localStorage.getItem("suite.tasks.prefs") ?? "{}").sharedProjects).toEqual([
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
