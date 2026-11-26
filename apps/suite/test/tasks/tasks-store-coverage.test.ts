// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, describe, expect, it, vi } from "vitest";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import { frameCache } from "./tasks-frame-fixtures";

afterEach(() => vi.restoreAllMocks());

describe("task store edge cases", () => {
  it("leaves a task alone when the revoked member was never its assignee", async () => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Plan" });
    const before = pod.mutations().length;
    expect(await store.unassignInvalidTask(task, "https://bob.example/profile#me")).toBe(false);
    expect(pod.mutations()).toHaveLength(before);
  });

  it("still deletes a task whose comments folder cannot be located", async () => {
    const { store, inbox, pod } = await frameCache();
    const task = await store.createTask(inbox, { state: "open", title: "Plan" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const odd = {
      ...task,
      task: { ...task.task, id: `${task.url}#other` },
    } as unknown as StoredTask;
    await store.deleteTask(odd);
    expect(pod.files.has(task.url)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "Tasks: cannot locate comments of a deleted task.",
      expect.any(TypeError),
    );
  });

  it("ignores foreign and nested entries that a comments listing advertises on project deletion", async () => {
    const { store, pod } = await frameCache();
    const project = await store.createProject("Doomed");
    const task = await store.createTask(project, { state: "open", title: "Discuss" });
    const comments = store.comments(project, task);
    const root = await comments.create("Root");
    const listing = await pod.dataset(comments.container);
    for (const url of ["https://evil.test/steal.ttl", `${comments.container}nested/child.ttl`])
      node(comments.container, listing).iris(`${NS.LDP}contains`).add(url);
    pod.seed(comments.container, await serialize(listing));
    await store.deleteProject(project);
    expect(pod.files.has(root.url)).toBe(false);
    expect(pod.requests.some((request) => request.url.startsWith("https://evil.test"))).toBe(false);
    expect(pod.requests.some((request) => request.url.endsWith("nested/child.ttl"))).toBe(false);
  });
});
