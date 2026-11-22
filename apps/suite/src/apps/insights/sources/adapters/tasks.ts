// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch, podScopedUrl, refuseRedirects } from "@jeswr/guarded-fetch";
import { parseTask } from "@jeswr/solid-task-model";
import type { Sample } from "@jeswr/suite-insights";
import { documentUrl, NS, node, Store, serialize } from "@/apps/tasks/lib/model/rdf";
import { TaskStore } from "@/apps/tasks/lib/model/store";
import type { PodSession } from "@/lib/session/pod-session";

function discoveryFetch(session: PodSession, podFetch: typeof fetch): typeof fetch {
  const projects = new URL("tasks/projects/", session.storageUrl).href;
  const profile = documentUrl(session.webId);
  const profileFetch =
    session.mode === "demo" || podScopedUrl(session.storageUrl, profile)
      ? podFetch
      : refuseRedirects((input, init) =>
          session.publicFetch(input, { ...init, credentials: "omit" }),
        );
  let profilePending = true;

  return async (input, init) => {
    const { url } = new Request(input, init);
    const readProfile = profilePending && url === profile;
    if (readProfile) profilePending = false;
    const response = await (readProfile ? profileFetch : podFetch)(input, init);
    if (![404, 410].includes(response.status) || (!readProfile && url !== projects))
      return response;
    // Strict Tasks discovery can continue with an empty default listing or no profile links.
    void response.body?.cancel().catch(() => {});
    const empty = new Store();
    if (!readProfile) node(projects, empty).types.add(`${NS.LDP}BasicContainer`);
    return new Response(await serialize(empty), { headers: { "content-type": "text/turtle" } });
  };
}

export async function readCompletedTasks(session: PodSession): Promise<Sample[]> {
  const podFetch = createPodScopedFetch(session.storageUrl, {
    fetch: refuseRedirects(session.fetch),
  });
  const options = { storage: session.storageUrl, webId: session.webId };
  const discovery = new TaskStore({ ...options, fetch: discoveryFetch(session, podFetch) });
  const projects = await discovery.listProjects(undefined, { strict: true });
  const store = new TaskStore({ ...options, fetch: podFetch });
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
