// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import { node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { frameCache } from "./tasks-frame-fixtures";

async function setup() {
  const fixture = await frameCache();
  const source = await fixture.store.createProject("Source");
  const target = await fixture.store.createProject("Target");
  const task = await fixture.store.createTask(source, { title: "Discuss", state: "open" });
  const comments = fixture.store.comments(source, task);
  const root = await comments.create("Root");
  return { ...fixture, source, target, task, comments, root };
}

describe("task move comment copy edge cases", () => {
  it("refuses to adopt a destination that appeared before a late copy was attempted", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    const destinations = `${target.tracker.stateStore}comments/`;
    let late: string | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url)
        await comments.reply(root, "Late reply");
      if (
        request.method === "GET" &&
        !pod.files.has(task.url) &&
        request.url.startsWith(destinations) &&
        request.url.endsWith(".ttl") &&
        !pod.files.has(request.url)
      ) {
        late = request.url;
        pod.seed(request.url, '<#it> <http://purl.org/dc/terms/title> "Unrelated" .');
      }
      return undefined;
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(late).toBeDefined();
    expect(pod.files.get(late as string)?.body).toContain("Unrelated");
    expect(pod.mutations().some((r) => r.method === "PUT" && r.url === late)).toBe(false);
    expect(pod.files.has(root.url)).toBe(true);
  });

  it("adopts a late copy whose PUT committed but whose response was lost", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let lost: string | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url)
        await comments.reply(root, "Late reply");
      if (!pod.files.has(task.url) && request.method === "PUT" && request.url.endsWith(".ttl")) {
        lost = request.url;
        pod.seed(request.url, request.body);
        return new Response(null, { status: 503 });
      }
      return undefined;
    };
    const moved = await move.run();
    expect(lost).toBeDefined();
    const threads = await store.comments(target, moved).list();
    expect(threads[0]?.replies.map((reply) => reply.text)).toEqual(["Late reply"]);
    expect(threads[0]?.replies[0]?.url).toBe(lost);
    expect(pod.mutations().filter((r) => r.method === "PUT" && r.url === lost)).toHaveLength(1);
    expect(await comments.list()).toEqual([]);
  });

  it("removes a comment that refers to itself even though no copy is unreferenced", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const dataset = await pod.dataset(root.url);
    node(root.id, dataset).setIri("https://example.test/vocab#seeAlso", root.id);
    pod.seed(root.url, await serialize(dataset));
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    expect(pod.files.has(root.url)).toBe(false);
    expect(await comments.list()).toEqual([]);
    expect(await store.comments(target, moved).list()).toHaveLength(1);
  });

  it("keeps a late copy's reservation when its create was acknowledged but nothing can be read back", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let phantom: string | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url)
        await comments.reply(root, "Late reply");
      if (
        !phantom &&
        !pod.files.has(task.url) &&
        request.method === "PUT" &&
        request.url.endsWith(".ttl")
      ) {
        phantom = request.url;
        return new Response(null, { status: 201 });
      }
      return undefined;
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(phantom).toBeDefined();
    expect(pod.files.has(root.url)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    const threads = await store.comments(target, moved).list();
    expect(threads[0]?.replies.map((reply) => reply.text)).toEqual(["Late reply"]);
    expect(threads[0]?.replies[0]?.url).toBe(phantom);
    expect(await comments.list()).toEqual([]);
  });
});
