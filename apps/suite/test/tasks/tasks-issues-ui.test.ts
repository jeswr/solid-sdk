// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { IssuesTaskStore } from "../../src/apps/tasks/lib/issues/store";
import { NS } from "../../src/apps/tasks/lib/model/rdf";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { act, click, h, mount } from "../drive-ui-dom";
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
import { issueComments } from "../../src/apps/tasks/lib/issues/model";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
async function ready() {
  const fixture = await issuesFixture();
  store = fixture.store;
  cache = new TasksCache(store, vi.fn(), webId);
  await cache.start();
  await cache.loadTasks(fixture.project);
  return fixture;
}
it("disables creating and shows a readable detail for view-only access", async () => {
  const { pod, project } = await ready();
  const item = await cache.createTask(project, { title: "View only" });
  if (!item) throw new Error("Missing fixture");
  pod.intercept = (request) =>
    request.url === containerUrl
      ? new Response(
          `<${containerUrl}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${item.url}>.`,
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
