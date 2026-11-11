// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import { parseVTodo, serializeVTodo, type VTodoCalendar } from "../../src/apps/tasks/lib/vtodo";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { error: vi.fn() },
}));
let cache: TasksCache;
let project: StoredProject;
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    inboxUrl: cache.inboxUrl,
  }),
}));

import { toast } from "@jeswr/suite-ui";
import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";

const stamp = new Date("2026-06-01T10:00:00Z");
const sample: VTodoCalendar = {
  productId: "tests",
  tasks: [
    { uid: "child", parentUid: "parent", title: "Child", stamp, state: "closed", endedAt: stamp },
    {
      uid: "parent",
      title: "Parent <img src=x onerror=alert(1)>",
      stamp,
      state: "open",
      description: "Never render <script>secret</script>",
      categories: ["home"],
    },
  ],
};
function query<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
function button(text: string): Element {
  const found = [...document.querySelectorAll('button, [role="menuitem"]')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing ${text}`);
  return found;
}
async function menu(text: string) {
  await key(projectTrigger(), "Enter");
  await vi.waitFor(() => expect(button(text)).toBeDefined());
  await click(button(text));
}
function projectTrigger(): HTMLButtonElement {
  const trigger = [...document.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-label") === `Project actions for ${project.tracker.title}`,
  );
  if (!trigger) throw new Error("Missing project actions");
  return trigger;
}
async function pick(text: string) {
  const input = query<HTMLInputElement>('input[type="file"]');
  const file = { name: "tasks.ics", text: async () => text };
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await vi.waitFor(() => expect(input.disabled).toBe(false));
  });
}
beforeEach(async () => {
  localStorage.clear();
  const fixture = await frameCache();
  cache = fixture.cache;
  const created = await cache.createProject("Home & garden");
  if (!created) throw new Error("Missing project");
  project = created;
  await cache.loadTasks(project);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("calendar exchange from the project row menu", () => {
  it("downloads a parseable calendar Blob with open and completed tasks, a stable UID and a revoked URL", async () => {
    const renamed = await cache.updateProject(project, (tracker) => {
      tracker.title = "Renamed project";
    });
    if (!renamed) throw new Error("Missing renamed project");
    project = renamed;
    const parent = await cache.createTask(project, {
      title: "Parent",
      due: new Date("2026-06-02T14:30:00Z"),
      priority: "high",
    });
    if (!parent) throw new Error("Missing parent");
    await cache.createTask(project, {
      title: "Child",
      state: "closed",
      endedAt: stamp,
      parent: parent.task.id,
      allDay: "2026-06-03",
    });
    const blobs: Blob[] = [];
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:calendar";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename = "";
    const anchor = vi
      .spyOn(window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        filename = this.download;
        expect(this.href).toBe("blob:calendar");
        expect(this.isConnected).toBe(true);
        expect(revoke).not.toHaveBeenCalled();
      });
    await mount(h(TasksSidebar));
    await menu("Export to calendar (.ics)");
    await vi.waitFor(() => expect(anchor).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
    expect(filename).toBe("home-garden.ics");
    expect(blobs[0]?.type).toBe("text/calendar;charset=utf-8");
    const calendar = parseVTodo(await (blobs[0] as Blob).text());
    expect(calendar.tasks).toHaveLength(2);
    expect(calendar.tasks.find((task) => task.title === "Parent")?.uid).toBe(parent?.task.id);
    expect(calendar.tasks.find((task) => task.title === "Child")).toMatchObject({
      parentUid: parent?.task.id,
      status: "COMPLETED",
      endedAt: stamp,
      due: { kind: "date", value: "2026-06-03" },
    });
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:calendar"));
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("previews untrusted titles as text, imports tasks and a sub-task, and skips every task on re-import", async () => {
    await mount(h(TasksSidebar));
    await menu("Import from calendar (.ics)…");
    expect(query('[role="dialog"]').textContent).toContain("Add tasks to Home & garden");
    await pick(serializeVTodo(sample));
    expect(document.body.textContent).toContain("2 tasks, 1 completed. 0 skipped.");
    expect(query('ul[aria-label="Tasks to import"]').textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
    expect(document.querySelector("img, script")).toBeNull();
    expect(document.body.textContent).not.toContain("Never render");
    await click(button("Add tasks"));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Added 2 tasks. 0 skipped."),
    );
    const rows = cache.getSnapshot().views.filter((task) => task.projectUrl === project.url);
    const parent = rows.find((task) => task.title.startsWith("Parent"));
    expect(rows.find((task) => task.title === "Child")).toMatchObject({
      parentId: parent?.id,
      state: "closed",
    });
    expect(
      cache.getSnapshot().views.filter((task) => task.projectUrl === cache.inboxUrl),
    ).toHaveLength(0);
    await click(button("Close"));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await menu("Import from calendar (.ics)…");
    await pick(serializeVTodo(sample));
    expect(document.body.textContent).toContain("2 tasks, 1 completed. 2 skipped.");
    await click(button("Add tasks"));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Added 0 tasks. 2 skipped."),
    );
    expect(
      cache.getSnapshot().views.filter((task) => task.projectUrl === project.url),
    ).toHaveLength(2);
  });

  it("shows a short error for a bad file, recovers with a new file and returns focus on Cancel", async () => {
    await mount(h(TasksSidebar));
    await menu("Import from calendar (.ics)…");
    await pick("not a calendar <script>private content</script>\r\n");
    expect(query('[role="alert"]').textContent).toBe("This file isn't a valid task calendar.");
    expect(document.body.textContent).not.toContain("private content");
    expect((button("Add tasks") as HTMLButtonElement).disabled).toBe(true);
    expect(cache.getSnapshot().views).toHaveLength(0);
    await pick(serializeVTodo(sample));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await click(button("Cancel"));
    await vi.waitFor(() => expect(document.activeElement).toBe(projectTrigger()));
  });

  it("uses a bottom sheet on small screens and sanitizes read failures", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
      onchange: null,
      addListener() {},
      removeListener() {},
    }));
    await mount(h(TasksSidebar));
    await menu("Import from calendar (.ics)…");
    expect(query('[data-slot="sheet-content"]').getAttribute("role")).toBe("dialog");
    await pick("bad\r\n");
    expect(query('[role="alert"]').textContent).not.toContain("bad");
    await click(button("Cancel"));
    await menu("Export to calendar (.ics)");
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
