// AUTHORED-BY Codex GPT-6.1-Sol
import { vi } from "vitest";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, Pod, storage, webId } from "./pod";

export function frameStore(pod: Pod) {
  return new TaskStore({
    storage,
    webId,
    fetch: pod.fetch,
    now: () => now,
    typeIndex: false,
    ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
  });
}
export async function frameCache() {
  const pod = new Pod();
  const store = frameStore(pod);
  const failures = vi.fn();
  const cache = new TasksCache(store, failures, webId);
  await cache.start();
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.loadTasks(inbox);
  return { pod, store, cache, failures, inbox };
}
