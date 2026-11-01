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
let pod: Pod;
let failures: ReturnType<typeof vi.fn<(error: unknown, retry: () => void) => void>>;
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  pod = new Pod();
  failures = vi.fn();
  cache = new TasksCache(
    new TaskStore({
      storage,
      webId,
      fetch: pod.fetch,
      now: () => now,
      ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
      ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
    }),
    failures,
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
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(close).not.toHaveBeenCalled();
    await key("Escape");
    await clickText("Discard");
    expect(close).toHaveBeenCalledOnce();
  });
  it("retains rejected parser input, reports validation and recovers after editing", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await type("Call tomorrow p1");
    await act(async () => query<HTMLButtonElement>('button[aria-label="Remove P1"]').click());
    await type("Call this week next Monday p1");
    expect(input().value).toBe("Call this week next Monday p1");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(query('[role="alert"]').textContent).toContain("Edit the text and try again");
    expect(query<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await type("Call today");
    expect(input().getAttribute("aria-invalid")).not.toBe("true");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await submit();
    expect(cache.getSnapshot().views[0]).toMatchObject({ title: "Call", allDay: "2026-11-01" });
  });
  it("keeps a rejected paste editable without creating a partial batch", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await paste("First\nCall this week next Monday\nLast");
    expect(input().value).toContain("Call this week next Monday");
    expect(query('[role="alert"]').textContent).toContain("Edit the text and try again");
    expect(cache.getSnapshot().views).toHaveLength(0);
    await type("Call today");
    await submit();
    expect(cache.getSnapshot().views).toHaveLength(1);
  });
  it("releases removed due tokens when their text changes", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await type("Call tomorrow");
    await act(async () =>
      query<HTMLButtonElement>('button[aria-label="Remove Due Tomorrow"]').click(),
    );
    await type("Call tomorrow again");
    expect(document.querySelector('button[aria-label="Remove Due Tomorrow"]')).toBeNull();
    await type("Call today");
    expect(query(".tsk-composer-chips").textContent).toContain("Due Today");
    await submit();
    expect(cache.getSnapshot().views[0]).toMatchObject({ title: "Call", allDay: "2026-11-01" });
  });
  it("retains property edits made while an older draft is saving", async () => {
    const create = cache.store.createTask.bind(cache.store);
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const creates = vi.spyOn(cache.store, "createTask").mockImplementationOnce(async (...args) => {
      await waiting;
      return create(...args);
    });
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await type("Call");
    await act(async () => {
      query<HTMLFormElement>("form.tsk-composer").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => expect(creates).toHaveBeenCalledOnce());
    });
    await act(async () => {
      const trigger = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Priority P4",
      );
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => {
      const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === "P2",
      );
      if (!option) throw new Error("Missing priority option");
      option.click();
    });
    await act(async () => {
      release();
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    expect(cache.getSnapshot().views[0]?.priority).toBe(4);
    expect(input().value).toBe("Call");
    expect(query(".tsk-composer-controls").textContent).toContain("Priority P2");
    await submit(inbox.url, 2);
    expect(cache.getSnapshot().views.map((task) => task.priority)).toEqual([4, 2]);
    expect(input().value).toBe("");
  });
  it("interprets new input and later drafts using the current clock", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    vi.setSystemTime(new Date("2026-11-01T10:30:00Z"));
    await type("Call in 1 hour");
    await submit();
    expect(cache.getSnapshot().views[0]?.due).toEqual(new Date("2026-11-01T11:30:00Z"));
    vi.setSystemTime(new Date("2026-11-02T00:30:00Z"));
    await type("Walk tomorrow");
    expect(query(".tsk-composer-chips").textContent).toContain("Due Tomorrow");
    await submit(inbox.url, 2);
    expect(cache.getSnapshot().views[1]?.allDay).toBe("2026-11-03");
  });
  it("uses the current day for date presets after an idle midnight", async () => {
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await type("Call");
    vi.setSystemTime(new Date("2026-11-02T00:30:00Z"));
    await clickText("Due");
    await clickText("Today");
    await submit();
    expect(cache.getSnapshot().views[0]?.allDay).toBe("2026-11-02");
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
  it.each([
    ["committed", "toast"],
    ["uncommitted", "toast"],
    ["committed", "inline"],
    ["uncommitted", "inline"],
  ])("shares %s paste recovery between %s and the other retry control", async (outcome, first) => {
    const failedUrls: string[] = [];
    const creates = vi.spyOn(cache.store, "createTask");
    pod.intercept = (request) => {
      if (request.method !== "PUT" || request.headers.get("If-None-Match") !== "*")
        return undefined;
      const title = creates.mock.calls.at(-1)?.[1].title;
      if ((title === "Child one" || title === "Child two") && !failedUrls.includes(request.url)) {
        failedUrls.push(request.url);
        if (outcome === "committed") pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
      return undefined;
    };
    await act(async () =>
      root.render(createElement(Composer, { project: inbox, onClose: vi.fn() })),
    );
    await paste("Parent\n  Child one tomorrow\n  Child two");
    expect(document.body.textContent).toContain("Added 1 of 3 tasks.");
    const toastRetry = failures.mock.calls[0]?.[1];
    if (!toastRetry) throw new Error("Missing toast retry");
    if (first === "toast") await act(async () => toastRetry());
    else await clickText("Retry remaining tasks");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Added 2 of 3 tasks."));
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    if (first === "toast") await clickText("Retry remaining tasks");
    else await act(async () => toastRetry());
    await act(async () => {
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    // Old toast actions must remain harmless even after the whole batch has completed.
    await act(async () => {
      toastRetry();
      failures.mock.calls[1]?.[1]();
    });
    const tasks = await cache.store.listTasks(inbox.tracker.stateStore as string);
    expect(tasks.map((task) => task.task.title).sort()).toEqual([
      "Child one",
      "Child two",
      "Parent",
    ]);
    const parent = tasks.find((task) => task.task.title === "Parent");
    expect(tasks.filter((task) => task.task.parent === parent?.task.id)).toHaveLength(2);
    expect(tasks.find((task) => task.task.title === "Child one")?.task.allDay).toBe("2026-11-02");
    expect(document.body.textContent).not.toContain("Retry remaining tasks");
    for (const url of failedUrls) {
      const requests = pod.requests.filter((request) => request.url === url);
      expect(requests[0]?.method).toBe("PUT");
      expect(requests[1]?.method).toBe("GET");
    }
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
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
