// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  setPreferencesIdentity,
  useTasksPreferences,
} from "../../src/apps/tasks/state/preferences";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
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
  cache = (await frameCache()).cache;
});
afterEach(() => setPreferencesIdentity(undefined));

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
