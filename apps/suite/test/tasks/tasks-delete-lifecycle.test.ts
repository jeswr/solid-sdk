// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { deleteTask } from "../../src/apps/tasks/state/actions";
import {
  type TasksContextValue,
  TasksProvider,
  useTasks,
} from "../../src/apps/tasks/state/tasks-context";
import type { PodSession } from "../../src/lib/session/pod-session";
import { act, h, mount } from "../drive-ui-dom";
import { Pod, storage, webId } from "./pod";

vi.mock("@jeswr/suite-ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/access", () => ({
  ensurePrivateTasksAccess: async () => true,
  ensurePrivateIndexAccess: async () => true,
}));

it("flushes a pending delete when navigating out of the provider, before actual document teardown", async () => {
  const pod = new Pod();
  const fetch = vi.fn(pod.fetch);
  const unsubscribe = vi.fn();
  const session: PodSession = {
    mode: "demo",
    webId,
    displayName: "Alice",
    storageUrl: storage,
    fetch,
    subscribe: () => unsubscribe,
    reset: async () => {},
  };
  let tasks: TasksContextValue | undefined;
  function Consumer() {
    tasks = useTasks();
    return null;
  }
  const { render, unmount } = await mount(h(TasksProvider, { session, children: h(Consumer) }));
  await act(async () => {
    await vi.waitFor(() => expect(tasks?.status).toBe("ready"));
  });
  const context = tasks as TasksContextValue | undefined;
  const inbox = context?.projects[0];
  if (!context || !inbox) throw new Error("Missing provider");
  await act(async () => {
    await context.loadTasks(inbox);
    await context.createTask(inbox, { title: "Delete before leaving Tasks" });
  });
  const view = context.cache.getSnapshot().views[0];
  if (!view) throw new Error("Missing task");
  await act(() => deleteTask(view, context));
  expect(pod.files.has(view.url)).toBe(true);
  expect(pod.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  // A suite route transition removes Tasks without firing pagehide.
  await render(h("main", null, "Another suite app"));
  await act(async () => {
    await vi.waitFor(() => expect(pod.files.has(view.url)).toBe(false));
  });
  expect(unsubscribe).toHaveBeenCalledOnce();
  const { toast } = await import("@jeswr/suite-ui");
  expect(toast.dismiss).toHaveBeenCalledWith(vi.mocked(toast.success).mock.calls.at(-1)?.[1]?.id);
  await act(() => window.dispatchEvent(new Event("pagehide")));
  await unmount();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toEqual([
    [view.url, expect.objectContaining({ method: "DELETE", keepalive: true })],
  ]);
});
