// AUTHORED-BY Codex GPT-6.1-Sol
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { act, click, h, key, mount } from "../drive-ui-dom";
import { now, type Pod, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let pod: Pod;
let path = "/tasks/inbox";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useParams: () => ({ slug: "bills" }),
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../src/apps/tasks/state/clock", () => ({ useNow: () => now }));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    webId,
    inboxUrl: cache.inboxUrl,
    renameProject: cache.renameProject,
    archiveProject: cache.archiveProject,
    deleteProject: cache.deleteProject.bind(cache),
  }),
}));

import { FilterRoute } from "../../src/apps/tasks/components/native-routes";
import { TasksSidebar } from "../../src/apps/tasks/components/sidebar";
import { FilterView } from "../../src/apps/tasks/components/views/filter-view";

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("FormData", window.FormData);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  vi.stubGlobal("matchMedia", window.matchMedia);
  path = "/tasks/inbox";
  ({ cache, pod } = await frameCache());
});
const settle = async (check: () => void) =>
  act(async () => {
    await vi.waitFor(check);
  });
function button(text: string, root: ParentNode = document) {
  const result = [...root.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
function field(name: string) {
  const result = document.querySelector<HTMLInputElement>(`[role="dialog"] [name="${name}"]`);
  if (!result) throw new Error(`Missing field ${name}`);
  return result;
}
async function type(name: string, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field(name),
      value,
    );
    field(name).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(() =>
    document
      .querySelector(".tsk-filter-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
}
async function menu(name: string, item: string) {
  const trigger = document.querySelector<HTMLElement>(`[aria-label="Filter actions for ${name}"]`);
  if (!trigger) throw new Error("Missing filter menu");
  await act(() => trigger.focus());
  await key(trigger, "ArrowDown");
  await settle(() => expect(document.querySelector('[role="menu"]')).toBeTruthy());
  await key(button(item), "Enter");
}
const titles = (host: ParentNode) =>
  [...host.querySelectorAll(".tsk-task-title")].map((item) => item.textContent);

it("creates, opens, renames, edits and deletes a personal filter from the sidebar", async () => {
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.ensureLabels(inbox, ["BILLS, rent"]);
  const mounted = await mount(h(TasksSidebar));
  const { host } = mounted;
  expect(host.querySelector('section[aria-label="Filters"]')).toBeNull();
  await click(button("New filter", host));
  const name = field("name");
  expect(name.labels?.[0]?.textContent).toContain("Filter name");
  expect(document.activeElement).toBe(name);
  await type("name", "Bills");
  await click(field("labels"));
  await click(field("assignedToMe"));
  await save();
  expect(push).toHaveBeenLastCalledWith("/tasks/filters/bills");
  const link = host.querySelector<HTMLAnchorElement>('a[href="/tasks/filters/bills"]');
  expect(link?.textContent).toBe("Bills");
  expect(cache.getSnapshot().projects[0]?.tracker.savedViews[0]?.payload).toContain(
    '"assignedToMe":true',
  );
  await menu("Bills", "Rename");
  await type("name", "My bills");
  await save();
  expect(host.querySelector('a[href="/tasks/filters/bills"]')?.textContent).toBe("My bills");
  await menu("My bills", "Edit filter");
  expect(field("labels").value).toBe("BILLS, rent");
  expect(field("labels").checked).toBe(true);
  expect(field("assignedToMe").checked).toBe(true);
  await type("text", "pay");
  await click(field("includeCompleted"));
  await save();
  expect(
    JSON.parse(cache.getSnapshot().projects[0]?.tracker.savedViews[0]?.payload ?? ""),
  ).toMatchObject({ text: "pay", includeCompleted: true, labels: ["BILLS, rent"] });
  path = "/tasks/filters/bills";
  await mounted.render(h(TasksSidebar));
  await menu("My bills", "Delete filter");
  await settle(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(host.querySelector('section[aria-label="Filters"]')).toBeNull();
  expect(push).toHaveBeenLastCalledWith("/tasks/inbox");
  expect((await cache.store.readProject(cache.inboxUrl)).tracker.savedViews).toEqual([]);
});

it("cancels with Escape and returns focus without writing", async () => {
  const { host } = await mount(h(TasksSidebar));
  const trigger = button("New filter", host);
  await act(() => trigger.focus());
  await click(trigger);
  await type("name", "Unfinished");
  await key(field("name"), "Escape");
  await settle(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await settle(() => expect(document.activeElement).toBe(trigger));
  expect(cache.getSnapshot().projects[0]?.tracker.savedViews).toEqual([]);
});

it("renders matches across projects, includes completed on request, and isolates project failures", async () => {
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  const home = await cache.createProject("Home");
  if (!home) throw new Error("Missing Home");
  await cache.loadTasks(home);
  await cache.createTask(inbox, { title: "Pay rent", state: "open" });
  await cache.createTask(home, { title: "Pay bill", state: "closed" });
  await cache.createTask(home, { title: "Do dishes", state: "open" });
  const saved = await cache.saveFilter("Bills", { v: 1, text: "Pay" });
  path = "/tasks/filters/bills";
  const mounted = await mount(h("main", null, h(TasksSidebar), h(FilterRoute)));
  expect(titles(mounted.host)).toEqual(["Pay rent"]);
  expect(
    mounted.host.querySelector('a[href="/tasks/filters/bills"]')?.getAttribute("aria-current"),
  ).toBe("page");
  expect(document.title).toBe("Bills · Tasks · Solid Suite");
  await act(() =>
    cache.saveFilter("Bills", { v: 1, text: "Pay", includeCompleted: true }, saved?.iri),
  );
  expect(titles(mounted.host)).toEqual(["Pay rent", "Pay bill"]);
  pod.intercept = (request) =>
    request.url === home.tracker.stateStore ? new Response(null, { status: 403 }) : undefined;
  await act(() => cache.loadTasks(home, true));
  expect(titles(mounted.host)).toEqual(["Pay rent"]);
  expect(mounted.host.textContent).toContain("Home");
  expect(mounted.host.querySelector(".tsk-project-error")).toBeTruthy();
  pod.intercept = undefined;
  await act(() => cache.loadTasks(home, true));
  await act(() => cache.saveFilter("Bills", { v: 1, text: "no match" }, saved?.iri));
  expect(mounted.host.textContent).toContain("No tasks match this filter");
});

it("skips invalid pod payloads and hostile links in both sidebar and route", async () => {
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  const dataset = await pod.dataset(inbox.url);
  const owner = node(inbox.tracker.id, dataset);
  for (const [iri, payload] of [
    [`${inbox.url}#view-bad`, '{"v":2}'],
    [inbox.tracker.id, '{"v":1}'],
  ]) {
    owner.iris(`${NS.WF}savedView`).add(iri as string);
    node(iri as string, dataset).setText(`${NS.DCT}title`, "Hidden");
    node(iri as string, dataset).setText(`${NS.WF}viewQuery`, payload);
  }
  pod.seed(inbox.url, await serialize(dataset));
  await cache.refreshProjects();
  const { host } = await mount(h("main", null, h(TasksSidebar), h(FilterView, { slug: "bad" })));
  expect(host.querySelector('section[aria-label="Filters"]')).toBeNull();
  expect(host.querySelector(".tsk-content h1")?.textContent).toBe("Filters");
  expect(host.textContent).not.toContain("No tasks match this filter");
});

it("keeps drafts after a failed write, rolls back the sidebar and supports resubmission", async () => {
  const { host } = await mount(h(TasksSidebar));
  pod.intercept = (request) =>
    request.url === cache.inboxUrl && request.method === "PUT"
      ? new Response(null, { status: 412 })
      : undefined;
  await click(button("New filter", host));
  await type("name", "Retry");
  await act(() =>
    document
      .querySelector(".tsk-filter-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't save your changes",
    ),
  );
  expect(host.querySelector('section[aria-label="Filters"]')).toBeNull();
  expect(field("name").value).toBe("Retry");
  pod.intercept = undefined;
  await save();
  expect(push).toHaveBeenLastCalledWith("/tasks/filters/retry");
});

it.each([
  "Rename",
  "Edit filter",
])("rejects a stale %s draft after the tracker refreshes while the editor is open", async (action) => {
  const original = await cache.saveFilter("Bills", { v: 1, text: "original" });
  if (!original) throw new Error("Missing filter");
  await mount(h(TasksSidebar));
  await menu("Bills", action);
  await type("name", "My bills");
  await cache.store.updateProject(await cache.store.readProject(cache.inboxUrl), (tracker) => {
    tracker.defineSavedView("Remote bills", '{"v":1,"text":"remote"}', original.iri);
  });
  await act(() => cache.refreshProjects());
  const writes = pod.mutations().length;
  await act(async () => {
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = cache.subscribe(() => {
        if (!cache.getSnapshot().saving.length) {
          unsubscribe();
          resolve();
        }
      });
    });
    document
      .querySelector(".tsk-filter-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await finished;
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't save your changes",
  );
  expect(field("name").value).toBe("My bills");
  expect(pod.mutations()).toHaveLength(writes);
  expect((await cache.store.readProject(cache.inboxUrl)).tracker.savedViews).toEqual([
    { iri: original.iri, name: "Remote bills", payload: '{"v":1,"text":"remote"}' },
  ]);
});
