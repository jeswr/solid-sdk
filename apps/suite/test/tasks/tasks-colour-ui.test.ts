// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setPreferencesIdentity } from "../../src/apps/tasks/state/preferences";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
let cache: TasksCache;
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    inboxUrl: cache.inboxUrl,
    renameProject: cache.renameProject,
    archiveProject: cache.archiveProject,
    deleteProject: cache.deleteProject.bind(cache),
  }),
}));

import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { TaskList } from "../../src/apps/tasks/components/task-list";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";

beforeEach(async () => {
  setPreferencesIdentity(undefined);
  localStorage.clear();
  setPreferencesIdentity(webId);
  cache = (await frameCache()).cache;
});
afterEach(() => act(() => setPreferencesIdentity(undefined)));

function menuItem(name: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === name,
  );
  if (!item) throw new Error(`Missing menu item ${name}`);
  return item;
}
async function settle(assertion: () => void) {
  await act(async () => {
    await vi.waitFor(assertion);
  });
}

async function openColour(root: ParentNode) {
  const trigger = root.querySelector<HTMLButtonElement>('[aria-label="Project actions for Home"]');
  if (!trigger) throw new Error("Missing project menu");
  await act(() => trigger.focus());
  await key(trigger, "ArrowDown");
  await settle(() => expect(document.querySelector('[role="menu"]')).toBeTruthy());
  await key(menuItem("Colour"), "Enter");
  await settle(() => expect(document.querySelector('[role="radiogroup"]')).toBeTruthy());
  return trigger;
}

it.each([
  "Tab",
  "pointer",
])("preserves outside input focus when dismissed by %s", async (method) => {
  await cache.createProject("Home");
  const { host } = await mount(
    h("main", null, h(TasksSidebar), h("input", { "aria-label": "Task title" })),
  );
  const trigger = await openColour(host);
  const input = host.querySelector<HTMLInputElement>('[aria-label="Task title"]');
  if (!input) throw new Error("Missing outside input");
  vi.useFakeTimers();
  try {
    if (method === "Tab") {
      await key(document.activeElement as HTMLElement, "Tab");
    } else {
      await act(() => input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    }
    // jsdom does not perform the browser's default Tab/pointer focus movement.
    await act(() => input.focus());
    if (method === "pointer") await click(input);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.activeElement).toBe(input);
  } finally {
    vi.useRealTimers();
  }
  // Reopening resets the dismissal reason: Escape must still restore the menu button.
  await openColour(host);
  await key(document.activeElement as HTMLElement, "Escape");
  await settle(() => expect(document.activeElement).toBe(trigger));
  expect(document.querySelector('[role="radiogroup"]')).toBeNull();
});

it("clears an unknown stored colour when the already checked No colour option is activated", async () => {
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  await cache.updateProject(home, (tracker) => {
    tracker.color = "#123456";
  });
  const { host } = await mount(h(TasksSidebar));
  await openColour(host);
  const neutral = document.querySelector<HTMLElement>('[role="radio"][aria-label="No colour"]');
  if (!neutral) throw new Error("Missing No colour");
  expect(neutral.getAttribute("aria-checked")).toBe("true");
  expect((await cache.store.readProject(home.url)).tracker.color).toBe("#123456");
  await click(neutral);
  await settle(() =>
    expect(
      cache.getSnapshot().projects.find((project) => project.url === home.url)?.tracker.color,
    ).toBeUndefined(),
  );
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect((await cache.store.readProject(home.url)).tracker.color).toBeUndefined();
});

it("opens Colour from the keyboard, names all swatches, saves with arrows and returns focus on Escape", async () => {
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  const { host } = await mount(h(TasksSidebar));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Project actions for Home"]');
  if (!trigger) throw new Error("Missing project menu");
  await act(() => trigger.focus());
  await key(trigger, "ArrowDown");
  await settle(() => expect(document.querySelector('[role="menu"]')).toBeTruthy());
  const colour = menuItem("Colour");
  await act(() => colour.focus());
  await key(colour, "Enter");
  await settle(() =>
    expect(document.querySelector('[role="radiogroup"][aria-label="Colour"]')).toBeTruthy(),
  );
  const picker = document.querySelector('[role="dialog"][aria-label="Colour"]');
  expect(picker).toBeTruthy();
  const radios = [...(picker?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
  expect(radios).toHaveLength(13);
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    "Red",
    "Orange",
    "Amber",
    "Yellow",
    "Lime",
    "Green",
    "Teal",
    "Cyan",
    "Blue",
    "Violet",
    "Purple",
    "Pink",
    "No colour",
  ]);
  const neutral = radios.at(-1) as HTMLElement;
  expect(neutral.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(neutral);
  await key(neutral, "ArrowRight");
  await settle(() => expect(radios[0]?.getAttribute("aria-checked")).toBe("true"));
  expect(document.activeElement).toBe(radios[0]);
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect((await cache.store.readProject(home.url)).tracker.color).toBe("#B91C1C");
  await key(radios[0] as HTMLElement, "ArrowLeft");
  await settle(() => expect(neutral.getAttribute("aria-checked")).toBe("true"));
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect((await cache.store.readProject(home.url)).tracker.color).toBeUndefined();
  await key(neutral, "Escape");
  await settle(() => expect(document.querySelector('[role="radiogroup"]')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("uses colour tokens on the sidebar, project header and cross-project chips; hostile pod values stay neutral", async () => {
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing project");
  await cache.createTask(home, { title: "Pay rent" });
  function Views() {
    const state = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
    return h(
      "main",
      null,
      h(TasksSidebar),
      h(ProjectView, { projectUrl: home?.url }),
      h(TaskList, {
        showProject: true,
        rows: state.views.map((task) => ({ task, depth: 0 as const })),
      }),
    );
  }
  const { host } = await mount(h(Views));
  for (const value of [
    "#1D4ED8",
    "#1D4ED8; background: url(https://evil.test)",
    "unknown",
    "#123456",
  ]) {
    await act(() =>
      cache.updateProject(home, (tracker) => {
        tracker.color = value;
      }),
    );
    const dots = [
      host.querySelector(".tsk-project-row > .tsk-project-dot"),
      host.querySelector(".tsk-view-header .tsk-project-dot"),
      host.querySelector(".tsk-project-chip .tsk-project-dot"),
    ];
    for (const dot of dots) {
      expect(dot).toBeTruthy();
      expect(dot?.getAttribute("style")).toBe(
        `background-color: var(--${value === "#1D4ED8" ? "tsk-project-blue" : "foreground-muted"});`,
      );
      expect(dot?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(host.querySelector(".tsk-project-chip")?.textContent).toBe("Home");
  }
});
