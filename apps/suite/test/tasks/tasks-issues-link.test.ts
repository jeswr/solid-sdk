// AUTHORED-BY Claude Sonnet 5.5
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { IssuesTaskStore } from "../../src/apps/tasks/lib/issues/store";
import { NS } from "../../src/apps/tasks/lib/model/rdf";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { click, h, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { containerUrl, issuesFixture, trackerUrl } from "./tasks-issues-fixtures";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  query: "",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/issues",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.query),
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
import { IssuesView } from "../../src/apps/tasks/components/issues/issues-view";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  navigation.query = "";
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
  cache = new TasksCache(store, vi.fn(), webId);
  await cache.start();
  await cache.loadTasks(fixture.project);
  return fixture;
}
const foreign = "https://evil.example/issue-tracker/tracker.ttl";

it("does not open a ?tracker= link until the user confirms its origin", async () => {
  const { pod } = await ready();
  pod.seed(
    foreign,
    `<${foreign}#this> a <${NS.WF}Tracker>; <${NS.DCT}title> "Evil"; <${NS.WF}issueClass> <${NS.WF}Task>.`,
  );
  navigation.query = `tracker=${encodeURIComponent(foreign)}`;
  const open = vi.spyOn(store, "openTracker");
  const { host } = await mount(h(IssuesView));
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("https://evil.example");
  expect(open).not.toHaveBeenCalled();
  expect(store.isOpenedTracker(foreign)).toBe(false);
  const confirm = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Open tracker",
  );
  if (!confirm) throw new Error("Missing confirm button");
  await click(confirm);
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith(foreign));
  expect(host).toBeDefined();
});
it("never opens a ?tracker= link the user cancels", async () => {
  await ready();
  navigation.query = `tracker=${encodeURIComponent(foreign)}`;
  const open = vi.spyOn(store, "openTracker");
  await mount(h(IssuesView));
  const cancel = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  );
  if (!cancel) throw new Error("Missing cancel button");
  await click(cancel);
  expect(open).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it("renders the editable detail of a legacy #this issue without the Tasks comments", async () => {
  const { pod, project } = await ready();
  const url = `${containerUrl}legacy.ttl`;
  pod.seed(
    url,
    `<#this> a <${NS.WF}Task>, <${NS.WF}Open>; <${NS.DCT}title> "Legacy"; <${NS.WF}tracker> <${trackerUrl}#this>.`,
  );
  const stored = await store.readTask(url);
  const { host } = await mount(h(TaskDetail, { stored, project, onClose: vi.fn() }));
  expect(host.querySelector('textarea[aria-label="Task title"]')).not.toBeNull();
  expect(host.querySelectorAll('textarea[aria-label="Comment"]')).toHaveLength(1);
});
