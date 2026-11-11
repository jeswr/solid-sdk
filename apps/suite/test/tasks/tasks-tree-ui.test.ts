// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    webId,
    inboxUrl: cache.inboxUrl,
    createTask: cache.createTask.bind(cache),
    updateTask: cache.updateTask.bind(cache),
    moveTaskToProject: cache.moveTaskToProject.bind(cache),
    addSection: cache.addSection,
  }),
}));

import { BoardView } from "../../src/apps/tasks/components/board/board-view";
import { TaskDetail } from "../../src/apps/tasks/components/detail/task-detail";
import { TaskList } from "../../src/apps/tasks/components/task-list";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";
import { NS, node } from "../../src/apps/tasks/lib/model/rdf";
import { flatRows } from "../../src/apps/tasks/lib/views/project-groups";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  for (const name of [
    "HTMLFormElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "DocumentFragment",
  ] as const)
    vi.stubGlobal(name, window[name]);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const result = await frameCache();
  cache = result.cache;
  const create = async (title: string, parent?: StoredTask, state: "open" | "closed" = "open") => {
    const task = await cache.createTask(result.inbox, {
      title,
      ...(parent ? { parent: parent.task.id } : {}),
      state,
    });
    if (!task) throw new Error("Missing task");
    return task;
  };
  return { ...result, create };
}
const settle = () => act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
function row(title: string) {
  const view = cache.getSnapshot().views.find((task) => task.title === title);
  const element = document.querySelector<HTMLElement>(`[data-tsk-row="${view?.url}"]`);
  if (!element) throw new Error(`Missing row ${title}`);
  return element;
}
function byText(selector: string, text: string) {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing ${text}`);
  return element;
}
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLElement>("button")].find(
    (element) => element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
function Detail({ url }: { url: string }) {
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const project = snapshot.projects[0];
  const stored = project && snapshot.tasks[project.url]?.items.find((item) => item.url === url);
  return stored && project ? h(TaskDetail, { stored, project, onClose: vi.fn() }) : null;
}
const status = () => document.querySelector('.suite-sr-only[role="status"]')?.textContent;

describe("unlimited task trees", () => {
  it("keeps true ARIA depth, collapses descendants and keeps direct-child progress visible", async () => {
    const { create } = await setup();
    const root = await create("Root");
    const child = await create("Child", root);
    const grand = await create("Grandchild", child);
    await create("Great grandchild", grand);
    await create("Done", root, "closed");
    const { host, unmount } = await mount(h(ProjectView, { inbox: true }));
    expect(host.querySelector('table[role="treegrid"]')).toBeTruthy();
    expect(
      [...host.querySelectorAll("[data-tsk-row]")].map((element) =>
        element.getAttribute("aria-level"),
      ),
    ).toEqual(["1", "2", "3", "4"]);
    const progress = row("Root").querySelector('[role="progressbar"]');
    expect(row("Root").textContent).toContain("1/2");
    expect(progress?.getAttribute("aria-label")).toBe("1 of 2 sub-tasks done");
    expect(progress?.getAttribute("aria-valuenow")).toBe("1");
    expect(progress?.getAttribute("aria-valuemax")).toBe("2");
    await click(button("Collapse 'Child'"));
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(2);
    expect(row("Child").getAttribute("aria-expanded")).toBe("false");
    await key(row("Child"), "ArrowRight");
    expect(row("Great grandchild").getAttribute("data-depth")).toBe("3");
    await key(row("Root"), "ArrowLeft");
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(1);
    expect(row("Root").textContent).toContain("1/2");
    await key(row("Root"), "ArrowRight");
    await act(() => row("Grandchild").focus());
    await key(row("Grandchild"), "ArrowLeft");
    expect(document.activeElement).toBe(row("Grandchild"));
    await key(row("Grandchild"), "ArrowLeft");
    expect(document.activeElement).toBe(row("Child"));
    await click(button("Collapse 'Root'"));
    await unmount();
    const reopened = await mount(h(ProjectView, { inbox: true }));
    expect(reopened.host.querySelectorAll("[data-tsk-row]")).toHaveLength(1);
    expect(localStorage.getItem("suite.tasks.prefs") ?? "").not.toContain(root.task.id);
  });

  it("indents and outdents a whole subtree with Tab, writing only its root conditionally", async () => {
    const { create, pod, store } = await setup();
    const first = await create("First");
    const moved = await create("Moved");
    const descendant = await create("Descendant", moved);
    const { host } = await mount(h(ProjectView, { inbox: true }));
    await act(() => row("Moved").focus());
    pod.requests.length = 0;
    await key(row("Moved"), "Tab");
    await settle();
    expect(document.activeElement).toBe(row("Moved"));
    expect(row("Descendant").getAttribute("aria-level")).toBe("3");
    expect(status()).toBe("Indented 'Moved'.");
    const writes = pod.mutations();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url).toBe(moved.url);
    expect(writes[0]?.headers.get("If-Match")).toBe(moved.etag);
    const saved = await store.readTask(moved.url);
    expect(saved.task.parent).toBe(first.task.id);
    expect(node(saved.task.id, saved.dataset).iris(`${NS.DCT}isPartOf`).has(first.task.id)).toBe(
      true,
    );
    expect(node(saved.task.id, saved.dataset).number("http://schema.org/position")).toBe(
      saved.task.rank,
    );
    expect((await store.readTask(descendant.url)).task.parent).toBe(moved.task.id);
    expect((await store.readTask(descendant.url)).task.state).toBe("open");
    pod.requests.length = 0;
    await key(row("Moved"), "Tab", true);
    await settle();
    const promoted = await store.readTask(moved.url);
    expect(promoted.task.parent).toBeUndefined();
    expect(promoted.task.rank).toBeGreaterThan(first.task.rank ?? 0);
    expect(pod.mutations()).toHaveLength(1);
    expect(pod.mutations()[0]?.headers.get("If-Match")).toBe(saved.etag);
    expect(status()).toBe("Outdented 'Moved'.");
    expect(host.querySelectorAll("[data-tsk-row]")).toHaveLength(3);
  });

  it("offers matching menu moves, and leaves editable fields and boundary Tab alone", async () => {
    const { create, pod, store } = await setup();
    const first = await create("First");
    const second = await create("Second");
    await mount(h(ProjectView, { inbox: true }));
    pod.requests.length = 0;
    const boundary = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(() => row("First").dispatchEvent(boundary));
    expect(boundary.defaultPrevented).toBe(false);
    await key(row("Second"), "F10", true);
    await click(byText('[role="menuitem"]', "Indent"));
    await settle();
    expect((await store.readTask(second.url)).task.parent).toBe(first.task.id);
    await key(row("Second"), "F10", true);
    await click(byText('[role="menuitem"]', "Outdent"));
    await settle();
    expect((await store.readTask(second.url)).task.parent).toBeUndefined();
    await key(row("Second"), "e");
    const editor = row("Second").querySelector("input");
    pod.requests.length = 0;
    if (!editor) throw new Error("Missing editor");
    await key(editor, "Tab");
    await settle();
    expect(pod.mutations()).toHaveLength(0);
  });

  it("announces rollback and retries without indenting a second time", async () => {
    const { create, pod, failures } = await setup();
    const first = await create("First");
    const second = await create("Second");
    await mount(h(ProjectView, { inbox: true }));
    pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    await key(row("Second"), "Tab");
    await settle();
    expect(status()).toBe("Couldn't indent 'Second'.");
    expect(row("Second").getAttribute("aria-level")).toBe("1");
    pod.intercept = undefined;
    const retry = failures.mock.calls[0]?.[1] as () => void;
    await act(() => retry());
    await settle();
    expect(status()).toBe("Indented 'Second'.");
    expect(cache.getSnapshot().views.find((task) => task.url === second.url)?.parentId).toBe(
      first.task.id,
    );
  });

  it("shows every task as a flat board card, with the same progress", async () => {
    const { create, inbox } = await setup();
    const root = await create("Root");
    const child = await create("Child", root);
    await create("Deep", child);
    await create("Done", root, "closed");
    const { host, render } = await mount(h(BoardView, { projectUrl: inbox.url }));
    expect(host.querySelectorAll(".tsk-card")).toHaveLength(3);
    expect(host.querySelector(".tsk-card")?.textContent).toContain("1/2");
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuemax")).toBe("2");
    await render(h(TaskList, { rows: flatRows(cache.getSnapshot().views), showProject: true }));
    expect(host.querySelectorAll('[data-depth="0"]')).toHaveLength(4);
    expect(host.textContent).toContain("↳ Child");
    expect(host.querySelector('[role="treegrid"]')).toBeNull();
  });

  it("renders deeper detail children, composes under a sub-task and never cascades completion", async () => {
    const { create, pod, store } = await setup();
    const root = await create("Root");
    const child = await create("Child", root);
    const grand = await create("Grandchild", child);
    await create("Great grandchild", grand);
    const { host, render } = await mount(h(Detail, { url: child.url }));
    expect(host.textContent).toContain("Part of Root");
    expect(
      host.querySelector('[aria-label="Grandchild"][role="treeitem"]')?.getAttribute("aria-level"),
    ).toBe("3");
    await click(button("Collapse 'Grandchild'"));
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    await click(button("Expand 'Grandchild'"));
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    await render(h(Detail, { url: grand.url }));
    await click(byText("button", "Add sub-task"));
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Sub-task title"]');
    if (!field) throw new Error("Missing composer");
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        field,
        "New deep child",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    pod.requests.length = 0;
    await act(() =>
      field.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await settle();
    const created = cache.getSnapshot().views.find((task) => task.title === "New deep child");
    expect(created?.parentId).toBe(grand.task.id);
    expect(
      pod
        .mutations()
        .find((request) => request.url === created?.url)
        ?.headers.get("If-None-Match"),
    ).toBe("*");
    await click(host.querySelector("input[aria-label=\"Complete 'Grandchild'\"]") as Element);
    await settle();
    expect((await store.readTask(grand.url)).task.state).toBe("closed");
    expect((await store.readTask(created?.url as string)).task.state).toBe("open");
    expect((await store.readTask(child.url)).task.state).toBe("open");
    expect(host.textContent).toContain("2 sub-tasks still open");
  });
});
