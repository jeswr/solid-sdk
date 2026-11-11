// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { toast } from "@jeswr/suite-ui";
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksImportDialog } from "../../src/apps/tasks/components/import/import-dialog";
import { parseGoogleTasksJson } from "../../src/apps/tasks/lib/google-tasks";
import { DataFactory, NS, parse, SCHED, SCHEMA } from "../../src/apps/tasks/lib/model/rdf";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import { parseTodoistCsv } from "../../src/apps/tasks/lib/todoist";
import { importProject } from "../../src/apps/tasks/state/import-project";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { type Pod, type RequestRecord, webId } from "./pod";
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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
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
async function pick(csv: string, name = "Work.csv", drop = false, type = "text/csv") {
  const file = new File([csv], name, { type });
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
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
}
async function retryable() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('input[type="file"]:disabled')).toBeNull();
  });
  expect(query('[role="alert"]').textContent).toContain("Could not finish the import.");
}
function taskWrite(request: RequestRecord) {
  return request.method === "PUT" && /\/work\/[^/]+\.ttl$/.test(request.url);
}
const takeout = JSON.stringify({
  kind: "tasks#taskLists",
  items: [
    {
      id: "work",
      title: "Work",
      items: [
        { id: "child", title: "Child", parent: "parent", status: "needsAction", position: "02" },
        {
          id: "parent",
          title: "Finished",
          status: "completed",
          hidden: true,
          position: "01",
          completed: "2026-11-01T12:34:56+01:00",
          due: "2026-07-01T00:00:00Z",
          notes: "SECRET notes",
          links: [{ description: "Receipt", link: "https://mail.example/receipt" }],
        },
        { id: "deleted", deleted: true },
      ],
    },
    {
      id: "personal",
      title: "Personal",
      items: [{ id: "other", title: "SECRET other task", status: "needsAction", position: "01" }],
    },
  ],
});
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
  it("warns safely about metadata and round-trips it through the project and task models", async () => {
    await pick(
      [
        "TYPE,CONTENT,DESCRIPTION,AUTHOR,RESPONSIBLE,DURATION,DURATION_UNIT,DATE_LANG",
        "section,Doing,SECRET section details,,,,,",
        "task,Names,Body,SECRET Alice,SECRET Bob,45,minute,en",
        "note,Comment,More,SECRET Carol,,,,",
        "task,WebIDs,,https://alice.test/#me,https://bob.test/#me,1,day,",
        "section,Empty,SECRET empty section,,,,,",
      ].join("\n"),
    );
    const warnings = query('section[aria-label="Import warnings"]').textContent;
    expect(warnings).toContain("author could not be matched to an account");
    expect(warnings).toContain("responsible person could not be matched to an account");
    expect(warnings).toContain("Durations will be kept as labelled text");
    expect(warnings).toContain("Note authors will be kept as labelled text");
    expect(warnings).toContain("Section descriptions will be kept as labelled text");
    expect(warnings).toContain("Date language will be kept as labelled text");
    expect(document.body.textContent).not.toContain("SECRET");
    await click("Import 2 tasks");
    await finished();
    const created = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    if (!created) throw new Error("Missing project");
    const project = await cache.store.readProject(created.url);
    expect(project.tracker.description).toBe(
      'Section "Doing" description: SECRET section details\n\nSection "Empty" description: SECRET empty section',
    );
    const tasks = await cache.store.listTasks(project.tracker.stateStore as string);
    const names = tasks.find((item) => item.task.title === "Names")?.task;
    expect(names?.description).toBe(
      "Body\n\nAuthor: SECRET Alice\n\nResponsible: SECRET Bob\n\nDuration: 45 minutes\n\nDate language: en\n\nComment\n\nMore\n\nNote author: SECRET Carol",
    );
    expect(names?.creator).toBe(webId);
    expect(names?.assignee).toBeUndefined();
    const identities = tasks.find((item) => item.task.title === "WebIDs")?.task;
    expect(identities?.creator).toBe("https://alice.test/#me");
    expect(identities?.assignee).toBe("https://bob.test/#me");
    expect(identities?.description).toBe("Duration: 1 day");
  });

  it("previews counts and safe warnings, edits the project name, then imports the whole forest", async () => {
    await cache.ensureLabels(inbox, ["Bills"]);
    await cache.updateProject(inbox, (tracker) =>
      tracker.defineCategory("Label", "Bills", undefined, "var(--warning)"),
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
    expect(tasks[2]?.task.description).toBe("Original date: every third Friday");
    expect(tasks[2]?.task.recurrence).toBeUndefined();
    expect(tasks[0]?.task.types.has(sections[0]?.id as string)).toBe(true);
    expect(tasks[2]?.task.types.has(sections[1]?.id as string)).toBe(true);
    expect(project.tracker.labels).toHaveLength(1);
    expect(project.tracker.labels[0]).toMatchObject({ name: "Bills", color: "var(--warning)" });
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
    expect(query<HTMLInputElement>('input[type="file"]').accept).toBe(
      ".csv,text/csv,.json,application/json",
    );
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
    const writes = vi.spyOn(cache.store, "createTask").mockImplementation(async (...args) => {
      if (args[1].title === "Failed parent") throw new Error("Write failed");
      return create(...args);
    });
    await click("Import 3 tasks");
    await retryable();
    expect(cache.getSnapshot().views.map((item) => item.title)).toEqual(["Success"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported 1 tasks into Work. 2 tasks failed.",
      expect.anything(),
    );
    const project = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    const success = cache.getSnapshot().views[0];
    writes.mockImplementation(create);
    await click("Import 3 tasks");
    await finished();
    expect(cache.getSnapshot().projects.filter((item) => item.url !== inbox.url)).toEqual([
      project,
    ]);
    const tasks = await cache.store.listTasks(project?.tracker.stateStore as string);
    expect(tasks).toHaveLength(3);
    expect(tasks.find((item) => item.task.title === "Success")?.url).toBe(success?.url);
    const parent = tasks.find((item) => item.task.title === "Failed parent");
    expect(tasks.find((item) => item.task.title === "Child")?.task.parent).toBe(parent?.task.id);
    const successWrites = writes.mock.calls.filter(([, data]) => data.title === "Success");
    expect(successWrites).toHaveLength(2);
    expect(successWrites[1]?.[2]).toBe(successWrites[0]?.[2]);
    expect(toast.success).toHaveBeenCalledWith("Imported 3 tasks into Work", expect.anything());
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

  it("retries section setup in the existing project without a background retry", async () => {
    await pick("TYPE,CONTENT\nsection,Doing\ntask,Title");
    const update = cache.store.updateProject.bind(cache.store);
    const updates = vi
      .spyOn(cache.store, "updateProject")
      .mockImplementation(async (project, change) => {
        if (project.tracker.position !== undefined) throw new Error("Section write failed");
        return update(project, change);
      });
    await click("Import 1 tasks");
    await retryable();
    expect(cache.getSnapshot().projects.some((item) => item.tracker.title === "Work")).toBe(true);
    expect(cache.getSnapshot().views).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported 0 tasks into Work. 1 tasks failed.",
      expect.anything(),
    );
    const project = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    const creates = pod
      .mutations()
      .filter((request) => request.headers.get("If-None-Match") === "*");
    updates.mockImplementation(update);
    await click("Import 1 tasks");
    await finished();
    expect(
      cache
        .getSnapshot()
        .projects.filter((item) => item.url !== inbox.url)
        .map((item) => item.url),
    ).toEqual([project?.url]);
    expect(
      pod.mutations().filter((request) => request.headers.get("If-None-Match") === "*"),
    ).toHaveLength(creates.length + 1);
    const saved = await cache.store.readProject(project?.url as string);
    expect(saved.tracker.sections.map((section) => section.name)).toEqual(["Doing"]);
    expect(await cache.store.listTasks(saved.tracker.stateStore as string)).toHaveLength(1);
  });

  it("continues importing into the created project when its position write returns 503", async () => {
    await pick("TYPE,CONTENT\ntask,Title");
    let rejected = 0;
    pod.intercept = async (request) => {
      if (request.method !== "PUT" || !request.url.endsWith("/work.ttl")) return;
      const rdf = await parse(request.url, request.body);
      if (
        rdf.getObjects(
          DataFactory.namedNode(`${request.url}#this`),
          DataFactory.namedNode(`${SCHEMA}position`),
          null,
        ).length
      ) {
        rejected++;
        return new Response("Position unavailable", { status: 503 });
      }
    };
    await click("Import 1 tasks");
    await finished();
    expect(rejected).toBe(1);
    expect(
      (await cache.store.listProjects()).map((project) => project.url.split("/").pop()),
    ).toEqual(["inbox.ttl", "work.ttl"]);
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["Title"]);
    expect(toast.warning).toHaveBeenCalledWith("Couldn't save the project's position");
    expect(toast.success).toHaveBeenCalledWith("Imported 1 tasks into Work", expect.anything());
  });

  it("retains the project and saved sections when a later import step throws", async () => {
    await pick("TYPE,CONTENT\nsection,Doing\ntask,Title @work");
    const ensure = cache.ensureLabels.bind(cache);
    vi.spyOn(cache, "ensureLabels")
      .mockRejectedValueOnce(new Error("Later setup failed"))
      .mockImplementation(ensure);
    await click("Import 1 tasks");
    await retryable();
    const project = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    await click("Import 1 tasks");
    await finished();
    expect(
      (await cache.store.listProjects())
        .filter((item) => item.url !== inbox.url)
        .map((item) => item.url),
    ).toEqual([project?.url]);
    const saved = await cache.store.readProject(project?.url as string);
    expect(saved.tracker.sections.map((section) => section.name)).toEqual(["Doing"]);
    expect(saved.tracker.labels.map((label) => label.name)).toEqual(["work"]);
    const tasks = await cache.store.listTasks(saved.tracker.stateStore as string);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task.types.has(saved.tracker.sections[0]?.id as string)).toBe(true);
    expect(tasks[0]?.task.types.has(saved.tracker.labels[0]?.id as string)).toBe(true);
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

  it("does not create a project when cancelled behind a blocked cache mutation", async () => {
    await pick("TYPE,CONTENT\nsection,Doing\ntask,Title @work");
    const blocked = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === inbox.url) {
        started.resolve();
        await blocked.promise;
      }
    };
    let mutation: ReturnType<TasksCache["updateProject"]>;
    await act(async () => {
      mutation = cache.updateProject(inbox, (tracker) => {
        tracker.description = "Existing edit";
      });
      await started.promise;
    });
    const count = pod.mutations().length;
    await click("Import 1 tasks");
    await click("Cancel");
    await act(async () => {
      blocked.resolve();
      await mutation;
    });
    await finished();
    expect(pod.mutations()).toHaveLength(count);
    expect(cache.getSnapshot().projects.map((project) => project.tracker.title)).toEqual(["Inbox"]);
    expect(toast.info).toHaveBeenCalledWith(
      "Import cancelled. Imported 0 tasks into Work. Already-created tasks stay.",
      expect.anything(),
    );
    expect(push).not.toHaveBeenCalled();
    expect(cache.getSnapshot().saving).toEqual([]);
  });

  it.each(["sections", "labels"])("cancels queued %s setup before it writes", async (stage) => {
    await pick("TYPE,CONTENT\nsection,Doing\ntask,Title @work");
    const blocked = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === inbox.url) {
        started.resolve();
        await blocked.promise;
      }
    };
    let queued = false;
    let mutation: ReturnType<TasksCache["updateProject"]> | undefined;
    const unsubscribe = cache.subscribe(() => {
      if (queued) return;
      const snapshot = cache.getSnapshot();
      const project = snapshot.projects.find((item) => item.url.endsWith("/work.ttl"));
      if (
        !project ||
        snapshot.saving.includes(project.url) ||
        (stage === "labels" && !project.tracker.sections.length)
      )
        return;
      queued = true;
      // Reserve a competing mutation between setup stages, before the next stage is queued.
      mutation = cache.updateProject(inbox, (tracker) => {
        tracker.description = "Existing edit";
      });
    });
    await click("Import 1 tasks");
    await act(async () => started.promise);
    const count = pod.mutations().length;
    await click("Cancel");
    await act(async () => {
      blocked.resolve();
      await mutation;
    });
    await finished();
    unsubscribe();
    expect(pod.mutations()).toHaveLength(count);
    const project = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    if (!project) throw new Error("Missing project");
    const saved = await cache.store.readProject(project.url);
    expect(saved.tracker.sections).toHaveLength(stage === "sections" ? 0 : 1);
    expect(saved.tracker.labels).toEqual([]);
    expect(cache.getSnapshot().views).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Import cancelled. Imported 0 tasks into Work. Already-created tasks stay.",
      expect.anything(),
    );
  });
});

