// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { toast } from "@jeswr/suite-ui";
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksImportDialog } from "../../src/apps/tasks/components/import/import-dialog";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import { parseTodoistCsv } from "../../src/apps/tasks/lib/todoist";
import { importProject } from "../../src/apps/tasks/state/import-project";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import type { Pod, RequestRecord } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let pod: Pod;
let inbox: StoredProject;
let host: HTMLElement;
let root: Root;
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({ ...useSyncExternalStore(cache.subscribe, cache.getSnapshot), cache }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
function query<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(`Missing ${text}`);
  await act(async () => button.click());
}
async function pick(csv: string, name = "Work.csv", drop = false) {
  const file = new File([csv], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  await act(async () => {
    if (drop) {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
      query('[role="dialog"]').dispatchEvent(event);
    } else {
      const input = query<HTMLInputElement>('input[type="file"]');
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}
async function finished() {
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });
}
function taskWrite(request: RequestRecord) {
  return request.method === "PUT" && /\/work\/[^/]+\.ttl$/.test(request.url);
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
  ({ cache, pod, inbox } = await frameCache());
  host = document.createElement("main");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(TasksImportDialog)));
  await click("Import…");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Todoist import dialog with the real conditional cache/store", () => {
  it("previews counts and safe warnings, edits the project name, then imports the whole forest", async () => {
    await cache.ensureLabels(inbox, ["Bills"]);
    await cache.updateProject(inbox, (tracker) =>
      tracker.defineCategory("Label", "Bills", undefined, "#D97706"),
    );
    const csv = [
      "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,DATE,TIMEZONE",
      "note,SECRET note,,,,,",
      "section,Doing,,,,,",
      "task,Parent @bills,Plain description,1,1,2026-07-01,Europe/London",
      "note,Plain note,More note,,,,",
      "task,Child @BILLS,,4,2,2026-07-01T17:00:00,Europe/London",
      "unknown,SECRET row,,,,,",
      "section,Doing,,,,,",
      "task,Later,,3,1,every third Friday,",
    ].join("\n");
    await pick(csv);
    expect(document.body.textContent).toContain("2 sections · 3 tasks · 1 sub-tasks");
    expect(query('section[aria-label="Import warnings"]').textContent).toContain(
      "A note without a task was skipped",
    );
    expect(document.body.textContent).toContain("An unrecognised row was skipped");
    expect(document.body.textContent).toContain("no due date or repeat will be set");
    expect(document.body.textContent).not.toContain("SECRET");
    const name = query<HTMLInputElement>('input:not([type="file"])');
    expect(name.value).toBe("Work");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        name,
        "Imported work",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Import 3 tasks");
    await finished();
    const project = cache
      .getSnapshot()
      .projects.find((item) => item.tracker.title === "Imported work");
    if (!project) throw new Error("Missing project");
    const sections = project.tracker.sections;
    expect(sections.map((item) => [item.name, item.position])).toEqual([
      ["Doing", 1],
      ["Doing", 6],
    ]);
    expect(sections[0]?.id).not.toBe(sections[1]?.id);
    const tasks = (await cache.store.listTasks(project.tracker.stateStore as string)).sort(
      (a, b) => (a.task.rank ?? 0) - (b.task.rank ?? 0),
    );
    expect(tasks.map((item) => [item.task.title, item.task.rank, item.task.priority])).toEqual([
      ["Parent", 2, "high"],
      ["Child", 4, undefined],
      ["Later", 7, "low"],
    ]);
    expect(tasks[0]?.task.description).toBe("Plain description\n\nPlain note\n\nMore note");
    expect(tasks[0]?.task.allDay).toBe("2026-07-01");
    expect(tasks[1]?.task.allDay).toBeUndefined();
    expect(tasks[1]?.task.dueDate).toEqual(new Date("2026-07-01T16:00:00Z"));
    expect(tasks[1]?.task.parent).toBe(tasks[0]?.task.id);
    expect(tasks[2]?.task.description).toBe("every third Friday");
    expect(tasks[2]?.task.recurrence).toBeUndefined();
    expect(tasks[0]?.task.types.has(sections[0]?.id as string)).toBe(true);
    expect(tasks[2]?.task.types.has(sections[1]?.id as string)).toBe(true);
    expect(project.tracker.labels).toHaveLength(1);
    expect(project.tracker.labels[0]).toMatchObject({ name: "Bills", color: "#D97706" });
    for (const task of tasks.slice(0, 2))
      expect(task.task.types.has(project.tracker.labels[0]?.id as string)).toBe(true);
    expect(
      cache.getSnapshot().views.filter((item) => item.projectUrl === project.url),
    ).toHaveLength(3);
    expect(toast.success).toHaveBeenCalledWith(
      "Imported 3 tasks into Imported work",
      expect.anything(),
    );
    const options = vi.mocked(toast.success).mock.calls[0]?.[1];
    expect(options?.description).toMatchObject({
      props: { href: `/tasks/p/${encodeRef(project.url)}`, children: ["Open ", "Imported work"] },
    });
    expect(push).toHaveBeenCalledWith(`/tasks/p/${encodeRef(project.url)}`);
    expect(
      pod
        .mutations()
        .every(
          (request) =>
            request.headers.has("If-Match") || request.headers.get("If-None-Match") === "*",
        ),
    ).toBe(true);
  });

  it("reports an invalid file without echoing its contents and accepts a replacement by drop", async () => {
    expect(query<HTMLInputElement>('input[type="file"]').accept).toBe(".csv,text/csv");
    await pick("TYPE,CONTENT,PRIORITY\ntask,SECRET title,8");
    expect(query('[role="alert"]').textContent).toContain("A task priority is invalid");
    expect(document.body.textContent).not.toContain("SECRET");
    expect(query<HTMLButtonElement>('button:not([disabled])[data-slot="button"]')).toBeTruthy();
    await pick("TYPE,CONTENT\ntask,<img src=x onerror=alert(1)>", "Dropped.csv", true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("0 sections · 1 tasks · 0 sub-tasks");
    expect(document.querySelector("img")).toBeNull();
    await click("Import 1 tasks");
    await finished();
    expect(cache.getSnapshot().views.find((task) => task.projectTitle === "Dropped")?.title).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("bounds writes to four, shows progress, and cancels before starting more writes", async () => {
    await pick(
      `TYPE,CONTENT\n${Array.from({ length: 12 }, (_, index) => `task,Task ${index}`).join("\n")}`,
    );
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maximum = 0;
    let started = 0;
    pod.intercept = async (request) => {
      if (!taskWrite(request)) return;
      started++;
      active++;
      maximum = Math.max(maximum, active);
      if (started > 1) await waiting;
      active--;
    };
    await click("Import 12 tasks");
    await act(async () => {
      await vi.waitFor(() => expect(started).toBe(5));
    });
    expect(document.body.textContent).toContain("Importing 1 of 12…");
    expect(maximum).toBe(4);
    await click("Cancel");
    expect(document.body.textContent).toContain("Cancelling import…");
    expect(document.body.textContent).toContain("Already-created tasks stay");
    await act(async () => release());
    await finished();
    expect(started).toBe(5);
    expect(cache.getSnapshot().views.filter((item) => item.projectTitle === "Work")).toHaveLength(
      5,
    );
    const project = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    expect(await cache.store.listTasks(project?.tracker.stateStore as string)).toHaveLength(5);
    expect(toast.info).toHaveBeenCalledWith(
      "Import cancelled. Imported 5 tasks into Work. Already-created tasks stay.",
      expect.anything(),
    );
  });

  it("keeps successes, skips a failed parent's children, and reports the failure count", async () => {
    await pick("TYPE,CONTENT,INDENT\ntask,Failed parent,1\ntask,Child,2\ntask,Success,1");
    const create = cache.store.createTask.bind(cache.store);
    vi.spyOn(cache.store, "createTask").mockImplementation(async (...args) => {
      if (args[1].title === "Failed parent") throw new Error("Write failed");
      return create(...args);
    });
    await click("Import 3 tasks");
    await finished();
    expect(cache.getSnapshot().views.map((item) => item.title)).toEqual(["Success"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported 1 tasks into Work. 2 tasks failed.",
      expect.anything(),
    );
  });

  it("counts a task whose response was lost only after checking the stored payload", async () => {
    await pick("TYPE,CONTENT\ntask,Saved");
    pod.intercept = (request) => {
      if (taskWrite(request)) {
        pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
    };
    await click("Import 1 tasks");
    await finished();
    expect(toast.success).toHaveBeenCalledWith("Imported 1 tasks into Work", expect.anything());
    expect(cache.getSnapshot().views.map((item) => item.title)).toEqual(["Saved"]);
  });

  it("resolves a timed date in the browser time zone when the file omits one", async () => {
    await pick("TYPE,CONTENT,DATE\ntask,Local time,2026-07-01T15:30:00");
    await click("Import 1 tasks");
    await finished();
    expect(cache.getSnapshot().views[0]?.due).toEqual(new Date(2026, 6, 1, 15, 30));
  });

  it("keeps the new project and reports setup failures without a background retry", async () => {
    await pick("TYPE,CONTENT\nsection,Doing\ntask,Title");
    const update = cache.store.updateProject.bind(cache.store);
    vi.spyOn(cache.store, "updateProject").mockImplementation(async (project, change) => {
      if (project.tracker.position !== undefined) throw new Error("Section write failed");
      return update(project, change);
    });
    await click("Import 1 tasks");
    await finished();
    expect(cache.getSnapshot().projects.some((item) => item.tracker.title === "Work")).toBe(true);
    expect(cache.getSnapshot().views).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported 0 tasks into Work. 1 tasks failed.",
      expect.anything(),
    );
  });

  it("cancels on unmount while preserving in-flight writes and stops project navigation", async () => {
    await pick(
      `TYPE,CONTENT\n${Array.from({ length: 9 }, (_, index) => `task,Task ${index}`).join("\n")}`,
    );
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    pod.intercept = async (request) => {
      if (taskWrite(request)) {
        started++;
        await waiting;
      }
    };
    await click("Import 9 tasks");
    await act(async () => {
      await vi.waitFor(() => expect(started).toBe(4));
    });
    await act(async () => root.render(null));
    await act(async () => {
      release();
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    });
    expect(started).toBe(4);
    expect(cache.getSnapshot().views).toHaveLength(4);
    expect(push).not.toHaveBeenCalled();
  });

  it("does not write when cancelled before setup starts", async () => {
    const job = new AbortController();
    job.abort();
    const count = pod.mutations().length;
    expect(
      await importProject(
        cache,
        parseTodoistCsv("TYPE,CONTENT\ntask,Title", { defaultTimeZone: "UTC" }),
        "Unused",
        job.signal,
        vi.fn(),
      ),
    ).toEqual({ imported: 0, failed: 0 });
    expect(pod.mutations()).toHaveLength(count);
  });
});
