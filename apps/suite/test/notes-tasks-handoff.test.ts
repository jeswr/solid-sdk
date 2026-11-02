// AUTHORED-BY Claude Opus 5.5
import { beforeEach, expect, it, vi } from "vitest";
import { plannedTasks, sendToTasks } from "../src/apps/notes/lib/tasks-handoff";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
const { SendToTasksDialog, hasOpenItems } = await import(
  "../src/apps/notes/components/send-to-tasks"
);

const session = {
  webId: "https://pod.example/profile/card#me",
  storageUrl: "https://pod.example/",
  fetch: vi.fn(),
} as unknown as PodSession;
const items = [
  { text: "Buy  milk\n", checked: false },
  { text: "Done already", checked: true },
  { text: "   ", checked: false },
  { text: "Call Sam", checked: false },
];
const conflict = Object.assign(new Error("exists"), { status: 412 });
const inbox = {
  url: "inbox",
  tracker: { stateStore: "https://pod.example/tasks/projects/inbox/" },
};
type Fn = ReturnType<typeof vi.fn>;
const sink = (
  overrides: Partial<Record<"bootstrapInbox" | "listTasks" | "createTask" | "readTask", Fn>> = {},
): Record<"bootstrapInbox" | "listTasks" | "createTask" | "readTask", Fn> => ({
  bootstrapInbox: vi.fn(async () => inbox),
  listTasks: vi.fn(async () => [
    { task: { rank: 3 } },
    { task: {} },
    { task: { rank: Number.NaN } },
  ]),
  createTask: vi.fn(async () => ({})),
  readTask: vi.fn(async () => ({ task: { title: "Buy milk", state: "open" } })),
  ...overrides,
});

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}
const text = () => document.body.textContent ?? "";
const dialog = (store: unknown, close = vi.fn(), list = items) =>
  mount(
    h(SendToTasksDialog, {
      items: list,
      noteKey: "groceries.ttl",
      session,
      close,
      createStore: () => store as never,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

it("plans stable ids per note, item and repeat, for unchecked nonempty items", () => {
  const plan = plannedTasks([...items, { text: "Call Sam", checked: false }], "groceries.ttl");
  expect(plan.map((task) => task.title)).toEqual(["Buy milk", "Call Sam", "Call Sam"]);
  for (const task of plan) expect(task.id).toMatch(/^note-[0-9a-f]{32}$/);
  expect(new Set(plan.map((task) => task.id)).size).toBe(3);
  expect(plannedTasks(items, "groceries.ttl")).toEqual(plan.slice(0, 2));
  expect(plannedTasks(items, "other.ttl")[0]?.id).not.toBe(plan[0]?.id);
  expect(hasOpenItems(items)).toBe(true);
  expect(
    hasOpenItems([
      { text: "Done", checked: true },
      { text: " ", checked: false },
    ]),
  ).toBe(false);
});

it("appends open tasks after the Inbox's last rank and counts existing ones", async () => {
  const store = sink({
    createTask: vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce("odd"),
    readTask: vi.fn(async () => ({ task: { title: "Task 2", state: "open" } })),
  });
  const tasks = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, title: `Task ${n}` }));
  const result = await sendToTasks(store as never, tasks, session.webId);
  expect(store.listTasks).toHaveBeenCalledWith(inbox.tracker.stateStore);
  expect(store.createTask).toHaveBeenNthCalledWith(
    1,
    inbox,
    { title: "Task 1", state: "open", creator: session.webId, rank: 4 },
    "t1",
  );
  expect(store.createTask.mock.calls[3]?.[1].rank).toBe(7);
  expect(result).toEqual({ created: 1, existing: 1, failed: [tasks[2], tasks[3]] });
  const empty = sink({ listTasks: vi.fn(async () => []) });
  await sendToTasks(empty as never, tasks.slice(0, 1), session.webId);
  expect(empty.createTask.mock.calls[0]?.[1].rank).toBe(1);
  await expect(
    sendToTasks(
      sink({ bootstrapInbox: vi.fn(async () => ({ tracker: {} })) }) as never,
      tasks,
      session.webId,
    ),
  ).rejects.toThrow("Inbox has no stateStore.");
});

it("adds the items, then offers to open Tasks", async () => {
  const store = sink();
  const close = vi.fn();
  const ui = await dialog(store, close);
  expect(text()).toContain("Buy milk");
  expect(text()).not.toContain("Done already");
  await click(button("Add 2 tasks"));
  expect(store.createTask).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
  const [message, options] = mocks.toast.success.mock.lastCall ?? [];
  expect(message).toBe("Added 2 tasks to your Tasks Inbox");
  options.action.onClick();
  expect(mocks.push).toHaveBeenCalledWith("/tasks");
  await ui.unmount();
});

