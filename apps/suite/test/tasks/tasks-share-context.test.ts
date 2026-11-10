// AUTHORED-BY Codex GPT-6.1-Sol
import { toast } from "@jeswr/suite-ui";
import { expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { serialize } from "../../src/apps/tasks/lib/model/rdf";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import {
  type TasksContextValue,
  TasksProvider,
  useTasks,
} from "../../src/apps/tasks/state/tasks-context";
import type { PodSession } from "../../src/lib/session/pod-session";
import { act, h, mount } from "../drive-ui-dom";
import { now, Pod, storage, webId } from "./pod";

vi.mock("@jeswr/suite-ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/access", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ensurePrivateTasksAccess: async () => true,
  ensurePrivateIndexAccess: async () => true,
}));

async function provider() {
  const pod = new Pod();
  let changed: ((url: string) => void) | undefined;
  const session: PodSession = {
    mode: "demo",
    webId,
    displayName: "Alice",
    storageUrl: storage,
    fetch: async (input, init) => {
      if (init?.method !== "HEAD") return pod.fetch(input, init);
      const response = await pod.fetch(input);
      return new Response(null, {
        status: response.status,
        headers: { Link: `<${String(input)}.acl>; rel="acl"` },
      });
    },
    subscribe: (listener) => {
      changed = listener;
      return () => {};
    },
    reset: async () => {},
  };
  let current: TasksContextValue | undefined;
  function Consumer() {
    current = useTasks();
    return null;
  }
  await mount(h(TasksProvider, { session, children: h(Consumer) }));
  await act(async () => {
    await vi.waitFor(() => expect(current?.status).toBe("ready"));
  });
  const context = current as TasksContextValue | undefined;
  if (!context) throw new Error("Missing Tasks provider");
  return { pod, context, changed: (url: string) => changed?.(url) };
}

it("routes sharing feedback through the dialog, with silent cache repair on repeated loads", async () => {
  const { context, pod, changed } = await provider();
  const inbox = context.projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  const bob = "https://bob.example/profile#me";
  const adapter = context.shareAdapter(inbox);
  expect(context.shareAdapter(inbox)).toBe(adapter);
  const sync = vi.spyOn(context.cache, "syncProjectMember");
  await act(async () => {
    await adapter.setPerson(inbox.url, bob, "editor");
  });
  expect(sync).toHaveBeenCalledWith(inbox, bob, true, { silent: true });
  let task: Awaited<ReturnType<typeof context.createTask>>;
  await act(async () => {
    task = await context.createTask(inbox, { title: "Assigned", assignee: bob });
  });
  if (!task) throw new Error("Missing task");
  const assigned = task;
  const writes = vi
    .spyOn(context.cache.store, "updateTask")
    .mockRejectedValue(new ModelError(412, task.url));
  await act(async () => {
    await expect(adapter.setPerson(inbox.url, bob, null)).rejects.toMatchObject({
      code: "members-sync",
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(adapter.load(inbox.url, new AbortController().signal)).resolves.toMatchObject({
        canManage: true,
        warning: "members-sync",
      });
    }
  });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.info).not.toHaveBeenCalled();
  writes.mockRestore();
  await act(async () => {
    expect((await adapter.load(inbox.url, new AbortController().signal)).warning).toBeUndefined();
  });
  expect((await context.cache.store.readTask(task.url)).task.assignee).toBeUndefined();

  const externalUrl = "https://bob.example/projects/shared.ttl";
  const external = createTracker(
    externalUrl,
    "Shared",
    externalUrl.replace(/\.ttl$/, "/"),
    [bob, webId],
    now,
  );
  pod.seed(externalUrl, await serialize(external.dataset));
  const shared = await context.cache.store.readProject(externalUrl);
  expect(context.shareAdapter(shared)).toBeDefined();
  const invalidate = vi.spyOn(context.cache, "invalidate");
  await act(async () => {
    changed(inbox.url);
    changed(assigned.url);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith(assigned.url));
  });
  expect(invalidate).toHaveBeenCalledWith(inbox.url);
  await act(() => window.dispatchEvent(new Event("pagehide")));
});

it("keeps direct mutation feedback and Retry available outside sharing reconciliation", async () => {
  const { context } = await provider();
  const inbox = context.projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  const update = vi.spyOn(context.cache.store, "updateProject");
  for (const [error, message] of [
    [new ModelError(412, inbox.url), "Changed elsewhere — refreshed"],
    [new Error("Storage unavailable"), "Storage unavailable"],
    [{ code: "network" }, "Couldn't save your changes"],
  ] as const) {
    update.mockRejectedValueOnce(error);
    await act(async () => {
      await context.renameProject(inbox, "Renamed");
    });
    expect(toast.error).toHaveBeenLastCalledWith(message, {
      action: { label: "Retry", onClick: expect.any(Function) },
    });
  }
  const retry = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action;
  if (!retry || typeof retry !== "object" || !("onClick" in retry))
    throw new Error("Missing Retry");
  await act(async () => {
    retry.onClick(new MouseEvent("click") as never);
    await vi.waitFor(() =>
      expect(context.cache.getSnapshot().projects[0]?.tracker.title).toBe("Renamed"),
    );
    const bob = "https://bob.example/profile#me";
    await context.cache.syncProjectMember(inbox, bob, true);
    await context.createTask(inbox, { title: "Direct cleanup", assignee: bob });
    await context.cache.syncProjectMember(inbox, bob, false);
  });
  expect(toast.info).toHaveBeenCalledWith("Unassigned 1 tasks");
});

it("requires the Tasks provider for consumers", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Consumer() {
    useTasks();
    return null;
  }
  await expect(mount(h(Consumer))).rejects.toThrow("useTasks must be used within TasksProvider");
  log.mockRestore();
});
