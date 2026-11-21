// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { NS } from "../../src/apps/tasks/lib/model/rdf";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import { editableViews } from "../../src/apps/tasks/state/bulk-actions";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { webId } from "./pod";
import { containerUrl, issuesFixture } from "./tasks-issues-fixtures";

it("leaves read-only and unknown issues out of bulk actions", async () => {
  const { store, pod, project } = await issuesFixture();
  const cache = new TasksCache(store, vi.fn(), webId);
  await cache.start();
  await cache.loadTasks(project);
  const editable = await cache.createTask(project, { title: "Editable" });
  const locked = await cache.createTask(project, { title: "Locked" });
  if (!editable || !locked) throw new Error("Missing fixture");
  pod.intercept = (request) =>
    request.method === "GET" && request.url === locked.url
      ? new Response(pod.files.get(locked.url)?.body, {
          headers: { "Content-Type": "text/turtle", ETag: '"1"', "WAC-Allow": 'user="read"' },
        })
      : request.method === "GET" && request.url === containerUrl
        ? new Response(
            `<${containerUrl}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${editable.url}>, <${locked.url}>.`,
            { headers: { "Content-Type": "text/turtle", "WAC-Allow": 'user="read write append"' } },
          )
        : undefined;
  await cache.loadTasks(project, true);
  const view = (url: string, projectUrl = project.url) => ({ url, projectUrl }) as TaskView;
  const other = view("https://pod.test/task.ttl", "https://pod.test/p.ttl");
  expect(
    editableViews(
      [view(editable.url), view(locked.url), view(`${containerUrl}missing.ttl`), other],
      { cache },
    ).map((item) => item.url),
  ).toEqual([editable.url, other.url]);
});

it("passes every view through for an ordinary Tasks store", () => {
  const views = [{ url: "a", projectUrl: "p" }] as TaskView[];
  const cache = { store: {}, getSnapshot: () => ({ projects: [], tasks: {} }) };
  expect(editableViews(views, { cache } as never)).toEqual(views);
});
