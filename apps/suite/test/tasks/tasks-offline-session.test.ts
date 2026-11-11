// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReplayDelegate } from "@jeswr/suite-sdk/offline";
import { expect, it, vi } from "vitest";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import type { TasksOffline } from "../../src/apps/tasks/state/offline";
import { useTasksOffline } from "../../src/apps/tasks/state/offline-session";
import type { PodSession } from "../../src/lib/session/types";
import { h, mount } from "../drive-ui-dom";
import { storage, webId } from "./pod";
import { setupOffline } from "./tasks-offline-fixtures";

let connection = "online";
let shell: {
  account: { webId: string };
  storage: unknown;
  outbox: Awaited<ReturnType<typeof setupOffline>>["outbox"];
  adapter: Awaited<ReturnType<typeof setupOffline>>["adapter"];
  registerReplayDelegate(
    tag: string,
    factory: (session: { fetch: typeof fetch }) => ReplayDelegate,
  ): () => void;
};
vi.mock("../../src/shell/sync/connection-state", () => ({
  useConnectionState: () => connection,
}));
vi.mock("../../src/shell/sync/outbox-session", () => ({
  useOutboxSession: () => shell,
}));

it("drains an online enqueue after the active replay finishes without another reconnect", async () => {
  const f = await setupOffline(false);
  const task = await f.cache.createTask(f.inbox, { title: "Original" });
  if (!task) throw new Error("Missing task");
  const drain = vi.spyOn(f.adapter, "reconnected");
  shell = {
    account: { webId },
    storage: f.raw,
    outbox: f.outbox,
    adapter: f.adapter,
    registerReplayDelegate: (tag, factory) =>
      f.outbox.registerDelegate(tag, factory({ fetch: f.offlineOptions.fetch })),
  };
  const session: PodSession = {
    mode: "solid",
    webId,
    storageUrl: storage,
    displayName: "Alice",
    fetch: f.offlineOptions.fetch,
    publicFetch: f.pod.fetch,
    subscribe: () => () => {},
  };
  let offline!: TasksOffline;
  function Probe() {
    offline = useTasksOffline(session);
    return null;
  }
  const view = await mount(h(Probe));
  const store = new TaskStore({ ...f.storeOptions, fetch: offline.fetch });
  await store.readTask(task.url);
  connection = "offline";
  f.connect(false);
  await view.render(h(Probe));
  const first = await store.updateTask(task, (value) => {
    value.title = "First queued edit";
  });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<undefined>();
  let puts = 0;
  f.pod.intercept = (request) => {
    if (request.url === task.url && request.method === "PUT" && ++puts === 1) {
      started.resolve();
      return release.promise;
    }
    return undefined;
  };
  connection = "online";
  f.connect(true);
  await view.render(h(Probe));
  await started.promise;
  const drains = drain.mock.calls.length;
  const enqueue = vi.spyOn(f.outbox, "enqueue");
  const editing = store.updateTask(first, (value) => {
    value.title = "Queued during replay";
  });
  await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
  release.resolve(undefined);
  await editing;
  await vi.waitFor(() => expect(f.outbox.pending()).toEqual([]));
  expect(drain.mock.calls.length).toBeGreaterThan(drains);
  expect((await f.remote.readTask(task.url)).task.title).toBe("Queued during replay");
  await view.unmount();
});
