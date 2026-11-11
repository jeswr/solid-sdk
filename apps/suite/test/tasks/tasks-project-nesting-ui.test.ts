// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import { setPreferencesIdentity } from "../../src/apps/tasks/state/preferences";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let work: StoredProject;
let clients: StoredProject;
let acme: StoredProject;
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push }),
}));
vi.mock("../../src/apps/tasks/components/dnd/use-task-drag", () => ({
  useDropTarget: () => ({ ref: () => {}, over: false }),
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    inboxUrl: cache.inboxUrl,
    archiveProject: cache.archiveProject,
    deleteProject: cache.deleteProject.bind(cache),
    moveProject: cache.moveProject.bind(cache),
  }),
}));

import { ProjectBreadcrumb } from "../../src/apps/tasks/components/project-nesting";
import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";

beforeEach(async () => {
  setPreferencesIdentity(undefined);
  localStorage.clear();
  setPreferencesIdentity(webId);
  ({ cache } = await frameCache());
  const projects = await Promise.all(
    ["Work", "Clients", "Acme"].map((name) => cache.createProject(name)),
  );
  if (!projects[0] || !projects[1] || !projects[2]) throw new Error("Missing projects");
  [work, clients, acme] = [projects[0], projects[1], projects[2]];
  await cache.setProjectParent(clients, work.url);
  await cache.setProjectParent(acme, clients.url);
});
afterEach(() => act(() => setPreferencesIdentity(undefined)));

const button = (name: string, root: ParentNode = document) => {
  const item = [...root.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name,
  );
  if (!item) throw new Error(`Missing ${name}`);
  return item;
};
async function choose(name: string, action: string, root: ParentNode = document) {
  await key(button(`Project actions for ${name}`, root), "ArrowDown");
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeTruthy());
  });
  await key(button(action), "Enter");
}
const linkNames = (host: ParentNode) =>
  [...host.querySelectorAll(".tsk-projects > li > a")].map(
    (link) => link.querySelector("span")?.textContent,
  );

it("uses tabbable disclosure buttons in tree order and persists collapse across remounts", async () => {
  const first = await mount(h(TasksSidebar));
  expect(linkNames(first.host)).toEqual(["Work", "Clients", "Acme"]);
  const toggle = button("Sub-projects of Work", first.host);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.tabIndex).toBe(0);
  expect(toggle.parentElement?.nextElementSibling?.classList.contains("tsk-project-dot")).toBe(
    true,
  );
  expect(first.host.querySelector('[data-project-depth="3"] a')?.textContent).toContain("Acme");
  await click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(linkNames(first.host)).toEqual(["Work"]);
  expect(JSON.parse(localStorage.getItem("suite.tasks.prefs") ?? "{}").collapsedProjects).toContain(
    work.url,
  );
  await first.unmount();
  const second = await mount(h(TasksSidebar));
  expect(linkNames(second.host)).toEqual(["Work"]);
  await click(button("Sub-projects of Work", second.host));
  expect(linkNames(second.host)).toEqual(["Work", "Clients", "Acme"]);
});

it("keeps nested favourites visible when their parent is collapsed", async () => {
  const { host } = await mount(h(TasksSidebar));
  await choose("Acme", "Add to favourites");
  await click(button("Sub-projects of Work", host));
  expect(host.querySelector('[aria-label="Favourites"] a')?.textContent).toContain("Acme");
  expect(
    host.querySelector('[aria-label="Favourites"] [aria-label="Project actions for Acme"]'),
  ).toBeTruthy();
});

it("offers only parents that accommodate the entire subtree and moves back to top level", async () => {
  const other = await cache.createProject("Other");
  if (!other) throw new Error("Missing project");
  const { host } = await mount(h(TasksSidebar));
  await choose("Clients", "Move under…");
  const select = document.querySelector<HTMLSelectElement>('[role="dialog"] select');
  if (!select) throw new Error("Missing parent selector");
  expect([...select.options].map((option) => option.textContent)).toEqual([
    "Choose a project",
    "Work",
    "Other",
  ]);
  await act(() => {
    select.value = other.url;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button("Move"));
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });
  expect(cache.projectTree.find((node) => node.project.url === clients.url)?.parentUrl).toBe(
    other.url,
  );
  await choose("Clients", "Move to top level", host);
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });
  expect(cache.projectTree.find((node) => node.project.url === clients.url)?.depth).toBe(1);
});

it("renders the nested project breadcrumb as navigable links", async () => {
  const { host } = await mount(h(ProjectBreadcrumb, { project: acme }));
  const nav = host.querySelector('[aria-label="Project breadcrumb"]');
  if (!nav) throw new Error("Missing breadcrumb");
  expect([...nav.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
    "Work",
    "Clients",
    "Acme",
  ]);
  expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe("Acme");
  for (const link of nav.querySelectorAll("a"))
    expect(link.getAttribute("href")).toMatch(/^\/tasks\/p\//);
});

it.each([
  "Archive",
  "Delete",
])("asks about children before %s and honours promotion", async (action) => {
  await mount(h(TasksSidebar));
  await choose("Work", action);
  expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  const choices = document.querySelectorAll<HTMLInputElement>(
    '[role="alertdialog"] input[type="radio"]',
  );
  expect(choices).toHaveLength(2);
  expect(choices[0]?.checked).toBe(true);
  expect(choices[0]?.parentElement?.textContent).toBe("Move sub-projects to top level");
  expect(choices[1]?.parentElement?.textContent).toBe(`Also ${action.toLowerCase()} sub-projects`);
  await click(button(action, document.querySelector('[role="alertdialog"]') ?? document));
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });
  expect(cache.projectTree.find((node) => node.project.url === clients.url)?.depth).toBe(1);
  expect(cache.projectTree.find((node) => node.project.url === acme.url)?.depth).toBe(2);
});

it.each(["Archive", "Delete"])("honours the 'Also %s sub-projects' radio", async (action) => {
  await mount(h(TasksSidebar));
  await choose("Work", action);
  const radio = document.querySelectorAll<HTMLInputElement>(
    '[role="alertdialog"] input[type="radio"]',
  )[1];
  if (!radio) throw new Error("Missing cascade choice");
  await click(radio);
  await click(button(action, document.querySelector('[role="alertdialog"]') ?? document));
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  });
  expect(cache.projectTree).toEqual([]);
});