describe("Google Tasks through the shared import dialog", () => {
  it("uses Google source IDs across reordered drafts and scopes their hashes to the project", async () => {
    const rows = [
      { id: "first/source?", title: "First", status: "needsAction", position: "01" },
      { id: "second", title: "Second", status: "needsAction", position: "02" },
    ];
    const importInto = async (project: StoredProject, items: typeof rows) => {
      const draft = parseGoogleTasksJson(JSON.stringify({ kind: "tasks#tasks", items }))
        .projects[0];
      if (!draft) throw new Error("Missing draft");
      return importProject(cache, draft, "Unused", new AbortController().signal, () => {}, {
        project,
      });
    };
    await act(async () => {
      expect(await importInto(inbox, rows)).toMatchObject({ imported: 2, failed: 0 });
    });
    const original = await cache.store.listTasks(inbox.tracker.stateStore as string);
    const first = original.find((item) => item.task.title === "First");
    if (!first) throw new Error("Missing first task");
    await cache.store.updateTask(first, (task) => {
      task.title = "Edited after import";
    });
    await act(async () => {
      // A fresh operation has no task reservations or confirmed-write map to reuse.
      expect(await importInto(inbox, [...rows].reverse())).toMatchObject({
        imported: 2,
        failed: 0,
      });
    });
    const retried = await cache.store.listTasks(inbox.tracker.stateStore as string);
    expect(retried.map((item) => item.url).sort()).toEqual(original.map((item) => item.url).sort());
    expect(retried.find((item) => item.url === first.url)?.task.title).toBe("Edited after import");
    expect(cache.getSnapshot().views.map((task) => task.title)).toContain("Edited after import");
    for (const task of retried)
      expect(task.url.split("/").pop()).toMatch(/^import-[a-f0-9]{64}\.ttl$/);

    await act(async () => {
      const other = await cache.createProject("Other");
      if (!other) throw new Error("Missing other project");
      expect(await importInto(other, rows)).toMatchObject({ imported: 2, failed: 0 });
      const tasks = await cache.store.listTasks(other.tracker.stateStore as string);
      const names = new Set(original.map((task) => task.url.split("/").pop()));
      expect(tasks.every((task) => !names.has(task.url.split("/").pop()))).toBe(true);
    });
  });

  it.each([
    {
      name: "Tasks.json",
      content: JSON.stringify({
        kind: "tasks#taskLists",
        items: [
          {
            id: "work",
            title: "Work",
            items: [
              { id: "parent", title: "Parent", status: "needsAction", position: "01" },
              {
                id: "child",
                title: "Child",
                parent: "parent",
                status: "needsAction",
                position: "02",
              },
            ],
          },
        ],
      }),
    },
    { name: "Work.csv", content: "TYPE,CONTENT,INDENT\ntask,Parent,1\ntask,Child,2" },
  ])("retries the same task URL after a lost PUT and a failed confirmation GET ($name)", async ({
    name,
    content,
  }) => {
    await pick(content, name);
    let committed: RequestRecord | undefined;
    let confirmationFailed = false;
    pod.intercept = (request) => {
      if (taskWrite(request)) {
        committed = request;
        pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
      if (request.method === "GET" && request.url === committed?.url) {
        confirmationFailed = true;
        return new Response("Confirmation unavailable", { status: 503 });
      }
    };
    await click("Import 2 tasks");
    await retryable();
    expect(committed).toBeDefined();
    expect(confirmationFailed).toBe(true);
    expect(pod.requests.filter(taskWrite)).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported 0 tasks into Work. 2 tasks failed.",
      expect.anything(),
    );

    pod.intercept = undefined;
    await click("Import 2 tasks");
    await finished();
    const project = cache.getSnapshot().projects.find((item) => item.tracker.title === "Work");
    if (!project || !committed) throw new Error("Missing committed task");
    const tasks = await cache.store.listTasks(project.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    const parent = tasks.find((item) => item.task.title === "Parent");
    expect(parent?.url).toBe(committed.url);
    expect(tasks.find((item) => item.task.title === "Child")?.task.parent).toBe(parent?.task.id);
    expect(pod.files.get(committed.url)?.body).toBe(committed.body);
    const writes = pod.requests.filter(taskWrite);
    expect(writes).toHaveLength(3);
    expect(writes[1]?.url).toBe(committed.url);
    expect(writes.every((request) => request.headers.get("If-None-Match") === "*")).toBe(true);
    expect(cache.getSnapshot().views).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith("Imported 2 tasks into Work", expect.anything());
  });

  it("reuses its tracker reservation when the create response is lost", async () => {
    await pick(
      '{"kind":"tasks#tasks","items":[{"id":"task","title":"Task","position":"01","status":"needsAction"}]}',
      "Tasks.json",
    );
    let lost = false;
    pod.intercept = (request) => {
      if (
        !lost &&
        request.method === "PUT" &&
        request.url.endsWith("/imported-tasks.ttl") &&
        request.headers.get("If-None-Match") === "*"
      ) {
        lost = true;
        pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
    };
    await click("Import 1 tasks");
    await retryable();
    expect(lost).toBe(true);
    await click("Import 1 tasks");
    await finished();
    const projects = (await cache.store.listProjects()).filter(
      (project) => project.url !== inbox.url,
    );
    expect(projects.map((project) => project.url.split("/").pop())).toEqual(["imported-tasks.ttl"]);
    expect(await cache.store.listTasks(projects[0]?.tracker.stateStore as string)).toHaveLength(1);
  });

  it("retries a failed child in its saved parent's project while leaving the other list complete", async () => {
    await pick(takeout, "Tasks.json");
    pod.intercept = async (request) => {
      if (!taskWrite(request)) return;
      const rdf = await parse(request.url, request.body);
      if (
        rdf
          .getObjects(
            DataFactory.namedNode(`${request.url}#it`),
            DataFactory.namedNode(`${NS.DCT}title`),
            null,
          )
          .some((title) => title.value === "Child")
      )
        return new Response("Child unavailable", { status: 503 });
    };
    await click("Import 3 tasks");
    await retryable();
    const parent = cache.getSnapshot().views.find((task) => task.title === "Finished");
    const other = cache.getSnapshot().views.find((task) => task.title === "SECRET other task");
    expect(parent).toBeDefined();
    expect(other).toBeDefined();
    expect([...document.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual([
      "Work",
    ]);
    const writes = pod.mutations().length;
    pod.intercept = undefined;
    await click("Import 2 tasks");
    await finished();
    expect((await cache.store.listProjects()).map((project) => project.tracker.title)).toEqual([
      "Inbox",
      "Work",
      "Personal",
    ]);
    const tasks = cache.getSnapshot().views;
    expect(tasks).toHaveLength(3);
    expect(tasks.find((task) => task.title === "Finished")?.url).toBe(parent?.url);
    expect(tasks.find((task) => task.title === "Child")?.parentId).toBe(parent?.id);
    expect(tasks.find((task) => task.title === "SECRET other task")?.url).toBe(other?.url);
    expect(pod.mutations()).toHaveLength(writes + 2);
  });

  it("keeps a completed task without a timestamp closed without inventing its completion time", async () => {
    await pick(
      '{"kind":"tasks#tasks","items":[{"id":"done","title":"Done","position":"01","status":"completed"}]}',
      "Tasks.json",
    );
    await click("Import 1 tasks");
    await finished();
    const project = cache
      .getSnapshot()
      .projects.find((project) => project.tracker.title === "Imported tasks");
    if (!project) throw new Error("Missing project");
    const tasks = await cache.store.listTasks(project.tracker.stateStore as string);
    expect(tasks[0]?.task.state).toBe("closed");
    expect(tasks[0]?.task.endedAt).toBeUndefined();
  });
  it("previews both lists, imports only the checked list, and preserves completion, hierarchy and all-day RDF", async () => {
    expect(query('[role="dialog"]').textContent).toContain("Import tasks");
    expect(document.body.textContent).toContain(
      "From a Todoist CSV or a Google Tasks export (Tasks.json from Google Takeout)",
    );
    await pick(takeout, "Tasks.json", false, "application/json");
    const lists = [...document.querySelectorAll("fieldset")];
    expect(lists).toHaveLength(2);
    expect(lists[0]?.textContent).toContain("2 tasks · 1 sub-tasks");
    expect(lists[1]?.textContent).toContain("1 tasks · 0 sub-tasks");
    const checks = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.every((input) => input.checked)).toBe(true);
    expect(document.body.textContent).not.toContain("SECRET");
    expect(document.body.textContent).toContain("List 1, task 2:");
    expect(document.body.textContent).toContain(
      "A hidden completed task will be imported as completed.",
    );
    await act(async () => checks[1]?.click());
    const name = query<HTMLInputElement>('input[aria-label="Project name for Work"]');
    expect(name.value).toBe("Work");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        name,
        "Imported work",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Import 2 tasks");
    await finished();
    const created = cache.getSnapshot().projects.filter((project) => project.url !== inbox.url);
    expect(created).toHaveLength(1);
    const project = created[0];
    if (!project) throw new Error("Missing project");
    expect(project.tracker.title).toBe("Imported work");
    const tasks = await cache.store.listTasks(project.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    const parent = tasks.find((task) => task.task.title === "Finished");
    const child = tasks.find((task) => task.task.title === "Child");
    if (!parent || !child) throw new Error("Missing task");
    expect(parent.task.state).toBe("closed");
    expect(parent.task.endedAt).toEqual(new Date("2026-11-01T11:34:56Z"));
    expect(parent.task.description).toBe("SECRET notes\nReceipt: https://mail.example/receipt");
    expect(parent.task.priority).toBeUndefined();
    expect(parent.task.allDay).toBe("2026-07-01");
    expect(parent.task.dueDate).toEqual(new Date(2026, 6, 1));
    expect(child.task.parent).toBe(parent.task.id);
    expect(child.task.state).toBe("open");
    const rdf = await pod.dataset(parent.url);
    expect(
      rdf.getObjects(
        DataFactory.namedNode(parent.task.id),
        DataFactory.namedNode(`${SCHED}dueTime`),
        null,
      ),
    ).toEqual([DataFactory.literal("2026-07-01", DataFactory.namedNode(`${NS.XSD}date`))]);
    expect(
      rdf.getObjects(
        DataFactory.namedNode(parent.task.id),
        DataFactory.namedNode(`${NS.PROV}endedAtTime`),
        null,
      ),
    ).toEqual([
      DataFactory.literal("2026-11-01T11:34:56.000Z", DataFactory.namedNode(`${NS.XSD}dateTime`)),
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "Imported 2 tasks into Imported work",
      expect.anything(),
    );
  });

  it("creates a distinct project for every checked list using New project's collision handling", async () => {
    await act(async () => {
      await cache.createProject("Work");
    });
    await pick(
      takeout.replace('"title":"Personal"', '"title":"Work"'),
      "Tasks.json",
      true,
      "application/json",
    );
    await click("Import 3 tasks");
    await finished();
    const projects = cache
      .getSnapshot()
      .projects.filter((project) => project.tracker.title === "Work");
    expect(projects.map((project) => project.url.split("/").pop()).sort()).toEqual([
      "work-2.ttl",
      "work-3.ttl",
      "work.ttl",
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "Imported 3 tasks into 2 projects",
      expect.anything(),
    );
    expect(cache.getSnapshot().views).toHaveLength(3);
  });

  it("shows a safe parser error for malformed JSON and accepts a replacement", async () => {
    await pick('{"kind":"SECRET",', "Tasks.json", false, "application/json");
    expect(query('[role="alert"]').textContent).toBe(
      "This file is not valid Google Tasks JSON. Choose another file.",
    );
    expect(document.body.textContent).not.toContain("SECRET");
    await pick(takeout, "wrong.csv");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("requires a checked list and a name for each selected project", async () => {
    await pick(takeout, "Tasks.json");
    const name = query<HTMLInputElement>('input[aria-label="Project name for Work"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, " ");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Import 3 tasks",
      )?.disabled,
    ).toBe(true);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await act(async () => checkbox.click());
    }
    expect(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Import 0 tasks",
      )?.disabled,
    ).toBe(true);
  });

  it("cancels during a list and never starts the next project", async () => {
    await pick(takeout, "Tasks.json");
    const blocked = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    pod.intercept = async (request) => {
      if (taskWrite(request)) {
        started.resolve();
        await blocked.promise;
      }
    };
    await click("Import 3 tasks");
    await act(async () => started.promise);
    expect(document.body.textContent).toContain("Importing 0 of 3…");
    await click("Cancel");
    await act(async () => blocked.resolve());
    await finished();
    expect(
      cache
        .getSnapshot()
        .projects.map((project) => project.tracker.title)
        .sort(),
    ).toEqual(["Inbox", "Work"]);
    expect(cache.getSnapshot().views).toHaveLength(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Import cancelled. Imported 1 tasks into 1 projects. Already-created tasks stay.",
      expect.anything(),
    );
  });

  it("keeps importing other lists after a task failure and summarises both projects", async () => {
    await pick(takeout, "Tasks.json");
    const create = cache.store.createTask.bind(cache.store);
    vi.spyOn(cache.store, "createTask").mockImplementation(async (...args) => {
      if (args[1].title === "Finished") throw new Error("Write failed");
      return create(...args);
    });
    await click("Import 3 tasks");
    await retryable();
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["SECRET other task"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Imported 1 tasks into 2 projects. 2 tasks failed.",
      expect.anything(),
    );
    expect([...document.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual([
      "Work",
    ]);
  });

  it("creates checked empty lists, and explains an export without lists", async () => {
    await pick('{"kind":"tasks#taskLists","items":[]}', "Tasks.json");
    expect(document.body.textContent).toContain("No task lists to import.");
    await pick('{"kind":"tasks#taskLists","items":[{"id":"empty","title":"Empty"}]}', "Tasks.json");
    await click("Import 0 tasks");
    await finished();
    expect(cache.getSnapshot().projects.map((project) => project.tracker.title)).toEqual([
      "Inbox",
      "Empty",
    ]);
    expect(toast.success).toHaveBeenCalledWith("Imported 0 tasks into Empty", expect.anything());
  });

  it.each([
    0, 1,
  ])("isolates a project setup failure with %i tasks and retries only that list", async (failedTasks) => {
    await pick(
      JSON.stringify({
        kind: "tasks#taskLists",
        items: [
          {
            id: "first",
            title: "First",
            items: [
              { id: "first-task", title: "First task", status: "needsAction", position: "01" },
            ],
          },
          {
            id: "failed",
            title: "Failed",
            items: Array.from({ length: failedTasks }, () => ({
              id: "failed-task",
              title: "Retry task",
              status: "needsAction",
              position: "01",
            })),
          },
          {
            id: "last",
            title: "Last",
            items: [{ id: "last-task", title: "Last task", status: "needsAction", position: "01" }],
          },
        ],
      }),
      "Tasks.json",
    );
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url.endsWith("/failed.ttl"))
        return new Response("SECRET setup failure", { status: 503 });
    };
    await click(`Import ${2 + failedTasks} tasks`);
    await retryable();
    const projects = cache.getSnapshot().projects.filter((project) => project.url !== inbox.url);
    expect(projects.map((project) => project.tracker.title)).toEqual(["First", "Last"]);
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual([
      "First task",
      "Last task",
    ]);
    expect(toast.error).toHaveBeenCalledWith(
      `Imported 2 tasks into 2 projects.${failedTasks ? " 1 tasks failed." : ""} 1 projects failed.`,
      expect.anything(),
    );
    expect(vi.mocked(toast.error).mock.calls[0]?.[1]?.description).toMatchObject({
      props: {
        children: projects.map((project) => ({
          props: {
            href: `/tasks/p/${encodeRef(project.url)}`,
            children: ["Open ", project.tracker.title],
          },
        })),
      },
    });
    expect(query('[role="alert"]').textContent).toContain("Could not finish the import.");
    expect(document.body.textContent).not.toContain("SECRET");
    expect([...document.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual([
      "Failed",
    ]);
    expect(query<HTMLInputElement>('input[type="checkbox"]').checked).toBe(true);
    expect(push).not.toHaveBeenCalled();

    pod.intercept = undefined;
    await click(`Import ${failedTasks} tasks`);
    await finished();
    expect(cache.getSnapshot().projects.map((project) => project.tracker.title)).toEqual([
      "Inbox",
      "First",
      "Failed",
      "Last",
    ]);
    expect(cache.getSnapshot().views).toHaveLength(2 + failedTasks);
    for (const project of projects) {
      const tasks = await cache.store.listTasks(project.tracker.stateStore as string);
      expect(tasks.map((task) => task.task.title)).toEqual([`${project.tracker.title} task`]);
    }
    expect(toast.success).toHaveBeenCalledWith(
      `Imported ${failedTasks} tasks into Failed`,
      expect.anything(),
    );
  });

  it("reports a project setup failure for an empty list instead of claiming success", async () => {
    await pick('{"kind":"tasks#taskLists","items":[{"id":"empty","title":"Empty"}]}', "Tasks.json");
    vi.spyOn(cache.store, "createProject").mockRejectedValue(new Error("Write failed"));
    await click("Import 0 tasks");
    expect(query('[role="alert"]').textContent).toContain("Could not finish the import.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(cache.getSnapshot().projects.map((project) => project.tracker.title)).toEqual(["Inbox"]);
  });
});
