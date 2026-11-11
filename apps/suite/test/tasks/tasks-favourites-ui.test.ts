// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serialize } from "../../src/apps/tasks/lib/model/rdf";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import {
  setPreferencesIdentity,
  useTasksPreferences,
} from "../../src/apps/tasks/state/preferences";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { now, type Pod, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let pod: Pod;
let dispatch: ReturnType<typeof useTasksPreferences>["dispatch"];
const dropNodes = new Map<string, HTMLElement>();
vi.mock("../../src/apps/tasks/components/dnd/use-task-drag", () => ({
  useDropTarget: (id: string) => ({
    ref: (node: HTMLElement | null) => {
      if (node) dropNodes.set(id, node);
      else dropNodes.delete(id);
    },
    over: false,
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    inboxUrl: cache.inboxUrl,
    archiveProject: cache.archiveProject,
    deleteProject: cache.deleteProject.bind(cache),
  }),
}));

import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";

function Sidebar() {
  dispatch = useTasksPreferences().dispatch;
  return h(TasksSidebar);
}
beforeEach(async () => {
  setPreferencesIdentity(undefined);
  localStorage.clear();
  setPreferencesIdentity(webId);
  ({ cache, pod } = await frameCache());
});
afterEach(() => act(() => setPreferencesIdentity(undefined)));

async function choose(root: ParentNode, label: string) {
  const trigger = root.querySelector<HTMLButtonElement>('[aria-label="Project actions for Home"]');
  if (!trigger) throw new Error("Missing project menu");
  await key(trigger, "ArrowDown");
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeTruthy());
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  );
  if (!item) throw new Error(`Missing ${label}`);
  await click(item);
}

it("toggles favourites from either copy of the row, keeps its menu and places it above Projects", async () => {
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  const { host } = await mount(h(Sidebar));
  expect(host.querySelector('[aria-label="Favourites"]')).toBeNull();
  await choose(host, "Add to favourites");
  const favourites = host.querySelector('[aria-label="Favourites"]');
  expect(favourites?.querySelector("a")?.textContent).toContain("Home");
  expect(favourites?.nextElementSibling?.textContent).toContain("Projects");
  expect(host.querySelectorAll('[aria-label="Project actions for Home"]')).toHaveLength(2);
  // Both visible copies remain registered drop targets, with distinct dnd-kit identities.
  expect([...dropNodes.keys()].filter((id) => id.includes(home.url))).toHaveLength(2);
  await choose(favourites as Element, "Remove from favourites");
  expect(host.querySelector('[aria-label="Favourites"]')).toBeNull();
  expect(host.querySelectorAll('[aria-label="Project actions for Home"]')).toHaveLength(1);
  expect([...dropNodes.keys()].filter((id) => id.includes(home.url))).toHaveLength(1);
});

it("drops archived and deleted projects automatically, without showing missing trackers", async () => {
  const home = await cache.createProject("Home");
  const work = await cache.createProject("Work");
  if (!home || !work) throw new Error("Missing project");
  const { host } = await mount(h(Sidebar));
  await act(() => {
    for (const url of [home.url, work.url, "https://missing.example/project.ttl"])
      dispatch({ type: "favouriteProject", url, value: true });
  });
  const names = () =>
    [...(host.querySelector('[aria-label="Favourites"]')?.querySelectorAll("a") ?? [])].map(
      (link) => link.querySelector("span")?.textContent,
    );
  expect(names()).toEqual(["Home", "Work"]);
  await act(() => cache.archiveProject(home));
  expect(names()).toEqual(["Work"]);
  await act(() => cache.deleteProject(work));
  expect(host.querySelector('[aria-label="Favourites"]')).toBeNull();
});

it("clears the Favourites section on account switch and sign-out", async () => {
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  const { host } = await mount(h(Sidebar));
  await choose(host, "Add to favourites");
  expect(host.querySelector('[aria-label="Favourites"]')).toBeTruthy();
  await act(() => setPreferencesIdentity("https://bob.example/profile#me"));
  expect(host.querySelector('[aria-label="Favourites"]')).toBeNull();
  await act(() => setPreferencesIdentity(webId));
  expect(host.querySelector('[aria-label="Favourites"]')).toBeTruthy();
  await act(() => setPreferencesIdentity(undefined));
  expect(host.querySelector('[aria-label="Favourites"]')).toBeNull();
});

it.each([
  404, 410,
])("drops a shared favourite after its owner deletes it (HTTP %s)", async (status) => {
  const url = "https://bob.example/projects/home.ttl";
  const shared = createTracker(url, "Home", url.replace(/\.ttl$/, "/"), [webId], now);
  const body = await serialize(shared.dataset);
  pod.seed(url, body);
  await cache.setSharedProjects([{ url, title: "Home" }]);
  const { host } = await mount(h(Sidebar));
  await act(() => {
    dispatch({ type: "sharedProject", url, title: "Home" });
    dispatch({ type: "favouriteProject", url, value: true });
  });
  const favourites = () => host.querySelector('[aria-label="Favourites"]');
  expect(favourites()?.textContent).toContain("Home");
  const project = cache.getSnapshot().projects.find((project) => project.url === url);
  if (!project) throw new Error("Missing shared project");
  // A missing task container doesn't confirm deletion of the tracker itself.
  pod.intercept = (request) =>
    request.url === shared.tracker.stateStore ? new Response(null, { status: 410 }) : undefined;
  await act(() => cache.loadTasks(project));
  expect(cache.getSnapshot().tasks[url]?.error).toMatchObject({
    status: 410,
    url: shared.tracker.stateStore,
  });
  expect(favourites()?.textContent).toContain("Home");
  // An access/server failure is not confirmation that the tracker was deleted.
  for (const transient of [403, 503]) {
    pod.intercept = (request) =>
      request.url === url ? new Response(null, { status: transient }) : undefined;
    await act(() => cache.refreshProjects());
    expect(favourites()?.textContent).toContain("Home");
  }
  pod.files.delete(url);
  pod.intercept = (request) =>
    status === 410 && request.url === url ? new Response(null, { status }) : undefined;
  await act(() => cache.refreshProjects());
  expect(cache.getSnapshot().tasks[url]?.error).toMatchObject({ status });
  expect(favourites()).toBeNull();
  // Keep the preference so a restored tracker can reappear after a successful refresh.
  pod.intercept = undefined;
  pod.seed(url, body);
  await act(() => cache.refreshProjects());
  expect(favourites()?.textContent).toContain("Home");
});
