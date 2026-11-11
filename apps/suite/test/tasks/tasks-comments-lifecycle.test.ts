// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { DataFactory, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { frameCache } from "./tasks-frame-fixtures";

async function setup() {
  const fixture = await frameCache();
  const source = await fixture.store.createProject("Source");
  const target = await fixture.store.createProject("Target");
  const task = await fixture.store.createTask(source, { title: "Discuss", state: "open" });
  const comments = fixture.store.comments(source, task);
  const root = await comments.create("Root");
  const reply = await comments.reply(root, "Reply");
  return { ...fixture, source, target, task, comments, root, reply };
}

describe("comment lifecycle with projects and task moves", () => {
  it("conditionally empties comments and auxiliary ACLs before deleting the project containers", async () => {
    const { store, pod, source, comments, root, reply } = await setup();
    for (const url of [root.url, reply.url, comments.container]) pod.seed(`${url}.acl`, "");
    const before = pod.mutations().length;
    // Real pods reject deletion of nonempty containers (the general fixture does not).
    pod.intercept = (request) =>
      request.method === "DELETE" &&
      request.url.endsWith("/") &&
      [...pod.files.keys()].some((url) => url !== request.url && url.startsWith(request.url))
        ? new Response(null, { status: 409 })
        : undefined;
    await store.deleteProject(source);
    expect(
      [...pod.files.keys()].some((url) => url.startsWith(source.tracker.stateStore as string)),
    ).toBe(false);
    expect(pod.files.has(source.url)).toBe(false);
    const deletes = pod
      .mutations()
      .slice(before)
      .filter((request) => request.method === "DELETE");
    const order = deletes.map((request) => request.url);
    for (const url of [root.url, reply.url]) {
      expect(order.indexOf(url)).toBeLessThan(order.indexOf(comments.container));
      expect(order.indexOf(`${url}.acl`)).toBeLessThan(order.indexOf(comments.container));
    }
    expect(order.indexOf(comments.container)).toBeLessThan(
      order.indexOf(source.tracker.stateStore as string),
    );
    expect(deletes.every((request) => /^"/.test(request.headers.get("If-Match") ?? ""))).toBe(true);
  });

  it.each([
    403, 412, 503,
  ])("aborts project deletion on a comment DELETE failure (%s) and resumes on retry", async (status) => {
    const { store, pod, source, comments, root } = await setup();
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === root.url
        ? new Response(null, { status })
        : undefined;
    await expect(store.deleteProject(source)).rejects.toMatchObject({ status });
    for (const url of [
      root.url,
      comments.container,
      source.tracker.stateStore as string,
      source.url,
    ])
      expect(pod.files.has(url)).toBe(true);
    pod.intercept = undefined;
    await store.deleteProject(source);
    expect(pod.files.has(comments.container)).toBe(false);
  });

  it("copies only the moved task's threads, remaps targets, and preserves metadata before source deletion", async () => {
    const { store, pod, source, target, task, root, reply } = await setup();
    const otherTask = await store.createTask(source, { title: "Other", state: "open" });
    const otherComments = store.comments(source, otherTask);
    const other = await otherComments.create("Stay here");
    const data = await pod.dataset(root.url);
    const annotation = node(root.id, data);
    annotation.setText("https://example.test/note", "Preserve me");
    const body = [...annotation.nodes("http://www.w3.org/ns/oa#hasBody")][0];
    if (!body) throw new Error("Missing body");
    const namedBody = node(`${root.url}#body`, data);
    for (const quad of [...data.match(DataFactory.blankNode(body.value))]) {
      for (const value of body.nodes(quad.predicate.value))
        namedBody.nodes(quad.predicate.value).add(value);
    }
    annotation.setIri("http://www.w3.org/ns/oa#hasBody", namedBody.value);
    pod.seed(root.url, await serialize(data));
    const before = pod.mutations().length;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url) {
        const destinationTask = await store.readTask(`${target.tracker.stateStore}moved.ttl`);
        const threads = await store.comments(target, destinationTask).list();
        expect(threads).toHaveLength(1);
        expect(threads[0]?.replies[0]?.text).toBe("Reply");
        expect(pod.files.has(root.url)).toBe(true);
        expect(pod.files.has(reply.url)).toBe(true);
      }
    };
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(1);
    const copied = threads[0];
    if (!copied) throw new Error("Missing copied thread");
    expect(copied.root).toMatchObject({
      text: root.text,
      creator: root.creator,
      created: root.created,
      target: moved.task.id,
    });
    expect(copied.replies[0]).toMatchObject({
      text: reply.text,
      creator: reply.creator,
      created: reply.created,
      target: copied.root.id,
    });
    expect(
      node(copied.root.id, await pod.dataset(copied.root.url)).text("https://example.test/note"),
    ).toBe("Preserve me");
    expect(pod.files.has(root.url)).toBe(false);
    expect(pod.files.has(reply.url)).toBe(false);
    expect((await otherComments.list())[0]?.root.url).toBe(other.url);
    const writes = pod.mutations().slice(before);
    const commit = writes.findIndex(
      (request) => request.method === "DELETE" && request.url === task.url,
    );
    for (const comment of [copied.root, ...copied.replies]) {
      const index = writes.findIndex(
        (request) => request.method === "PUT" && request.url === comment.url,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(commit);
      expect(writes[index]?.headers.get("If-None-Match")).toBe("*");
    }
    for (const comment of [root, reply])
      expect(
        writes.findIndex((request) => request.method === "DELETE" && request.url === comment.url),
      ).toBeGreaterThan(commit);
  });

  it.each([
    "copy",
    "source",
    "read",
    "redirect",
  ])("compensates a %s failure and retries without losing threads", async (stage) => {
    const { store, pod, source, target, task, comments, root, reply } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let copies = 0;
    pod.intercept = (request) => {
      if (
        stage === "copy" &&
        request.method === "PUT" &&
        request.url.startsWith(`${target.tracker.stateStore}comments/`) &&
        request.url.endsWith(".ttl") &&
        ++copies === 2
      )
        return new Response(null, { status: 503 });
      if (stage === "source" && request.method === "DELETE" && request.url === task.url)
        return new Response(null, { status: 412 });
      if (stage === "read" && request.method === "GET" && request.url === reply.url)
        return new Response(null, { status: 403 });
      if (stage === "redirect" && request.method === "GET" && request.url === reply.url) {
        const response = new Response(pod.files.get(reply.url)?.body, {
          headers: { "Content-Type": "text/turtle" },
        });
        Object.defineProperty(response, "url", { value: "https://foreign.test/comment.ttl" });
        return response;
      }
    };
    await expect(move.run()).rejects.toThrow();
    for (const url of [task.url, root.url, reply.url]) expect(pod.files.has(url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(false);
    expect(
      [...pod.files.keys()].filter(
        (url) => url.startsWith(`${target.tracker.stateStore}comments/`) && url.endsWith(".ttl"),
      ),
    ).toEqual([]);
    pod.intercept = undefined;
    const moved = await move.run();
    expect((await store.comments(target, moved).list())[0]?.replies).toHaveLength(1);
    expect(await comments.list()).toEqual([]);
  });

  it("reconciles a lost comment copy response and finishes cleanup after a lost task DELETE response", async () => {
    const { store, pod, source, target, task, root, reply } = await setup();
    let lost = false;
    pod.intercept = (request) => {
      if (
        !lost &&
        request.method === "PUT" &&
        request.url.startsWith(`${target.tracker.stateStore}comments/`) &&
        request.url.endsWith(".ttl")
      ) {
        lost = true;
        pod.seed(request.url, request.body);
        throw new TypeError("Copy response lost");
      }
      if (request.method === "DELETE" && request.url === task.url) {
        pod.files.delete(task.url);
        throw new TypeError("Task DELETE response lost");
      }
    };
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    expect((await store.comments(target, moved).list())[0]?.replies).toHaveLength(1);
    for (const url of [task.url, root.url, reply.url]) expect(pod.files.has(url)).toBe(false);
  });

  it("retries comment cleanup after the move commits without recreating the source", async () => {
    const { store, pod, source, target, task, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === root.url
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(move.run()).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(task.url)).toBe(false);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    expect(pod.files.has(root.url)).toBe(false);
    expect((await store.comments(target, moved).list())[0]?.replies).toHaveLength(1);
  });
});
