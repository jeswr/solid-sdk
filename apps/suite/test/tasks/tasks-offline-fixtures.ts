// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox } from "@jeswr/suite-sdk/offline";
import { afterEach, vi } from "vitest";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { OfflineTaskStore, TASKS_REPLAY, TasksOffline } from "../../src/apps/tasks/state/offline";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { createRealOutbox } from "../../src/shell/lib/real-outbox";
import { now, Pod, storage, webId } from "./pod";

const { IDBFactory } = createRequire(
  new URL("../../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
  vi.restoreAllMocks();
});
export async function setupOffline(register = true) {
  const pod = new Pod();
  let online = true;
  const outbox = createOutbox({ webId, idb: new IDBFactory() });
  cleanups.push(() => outbox.close());
  await outbox.ready;
  const values = new Map<string, string>();
  const cacheStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const transport: typeof fetch = (input, init) => {
    if (!online) return Promise.reject(new TypeError("Offline"));
    return pod.fetch(input, init);
  };
  const offlineOptions = {
    webId,
    storageUrl: storage,
    fetch: transport,
    online: () => online,
    outbox: () => outbox,
    storage: cacheStorage,
  };
  const offline = new TasksOffline(offlineOptions);
  if (register) outbox.registerDelegate(TASKS_REPLAY, offline.replay);
  const storeOptions = {
    storage,
    webId,
    fetch: offline.fetch,
    now: () => now,
    typeIndex: false,
    ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
  };
  const store = new OfflineTaskStore(storeOptions, () => online, offline.together);
  const remote = new TaskStore({ ...storeOptions, fetch: pod.fetch });
  const failures = vi.fn();
  const cache = new TasksCache(store, failures, webId);
  offline.subscribeReceipts(cache.confirmOfflineWrite);
  await cache.start();
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.loadTasks(inbox);
  const raw = createMemoryStorage({ root: storage });
  vi.spyOn(raw, "head").mockImplementation(async (url) => {
    const response = await pod.fetch(url);
    return { url, etag: response.headers.get("ETag") } as Awaited<
      ReturnType<StorageClient["head"]>
    >;
  });
  const adapter = createRealOutbox({
    outbox,
    storage: () => raw,
    signal: new AbortController().signal,
  });
  cleanups.push(() => adapter.dispose());
  return {
    pod,
    cache,
    store,
    inbox,
    outbox,
    failures,
    offline,
    offlineOptions,
    storeOptions,
    adapter,
    raw,
    remote,
    connect: (next: boolean) => {
      online = next;
    },
  };
}
