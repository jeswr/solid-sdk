// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { IssuesTaskStore } from "../../src/apps/tasks/lib/issues/store";
import { NS, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { containerUrl, issuesFixture, trackerUrl } from "./tasks-issues-fixtures";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/issues",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
let cache: TasksCache;
let store: IssuesTaskStore;
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    issuesStore: store,
    webId,
    inboxUrl: cache.inboxUrl,
    createTask: cache.createTask.bind(cache),
    updateTask: cache.updateTask.bind(cache),
  }),
}));

import { TaskDetail } from "../../src/apps/tasks/components/detail/task-detail";
import { IssuesDetail } from "../../src/apps/tasks/components/issues/issues-detail";
import { IssuesView } from "../../src/apps/tasks/components/issues/issues-view";
import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { TaskRow } from "../../src/apps/tasks/components/task-row";
import { issueComments } from "../../src/apps/tasks/lib/issues/model";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  for (const name of [
    "HTMLFormElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "DocumentFragment",
    "ShadowRoot",
    "Document",
  ] as const)
    vi.stubGlobal(name, window[name]);
});
async function ready() {
  const fixture = await issuesFixture();
  store = fixture.store;
  const failure = vi.fn();
  cache = new TasksCache(store, failure, webId);
  await cache.start();
  await cache.loadTasks(fixture.project);
  return { ...fixture, failure };
}
it("disables creating and shows a readable detail for view-only access", async () => {
  const { pod, project } = await ready();
  const item = await cache.createTask(project, { title: "View only" });
  if (!item) throw new Error("Missing fixture");
  pod.intercept = (request) =>
    request.url === containerUrl || request.url === item.url
      ? new Response(
          request.url === item.url
            ? pod.files.get(item.url)?.body
            : `<${containerUrl}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${item.url}>.`,
          { headers: { "Content-Type": "text/turtle", "WAC-Allow": 'user="read"' } },
        )
      : undefined;
  await cache.loadTasks(project, true);
  const { host } = await mount(
    h("div", null, h(IssuesView), h(TaskDetail, { stored: item, project, onClose: vi.fn() })),
  );
  expect(host.textContent).toContain("You can view this tracker but not edit it");
  expect(host.querySelector<HTMLInputElement>('[aria-label="New issue title"]')?.disabled).toBe(
    true,
  );
  expect(host.querySelector('textarea[aria-label="Task title"]')).toBeNull();
  expect(host.querySelector('textarea[aria-label="Comment"]')).toBeNull();
  expect(host.textContent).toContain("View only");
});
it("keeps issue editing available when only the tracker and container are read-only", async () => {
  const { pod, project } = await ready();
  const item = await cache.createTask(project, { title: "Editable issue" });
  if (!item) throw new Error("Missing issue");
  pod.intercept = (request) =>
    request.method === "GET" && [trackerUrl, containerUrl].includes(request.url)
      ? new Response(
          request.url === containerUrl
            ? `<${containerUrl}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${item.url}>.`
            : pod.files.get(trackerUrl)?.body,
          { headers: { "Content-Type": "text/turtle", "WAC-Allow": 'user="read"', ETag: '"1"' } },
        )
      : undefined;
  await cache.refreshProjects();
  await cache.loadTasks(project, true);
  const { host } = await mount(h(TaskDetail, { stored: item, project, onClose: vi.fn() }));
  expect(host.querySelector('textarea[aria-label="Task title"]')).not.toBeNull();
  expect(host.querySelector('textarea[aria-label="Comment"]')).not.toBeNull();
});
it("hides issue project moves and disables Duplicate, including in shared task rows", async () => {
  const { project, pod } = await ready();
  const item = await cache.createTask(project, { title: "Stationary" });
  if (!item) throw new Error("Missing issue");
  await cache.createTask(project, { title: "Second issue" });
  const ui = await mount(h(TaskDetail, { stored: item, project, onClose: vi.fn() }));
  expect(ui.host.querySelector('[aria-label$=", move task"]')).toBeNull();
  expect(ui.host.querySelector('[aria-label="Project"]')?.getAttribute("disabled")).not.toBeNull();
  const actions = ui.host.querySelector<HTMLElement>('[aria-label="Task actions"]');
  if (!actions) throw new Error("Missing menu");
  await key(actions, "ArrowDown");
  const duplicate = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Duplicate",
  );
  expect(duplicate?.getAttribute("data-disabled")).not.toBeNull();
  await key(document.querySelector('[role="menu"]') as HTMLElement, "Escape");
  const task = cache.getSnapshot().views.find((view) => view.url === item.url);
  if (!task) throw new Error("Missing view");
  await ui.render(
    h(
      "table",
      null,
      h(
        "tbody",
        null,
        h(TaskRow, {
          row: { task, depth: 0 },
          tabIndex: 0,
          onFocus: vi.fn(),
          onMove: vi.fn(),
          container: { kind: "section", projectUrl: project.url, sectionId: undefined },
        }),
      ),
    ),
  );
  expect(ui.host.querySelector(".tsk-drag-handle")).toBeNull();
  const row = ui.host.querySelector<HTMLElement>("[data-tsk-row]");
  if (!row) throw new Error("Missing row");
  const before = pod.mutations().length;
  await act(() =>
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    ),
  );
  await key(row, "v");
  expect(pod.mutations()).toHaveLength(before);
  await key(row, "F10", true);
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].some((item) =>
      item.textContent?.startsWith("Move"),
    ),
  ).toBe(false);
});
it.each([
  "open",
  "closed",
] as const)("retries the requested issue state when the refreshed state is %s", async (freshState) => {
  const { project, pod, failure } = await ready();
  const item = await cache.createTask(project, { title: "Conflict" });
  if (!item) throw new Error("Missing issue");
  const remote = await store.readTask(item.url);
  remote.task.state = freshState;
  remote.task.title = "Remote edit";
  pod.seed(item.url, await serialize(remote.dataset));
  const { host } = await mount(h(IssuesDetail, { stored: item }));
  const close = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Close issue",
  );
  if (!close) throw new Error("Missing close button");
  await click(close);
  await act(async () => {
    await vi.waitFor(() => expect(failure).toHaveBeenCalled());
  });
  const before = pod.mutations().length;
  await act(async () => {
    failure.mock.calls[0]?.[1]();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toHaveLength(0));
  });
  expect((await store.readTask(item.url)).task.state).toBe("closed");
  expect(pod.mutations().length - before).toBe(freshState === "closed" ? 0 : 1);
});
it("lists a tracker once in the labelled Issues sidebar section", async () => {
  await ready();
  const { host } = await mount(h(TasksSidebar));
  const links = host.querySelectorAll(`a[href="/tasks/issues/${encodeRef(trackerUrl)}"]`);
  expect(links).toHaveLength(1);
  expect(links[0]?.closest('section[aria-label="Issues"]')).not.toBeNull();
  expect(host.querySelector(`a[href="/tasks/p/${encodeRef(trackerUrl)}"]`)).toBeNull();
});
it("keeps the Issues section hidden when no trackers were found", async () => {
  const { pod } = await ready();
  pod.files.delete(trackerUrl);
  await cache.refreshProjects();
  const { host } = await mount(h(TasksSidebar));
  expect(host.querySelector('section[aria-label="Issues"]')).toBeNull();
});
it("opens issue detail links and offers a keyboard-operable state board", async () => {
  const { project } = await ready();
  const item = await cache.createTask(project, { title: "Keyboard issue" });
  const { host } = await mount(h(IssuesView));
  expect(host.querySelector("table a")?.getAttribute("href")).toBe(
    `/tasks/issues?task=${encodeRef(item?.url ?? "")}`,
  );
  const board = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Board",
  );
  if (!board) throw new Error("Missing board toggle");
  await click(board);
  expect(host.querySelector('section[aria-label="Open"] a')?.textContent).toBe("Keyboard issue");
  expect(host.querySelector('section[aria-label="Closed"]')).not.toBeNull();
  const filter = host.querySelector<HTMLSelectElement>(
    'section[aria-label="Issue filters"] select',
  );
  await act(async () => {
    if (filter) {
      filter.value = "closed";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  expect(host.textContent).not.toContain("Keyboard issue");
});
it("creates an issue from the table and saves comments, assignment and state through the cache", async () => {
  await ready();
  const ui = await mount(h(IssuesView));
  expect(ui.host.textContent).toContain("No open issues");
  const title = ui.host.querySelector<HTMLInputElement>('[aria-label="New issue title"]');
  if (!title) throw new Error("Missing issue title");
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      title,
      "From the table",
    );
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    title.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toHaveLength(0));
  });
  expect(ui.host.querySelector("table a")?.textContent).toBe("From the table");
  function LiveDetails() {
    const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
    const stored = snapshot.tasks[trackerUrl]?.items[0];
    return stored ? h(IssuesDetail, { stored }) : null;
  }
  await ui.render(h(LiveDetails));
  const comment = ui.host.querySelector<HTMLTextAreaElement>('[aria-label="Comment"]');
  const assignee = ui.host.querySelector<HTMLInputElement>('[aria-label="Issue assignee"]');
  if (!comment || !assignee) throw new Error("Missing issue fields");
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
      comment,
      "A useful reply",
    );
    comment.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      assignee,
      webId,
    );
    assignee.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    comment.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    assignee.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toHaveLength(0));
  });
  const item = cache.getSnapshot().tasks[trackerUrl]?.items[0];
  if (!item) throw new Error("Missing saved issue");
  expect(issueComments(item.task)[0]?.content).toBe("A useful reply");
  expect(item.task.assignee).toBe(webId);
  const close = [...ui.host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Close issue",
  );
  if (!close) throw new Error("Missing Close issue");
  await click(close);
  expect(ui.host.textContent).toContain("Closed");
  const reopen = [...ui.host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Reopen issue",
  );
  if (!reopen) throw new Error("Missing Reopen issue");
  await click(reopen);
  await act(async () => {
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toHaveLength(0));
  });
  expect((await store.readTask(item.url)).task.state).toBe("open");
});
