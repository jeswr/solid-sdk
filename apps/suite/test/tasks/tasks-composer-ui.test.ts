// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddTaskRow } from "../../src/apps/tasks/components/add-task-row";
import { Composer, TASK_PLACEHOLDER } from "../../src/apps/tasks/components/composer/composer";
import { type StoredProject, TaskStore } from "../../src/apps/tasks/lib/model/store";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, Pod, storage, webId } from "./pod";

let cache: TasksCache;
let inbox: StoredProject;
let host: HTMLElement;
let root: Root;
let mobile = false;
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({ cache, projects: cache.getSnapshot().projects }),
}));
function query<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
function input() {
  return query<HTMLInputElement>(`input[placeholder="${TASK_PLACEHOLDER}"]`);
}
async function type(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(key: string) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}
async function clickText(text: string) {
  const scope = document.querySelector('[role="alertdialog"]') ?? document;
  const button = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  if (!button) throw new Error(`Missing button ${text}`);
  await act(async () => {
    button.click();
  });
}
async function submit(projectUrl = inbox.url, count = 1) {
  await act(async () => {
    query<HTMLFormElement>("form.tsk-composer").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(cache.getSnapshot().tasks[projectUrl]?.items.filter((item) => item.etag)).toHaveLength(
        count,
      );
    });
  });
}
async function paste(text: string) {
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    input().dispatchEvent(event);
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: mobile }));
  const pod = new Pod();
  cache = new TasksCache(
    new TaskStore({
      storage,
      webId,
      fetch: pod.fetch,
      now: () => now,
      ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
      ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
    }),
    vi.fn(),
    webId,
  );
  await cache.start();
  const first = cache.getSnapshot().projects[0];
  if (!first) throw new Error("Expected Inbox");
  inbox = first;
  await cache.loadTasks(inbox);
  host = document.createElement("main");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  mobile = false;
  vi.unstubAllGlobals();
});

describe("composer component with the real cache and model", () => {
  it("shows parsing chips and creates the project and label before the task, retaining the target", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    expect(query<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await type("Pay rent tomorrow 5pm #Home @bills p2");
    const chips = query<HTMLFieldSetElement>(".tsk-composer-chips").textContent;
    for (const label of ["Due Tomorrow 17:00", "Create project 'Home'", "@bills", "P2"])
      expect(chips).toContain(label);
    const homeUrl = `${cache.store.projects}home.ttl`;
    await submit(homeUrl);
    expect(input().value).toBe("");
    const home = cache.getSnapshot().projects.find((project) => project.url === homeUrl);
    const task = cache.getSnapshot().tasks[homeUrl]?.items[0]?.task;
    expect(home?.tracker.labels.map((label) => label.name)).toEqual(["bills"]);
    expect(task?.title).toBe("Pay rent");
    expect(task?.priority).toBe("medium");
    expect(task?.types.has(`${homeUrl}#label-bills`)).toBe(true);
    expect(cache.getSnapshot().tasks[inbox.url]?.items).toEqual([]);
    await type("Second task");
    await submit(homeUrl, 2);
    expect(cache.getSnapshot().tasks[homeUrl]?.items.map((task) => task.task.title)).toEqual([
      "Pay rent",
      "Second task",
    ]);
  });
  it("keeps removed chip text literal through edits and guards Escape with a discard dialog", async () => {
    const close = vi.fn();
    await act(async () => root.render(createElement(Composer, { project: inbox, onClose: close })));
    await type("Call tomorrow p1");
    await act(async () =>
      query<HTMLButtonElement>('button[aria-label="Remove Due Tomorrow"]').click(),
    );
    expect(input().value).toBe("Call tomorrow p1");
    await type("Call tomorrow p1 again");
    expect(document.querySelector('button[aria-label="Remove Due Tomorrow"]')).toBeNull();
    await submit();
    const task = cache.getSnapshot().tasks[inbox.url]?.items[0]?.task;
    expect(task?.title).toBe("Call tomorrow again");
    expect(task?.dueDate).toBeUndefined();
    await type("Unsaved");
    await key("Escape");
    expect(query('[role="alertdialog"]').textContent).toContain("Discard task?");
    await clickText("Cancel");
    expect(input().value).toBe("Unsaved");
    expect(close).not.toHaveBeenCalled();
    await key("Escape");
    await clickText("Discard");
    expect(close).toHaveBeenCalledOnce();
  });
  it("confirms the total paste count and persists children after their parent", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await paste("Parent tomorrow\n  Child one p1\n\tChild two @bills\nFour\nFive\nSix\nSeven");
    expect(query('[role="alertdialog"]').textContent).toContain("Add 7 tasks?");
    expect(cache.getSnapshot().tasks[inbox.url]?.items).toHaveLength(0);
    await clickText("Add tasks");
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          cache.getSnapshot().tasks[inbox.url]?.items.filter((item) => item.etag),
        ).toHaveLength(7),
      );
    });
    const tasks = cache.getSnapshot().tasks[inbox.url]?.items.map((item) => item.task) ?? [];
    const parent = tasks.find((task) => task.title === "Parent");
    expect(tasks.filter((task) => task.parent === parent?.id).map((task) => task.title)).toEqual([
      "Child one",
      "Child two",
    ]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(query<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
  });
  it("retries a partially saved paste without duplicating parents or earlier children", async () => {
    const create = cache.store.createTask.bind(cache.store);
    let failed = false;
    vi.spyOn(cache.store, "createTask").mockImplementation(async (project, details, id) => {
      if (details.title === "Child two" && !failed) {
        failed = true;
        throw new Error("Write failed");
      }
      return create(project, details, id);
    });
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await paste("Parent\n  Child one\n  Child two\nFour\nFive\nSix\nSeven");
    await clickText("Add tasks");
    await act(async () => {
      await vi.waitFor(() => expect(failed).toBe(true));
    });
    expect(document.body.textContent).toContain("Added 2 of 7 tasks.");
    await clickText("Retry remaining tasks");
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          cache.getSnapshot().tasks[inbox.url]?.items.filter((item) => item.etag),
        ).toHaveLength(7),
      );
    });
    const tasks = cache.getSnapshot().tasks[inbox.url]?.items.map((item) => item.task) ?? [];
    expect(tasks.filter((task) => task.title === "Parent")).toHaveLength(1);
    const parent = tasks.find((task) => task.title === "Parent");
    expect(tasks.filter((task) => task.parent === parent?.id)).toHaveLength(2);
  });
  it("opens a section ghost row as a mobile sheet and keeps the section after submit", async () => {
    mobile = true;
    await cache.addSection(inbox, "Doing");
    const project = cache.getSnapshot().projects[0];
    const section = project?.tracker.sections[0];
    if (!project || !section) throw new Error("Expected section");
    await act(async () =>
      root.render(createElement(AddTaskRow, { project, sectionId: section.id })),
    );
    await act(async () => {
      query("[data-tsk-add]").dispatchEvent(new Event("tasks:add"));
    });
    expect(query('[data-slot="sheet-content"]').getAttribute("role")).toBe("dialog");
    expect(query(".tsk-composer-chips").textContent).toContain("Doing");
    await type("Section task");
    await submit();
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.types.has(section.id)).toBe(true);
    expect(query(".tsk-composer-chips").textContent).toContain("Doing");
    await key("Escape");
    expect(document.querySelector("input[placeholder]")).toBeNull();
    expect(query(".tsk-ghost").textContent).toContain("Add task");
  });
});
