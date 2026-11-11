// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseTask } from "@jeswr/solid-task-model";
import type { Sample } from "@jeswr/suite-insights";
import { ModelError } from "@/apps/tasks/lib/model/errors";
import { TaskStore } from "@/apps/tasks/lib/model/store";
import type { PodSession } from "@/lib/session/pod-session";

export async function readCompletedTasks(session: PodSession): Promise<Sample[]> {
  const store = new TaskStore({
    fetch: session.fetch,
    storage: session.storageUrl,
    webId: session.webId,
  });
  const projects = await store.listProjects(undefined, { strict: true }).catch((error: unknown) => {
    if (
      error instanceof ModelError &&
      [404, 410].includes(error.status) &&
      error.url === store.projects
    )
      return [];
    throw error;
  });
  const points: Sample[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    const container = project.tracker.stateStore;
    if (!container) continue;
    for (const item of await store.listTasks(container, { strict: true })) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const task = parseTask(item.url, item.dataset);
      if (task?.state === "closed" && task.endedAt) points.push({ at: task.endedAt, value: 1 });
    }
  }
  return points;
}