it("reports items already in Tasks instead of duplicating them", async () => {
  const store = sink({ createTask: vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({}) });
  const ui = await dialog(store);
  await click(button("Add 2 tasks"));
  expect(mocks.toast.success.mock.lastCall?.[0]).toBe(
    "Added 1 task to your Tasks Inbox (1 already there)",
  );
  await ui.unmount();
  const again = sink({
    createTask: vi.fn().mockRejectedValue(conflict),
    readTask: vi
      .fn()
      .mockResolvedValueOnce({ task: { title: "Buy milk", state: "open" } })
      .mockResolvedValueOnce({ task: { title: "Call Sam", state: "open" } }),
  });
  const second = await dialog(again);
  await click(button("Add 2 tasks"));
  expect(mocks.toast.success.mock.lastCall?.[0]).toBe(
    "These items are already in your Tasks Inbox",
  );
  // The same note plans the same task ids every time it is sent.
  expect(again.createTask.mock.calls.map((call) => call[2])).toEqual(
    store.createTask.mock.calls.map((call) => call[2]),
  );
  await second.unmount();
});

it("retries only the failed items with the same ids, on one store", async () => {
  const createTask = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({});
  const store = sink({
    createTask,
    bootstrapInbox: vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(inbox),
  });
  const createStore = vi.fn(() => store as never);
  const close = vi.fn();
  const ui = await mount(
    h(SendToTasksDialog, { items, noteKey: "groceries.ttl", session, close, createStore }),
  );
  await click(button("Add 2 tasks"));
  expect(text()).toContain("2 tasks couldn't be added. Check your connection");
  await click(button("Try again"));
  expect(text()).toContain("Added 1 task, but 1 task couldn't be added.");
  const failedId = createTask.mock.calls[1]?.[2];
  await click(button("Try again"));
  expect(createTask.mock.calls[2]?.[2]).toBe(failedId);
  expect(createStore).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.toast.success.mock.lastCall?.[0]).toBe("Added 2 tasks to your Tasks Inbox");
  await ui.unmount();
});

it.each([
  [403, "Tasks isn't available for this account, so nothing was added."],
  [401, "Your sign-in has expired. Sign in again, then try again."],
])("explains a %i from Tasks setup without offering a retry", async (code, message) => {
  const store = sink({
    bootstrapInbox: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { status: code })),
  });
  const close = vi.fn();
  const ui = await dialog(store, close);
  await click(button("Add 2 tasks"));
  expect(text()).toContain(message);
  expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(
    false,
  );
  await click(button("Close"));
  expect(close).toHaveBeenCalledOnce();
  await ui.unmount();
});

it("can't be dismissed while adding, and cancels otherwise", async () => {
  const pending = deferred<typeof inbox>();
  const store = sink({ bootstrapInbox: vi.fn(() => pending.promise) });
  const close = vi.fn();
  const ui = await dialog(store, close, [{ text: "One", checked: false }]);
  await click(button("Add 1 task"));
  expect(button("Adding…").disabled).toBe(true);
  await act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(close).not.toHaveBeenCalled();
  await act(() => pending.reject(new Error("offline")));
  await click(button("Cancel"));
  expect(close).toHaveBeenCalledOnce();
  await act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await ui.unmount();
});

it("checks a task found at the planned address before counting it as already there", async () => {
  const store = sink({
    createTask: vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict),
    readTask: vi
      .fn()
      .mockResolvedValueOnce({ task: { title: "Same", state: "open" } })
      .mockResolvedValueOnce({ task: { title: "Done", state: "closed" } })
      .mockResolvedValueOnce({ task: { title: "Other", state: "open" } })
      .mockRejectedValueOnce(new Error("offline")),
  });
  const tasks = [
    { id: "a", title: "Same" },
    { id: "b", title: "Done" },
    { id: "c", title: "Renamed" },
    { id: "d", title: "Unreadable" },
  ];
  const result = await sendToTasks(store as never, tasks, session.webId, () => "fresh");
  expect(store.readTask).toHaveBeenNthCalledWith(1, `${inbox.tracker.stateStore}a.ttl`);
  // A completed task, or another item's task, never hides this one: it is created afresh.
  expect(store.createTask.mock.calls[2]?.[2]).toBe("fresh");
  expect(store.createTask.mock.calls[2]?.[1].title).toBe("Done");
  expect(result).toEqual({ created: 1, existing: 1, failed: [tasks[2], tasks[3]] });
});

it("names a fresh task with a random id by default", async () => {
  const store = sink({
    createTask: vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({}),
    readTask: vi.fn(async () => ({ task: { title: "Old", state: "closed" } })),
  });
  await sendToTasks(store as never, [{ id: "a", title: "Old" }], session.webId);
  expect(store.createTask.mock.calls[1]?.[2]).toMatch(/^[0-9a-f-]{36}$/);
});
