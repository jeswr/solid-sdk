// AUTHORED-BY Codex GPT-6.1-Sol
import { PROJECT_COLOURS } from "@jeswr/suite-ui/tokens";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setPreferencesIdentity } from "../../src/apps/tasks/state/preferences";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const blue = PROJECT_COLOURS[8].hex;
const red = PROJECT_COLOURS[0].hex;
let cache: TasksCache;
let homeUrl: string;
let taskUrl: string;
vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
vi.stubGlobal("DocumentFragment", window.DocumentFragment);
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/l/bills",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    webId,
    inboxUrl: cache.inboxUrl,
    updateTask: cache.updateTask.bind(cache),
    updateProject: cache.updateProject.bind(cache),
    renameProject: cache.renameProject,
    archiveProject: cache.archiveProject,
    deleteProject: cache.deleteProject.bind(cache),
  }),
}));

import { BoardView } from "../../src/apps/tasks/components/board/board-view";
import { TaskProperties } from "../../src/apps/tasks/components/detail/fields";
import { LabelColourPicker } from "../../src/apps/tasks/components/label-colour-picker";
import { LabelFilterBar } from "../../src/apps/tasks/components/label-filter-bar";
import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";
import { setLabelColour } from "../../src/apps/tasks/state/label-colour";

beforeEach(async () => {
  setPreferencesIdentity(undefined);
  localStorage.clear();
  setPreferencesIdentity(webId);
  const fixture = await frameCache();
  cache = fixture.cache;
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing Home");
  homeUrl = home.url;
  await cache.updateProject(fixture.inbox, (tracker) =>
    tracker.defineCategory("Label", "Bills", undefined, blue),
  );
  const updated = await cache.updateProject(home, (tracker) =>
    tracker.defineCategory("Label", "bills", undefined, red),
  );
  if (!updated) throw new Error("Missing labels");
  const task = await cache.createTask(updated, {
    title: "Pay rent",
    labelIds: [updated.tracker.labels[0]?.id as string],
  });
  if (!task) throw new Error("Missing task");
  taskUrl = task.url;
});
afterEach(() => act(() => setPreferencesIdentity(undefined)));

async function settle(assertion: () => void) {
  await act(async () => vi.waitFor(assertion));
}

async function openMenu(host: ParentNode) {
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Label actions for @Bills"]');
  if (!trigger) throw new Error("Missing label menu");
  await act(() => trigger.focus());
  await key(trigger, "ArrowDown");
  await settle(() => expect(document.querySelector('[role="menu"]')).toBeTruthy());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Colour",
  );
  if (!item) throw new Error("Missing Colour");
  await key(item, "Enter");
  await settle(() => expect(document.querySelector('[role="radiogroup"]')).toBeTruthy());
  return trigger;
}

it("operates the label menu and shared swatches with the keyboard, saves all trackers and restores focus", async () => {
  await setLabelColour("bills", undefined, { cache });
  const { host } = await mount(h(TasksSidebar));
  const trigger = await openMenu(host);
  const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    ...PROJECT_COLOURS.map((colour) => colour.name),
    "No colour",
  ]);
  const neutral = radios.at(-1) as HTMLElement;
  expect(document.activeElement).toBe(neutral);
  await key(neutral, "ArrowRight");
  await settle(() => expect(radios[0]?.getAttribute("aria-checked")).toBe("true"));
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  for (const project of cache.getSnapshot().projects)
    expect((await cache.store.readProject(project.url)).tracker.labels[0]?.color).toBe(red);
  await key(radios[0] as HTMLElement, "ArrowLeft");
  await settle(() => expect(neutral.getAttribute("aria-checked")).toBe("true"));
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  for (const project of cache.getSnapshot().projects)
    expect((await cache.store.readProject(project.url)).tracker.labels[0]?.color).toBeUndefined();
  await key(neutral, "Escape");
  await settle(() => expect(document.activeElement).toBe(trigger));
  expect(document.querySelector('[role="radiogroup"]')).toBeNull();
});

function Views() {
  const state = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const project = state.projects.find((project) => project.url === homeUrl);
  const stored = state.tasks[homeUrl]?.items.find((task) => task.url === taskUrl);
  const view = state.views.find((task) => task.url === taskUrl);
  if (!project || !stored || !view) throw new Error("Missing detail");
  return h(
    "main",
    null,
    h(TasksSidebar),
    h(ProjectView, { projectUrl: homeUrl }),
    h(BoardView, { projectUrl: homeUrl }),
    h(
      "div",
      { className: "tsk-detail" },
      h(TaskProperties, { stored, project, view, onMove: vi.fn() }),
    ),
  );
}

it("renders the first project's token in rows, board cards, detail tags, sidebar and filter links; invalid values stay neutral", async () => {
  const { host } = await mount(h(Views));
  const inbox = cache.getSnapshot().projects.find((project) => project.url === cache.inboxUrl);
  if (!inbox) throw new Error("Missing Inbox");
  for (const value of [
    blue.toLowerCase(),
    undefined,
    "unknown",
    `${red.slice(0, -1)}0`,
    `${blue};background:url(https://evil.test)`,
  ]) {
    await act(() =>
      cache.updateProject(inbox, (tracker) =>
        tracker.defineCategory("Label", "Bills", undefined, value),
      ),
    );
    for (const selector of [
      ".tsk-row .tsk-label-dot",
      ".tsk-card .tsk-label-dot",
      ".tsk-detail .suite-tag .tsk-label-dot",
      ".tsk-sidebar a .tsk-label-dot",
      ".tsk-label-filter a .tsk-label-dot",
    ]) {
      const dot = host.querySelector(selector);
      expect(dot, selector).toBeTruthy();
      expect(dot?.getAttribute("style")).toBe(
        `background-color: var(--${value === blue.toLowerCase() ? "project-blue" : "foreground-muted"});`,
      );
      expect(dot?.getAttribute("aria-hidden")).toBe("true");
    }
    const chip = host.querySelector<HTMLAnchorElement>(
      '.tsk-label-filter a[href="/tasks/l/bills"]',
    );
    expect(chip?.textContent).toBe("@bills");
    expect(chip?.getAttribute("aria-current")).toBe("page");
  }
});

it.each([
  undefined,
  "unknown",
])("clears all trackers when the first has colour %s and No colour is already selected", async (colour) => {
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.updateProject(inbox, (tracker) =>
    tracker.defineCategory("Label", "Bills", undefined, colour),
  );
  const { host } = await mount(h(LabelColourPicker, { name: "Bills" }));
  const trigger = host.querySelector("button");
  if (!trigger) throw new Error("Missing Colour");
  await click(trigger);
  await settle(() => expect(document.querySelector('[role="radiogroup"]')).toBeTruthy());
  const neutral = document.querySelector<HTMLElement>('[role="radio"][aria-label="No colour"]');
  if (!neutral) throw new Error("Missing No colour");
  expect(neutral.getAttribute("aria-checked")).toBe("true");
  await click(neutral);
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  for (const project of cache.getSnapshot().projects)
    expect((await cache.store.readProject(project.url)).tracker.labels[0]?.color).toBeUndefined();
});

it("omits an empty filter bar", async () => {
  const { host } = await mount(h(LabelFilterBar, { projectUrl: "https://pod.test/missing.ttl" }));
  expect(host.querySelector("nav")).toBeNull();
});
