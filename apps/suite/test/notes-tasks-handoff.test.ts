// AUTHORED-BY Claude Opus 5.5
import { beforeEach, expect, it, vi } from "vitest";
import { plannedTasks, sendToTasks } from "../src/apps/notes/lib/tasks-handoff";
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
};
const items = [
  { text: "Buy  milk\n", checked: false },
  { text: "Done already", checked: true },
  { text: "   ", checked: false },
  { text: "Call Sam", checked: false },
];
let serial = 0;
const uuid = () => `id-${++serial}`;
const conflict = Object.assign(new Error("exists"), { status: 412 });

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  serial = 0;
});

it("plans one task per unchecked, nonempty item with collapsed whitespace", () => {
  expect(plannedTasks(items, uuid)).toEqual([
    { id: "id-1", title: "Buy milk" },
    { id: "id-2", title: "Call Sam" },
  ]);
  expect(plannedTasks([{ text: "x", checked: false }])[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(hasOpenItems(items)).toBe(true);
  expect(hasOpenItems([{ text: "Done", checked: true }])).toBe(false);
});

it("creates open tasks in the Inbox and treats an existing task as created", async () => {
  const inbox = { url: "inbox" };
  const createTask = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(conflict)
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce("odd");
  const store = { bootstrapInbox: vi.fn(async () => inbox), createTask };
  const tasks = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, title: `Task ${n}` }));
  const result = await sendToTasks(store, tasks, session.webId);
  expect(createTask).toHaveBeenNthCalledWith(
    1,
    inbox,
    { title: "Task 1", state: "open", creator: session.webId },
    "t1",
  );
  expect(result).toEqual({ created: 2, failed: [tasks[2], tasks[3]] });
});

it("adds the items, then offers to open Tasks", async () => {
  const createTask = vi.fn(async () => ({}));
  const store = { bootstrapInbox: vi.fn(async () => ({})), createTask };
  const close = vi.fn();
  const ui = await mount(
    h(SendToTasksDialog, { items, session, close, createStore: () => store as never }),
  );
  expect(text()).toContain("Buy milk");
  expect(text()).not.toContain("Done already");
  await click(button("Add 2 tasks"));
  expect(createTask).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
  const [message, options] = mocks.toast.success.mock.lastCall ?? [];
  expect(message).toBe("Added 2 tasks to your Tasks Inbox");
  options.action.onClick();
  expect(mocks.push).toHaveBeenCalledWith("/tasks");
  await ui.unmount();
});

it("retries only the failed items with the same ids, and reports Inbox failures", async () => {
  const createTask = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({});
  const bootstrapInbox = vi
    .fn()
    .mockRejectedValueOnce(new Error("forbidden"))
    .mockResolvedValue({});
  const close = vi.fn();
  const ui = await mount(
    h(SendToTasksDialog, {
      items,
      session,
      close,
      createStore: () => ({ bootstrapInbox, createTask }) as never,
    }),
  );
  await click(button("Add 2 tasks"));
  expect(text()).toContain("2 tasks couldn't be added.");
  expect(createTask).not.toHaveBeenCalled();
  await click(button("Try again"));
  expect(text()).toContain("Added 1 task, but 1 task couldn't be added.");
  const failedId = createTask.mock.calls[1]?.[2];
  await click(button("Try again"));
  expect(createTask.mock.calls[2]?.[2]).toBe(failedId);
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.toast.success.mock.lastCall?.[0]).toBe("Added 2 tasks to your Tasks Inbox");
  await ui.unmount();
});

it("can't be dismissed while adding, and cancels otherwise", async () => {
  const pending = deferred<object>();
  const store = { bootstrapInbox: vi.fn(() => pending.promise), createTask: vi.fn() };
  const close = vi.fn();
  const ui = await mount(
    h(SendToTasksDialog, {
      items: [{ text: "One", checked: false }],
      session,
      close,
      createStore: () => store as never,
    }),
  );
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
