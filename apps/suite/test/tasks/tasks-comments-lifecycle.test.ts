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

  it("re-copies edits made after the snapshot using the same destination URLs before cleanup", async () => {
    const { store, pod, source, target, task, comments, root, reply } = await setup();
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url) {
        await comments.edit(root, "Latest root");
        await comments.edit(reply, "Latest reply");
      }
    };
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.text).toBe("Latest root");
    expect(threads[0]?.replies.map((entry) => entry.text)).toEqual(["Latest reply"]);
    for (const comment of [threads[0]?.root, threads[0]?.replies[0]]) {
      const writes = pod.mutations().filter((r) => r.method === "PUT" && r.url === comment?.url);
      expect(writes).toHaveLength(2);
      expect(writes[0]?.headers.get("If-None-Match")).toBe("*");
      expect(writes[1]?.headers.get("If-Match")).toBe('"1"');
    }
    for (const comment of [root, reply]) {
      expect(pod.files.has(comment.url)).toBe(false);
      expect(
        pod
          .mutations()
          .find((r) => r.method === "DELETE" && r.url === comment.url)
          ?.headers.get("If-Match"),
      ).toBe('"2"');
    }
  });

  it("includes new roots and replies posted after the snapshot with remapped targets", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url) {
        await comments.reply(root, "Late reply");
        const lateRoot = await comments.create("Late root");
        await comments.reply(lateRoot, "Late root reply");
      }
    };
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(2);
    expect(
      threads.find((thread) => thread.root.text === "Root")?.replies.map((r) => r.text),
    ).toEqual(["Reply", "Late reply"]);
    expect(threads.find((thread) => thread.root.text === "Late root")?.replies[0]?.text).toBe(
      "Late root reply",
    );
    for (const { root: copied, replies } of threads) {
      expect(copied.target).toBe(moved.task.id);
      expect(replies.every((entry) => entry.target === copied.id)).toBe(true);
    }
    expect(await comments.list()).toEqual([]);
    expect(
      [...pod.files.keys()].filter(
        (url) => url.startsWith(comments.container) && url.endsWith(".ttl"),
      ),
    ).toEqual([]);
  });

  it("retains a revision edited during conditional cleanup and reconciles it on Retry", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let edited = false;
    pod.intercept = async (request) => {
      if (!edited && request.method === "DELETE" && request.url === root.url) {
        edited = true;
        await comments.edit(root, "Edited during cleanup");
      }
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(pod.files.has(root.url)).toBe(true);
    expect(pod.files.has(task.url)).toBe(false);
    pod.intercept = undefined;
    const moved = await move.run();
    expect((await store.comments(target, moved).list())[0]?.root.text).toBe(
      "Edited during cleanup",
    );
    expect(pod.files.has(root.url)).toBe(false);
  });

  it("finds a reply posted during root cleanup even after the source root has gone", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let lateReply: Awaited<ReturnType<typeof comments.reply>> | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === root.url)
        lateReply = await comments.reply(root, "During cleanup");
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(lateReply).toBeDefined();
    expect(pod.files.has(root.url)).toBe(false);
    expect(pod.files.has(lateReply?.url as string)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies.map((r) => r.text)).toEqual(["Reply", "During cleanup"]);
    expect(threads[0]?.replies.every((entry) => entry.target === threads[0]?.root.id)).toBe(true);
    expect(pod.files.has(lateReply?.url as string)).toBe(false);
  });

  it.each([
    403,
    503,
    "redirect",
  ])("leaves source comments intact when cleanup cannot re-read them (%s)", async (failure) => {
    const { store, pod, source, target, task, root, reply } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    pod.intercept = (request) => {
      if (!pod.files.has(task.url) && request.method === "GET" && request.url === reply.url) {
        if (typeof failure === "number") return new Response(null, { status: failure });
        const response = new Response(pod.files.get(reply.url)?.body, {
          headers: { "Content-Type": "text/turtle" },
        });
        Object.defineProperty(response, "url", { value: "https://foreign.test/comment.ttl" });
        return response;
      }
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    for (const comment of [root, reply]) expect(pod.files.has(comment.url)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    expect((await store.comments(target, moved).list())[0]?.replies).toHaveLength(1);
    for (const comment of [root, reply]) expect(pod.files.has(comment.url)).toBe(false);
  });

  it("bounds reconciliation to three passes while comments keep changing, then resumes on Retry", async () => {
    const { store, pod, source, target, task, comments, root, reply } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let passes = 0;
    pod.intercept = async (request) => {
      if (
        !pod.files.has(task.url) &&
        request.method === "GET" &&
        request.url === comments.container
      ) {
        const dataset = await pod.dataset(root.url);
        const body = [...node(root.id, dataset).nodes("http://www.w3.org/ns/oa#hasBody")][0];
        if (!body) throw new Error("Missing body");
        body.setText("http://www.w3.org/1999/02/22-rdf-syntax-ns#value", `Revision ${++passes}`);
        pod.seed(root.url, await serialize(dataset));
      }
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(passes).toBe(3);
    for (const comment of [root, reply]) expect(pod.files.has(comment.url)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.text).toBe("Revision 3");
    for (const comment of [root, reply]) expect(pod.files.has(comment.url)).toBe(false);
  });

  it.each([
    "edit",
    "reply",
  ])("retries a failed reconciliation copy of a late %s at its reserved destination", async (change) => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let failedUrl: string | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url) {
        if (change === "edit") await comments.edit(root, "Late edit");
        else await comments.reply(root, "Late reply");
      }
      if (!pod.files.has(task.url) && request.method === "PUT" && request.url.endsWith(".ttl")) {
        failedUrl = request.url;
        return new Response(null, { status: 503 });
      }
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(failedUrl).toBeDefined();
    expect(pod.files.has(root.url)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(1);
    if (change === "edit")
      expect(threads[0]?.root).toMatchObject({ url: failedUrl, text: "Late edit" });
    else
      expect(threads[0]?.replies.find((entry) => entry.text === "Late reply")?.url).toBe(failedUrl);
    expect(await comments.list()).toEqual([]);
  });

  it.each([
    "cleanup",
    "Retry",
  ])("keeps a destination edit with an unchanged source during %s", async (stage) => {
    const { store, pod, source, target, task, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    const editDestination = async () => {
      const moved = await store.readTask(`${target.tracker.stateStore}moved.ttl`);
      const destination = store.comments(target, moved);
      const copied = (await destination.list())[0]?.root;
      if (!copied) throw new Error("Missing copied root");
      await destination.edit(copied, "Destination edit");
      return copied.url;
    };
    let destinationUrl: string | undefined;
    pod.intercept = async (request) => {
      if (stage === "cleanup" && request.method === "DELETE" && request.url === task.url)
        destinationUrl = await editDestination();
      if (stage === "Retry" && request.method === "DELETE" && request.url === root.url)
        return new Response(null, { status: 503 });
    };
    if (stage === "Retry") {
      await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
      destinationUrl = await editDestination();
      pod.intercept = undefined;
    }
    const moved = await move.run();
    expect(pod.files.has(task.url)).toBe(false);
    expect(pod.files.has(root.url)).toBe(false);
    expect((await store.comments(target, moved).list())[0]?.root.text).toBe("Destination edit");
    // The initial copy and the destination user's edit are the only writes.
    expect(
      pod
        .mutations()
        .filter((request) => request.method === "PUT" && request.url === destinationUrl),
    ).toHaveLength(2);
  });

  it.each([
    false,
    true,
  ])("confirms an uncertain reconciliation PUT before copying a newer source revision (%s)", async (newerSource) => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let attemptedUrl: string | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url)
        await comments.edit(root, "Reconciled revision");
      if (
        !pod.files.has(task.url) &&
        request.method === "PUT" &&
        request.url.startsWith(`${target.tracker.stateStore}comments/`) &&
        request.url.endsWith(".ttl")
      ) {
        attemptedUrl = request.url;
        pod.seed(request.url, request.body);
        throw new TypeError("Reconciliation response lost");
      }
      if (attemptedUrl === request.url && request.method === "GET")
        return new Response(null, { status: 503 });
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    expect(attemptedUrl).toBeDefined();
    expect(pod.files.has(task.url)).toBe(false);
    expect(pod.files.has(root.url)).toBe(true);
    pod.intercept = undefined;
    if (newerSource) {
      const latest = (await comments.list())[0]?.root;
      if (!latest) throw new Error("Missing source root");
      await comments.edit(latest, "Newer source revision");
    }
    const moved = await move.run();
    expect((await store.comments(target, moved).list())[0]?.root).toMatchObject({
      url: attemptedUrl,
      text: newerSource ? "Newer source revision" : "Reconciled revision",
    });
    const writes = pod.mutations().filter((r) => r.method === "PUT" && r.url === attemptedUrl);
    expect(writes.map((r) => r.headers.get("If-Match"))).toEqual(
      newerSource ? [null, '"1"', '"2"'] : [null, '"1"'],
    );
    expect(await comments.list()).toEqual([]);
  });

  it("reports a differing destination after an uncertain PUT without overwriting it", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    let attemptedUrl: string | undefined;
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url)
        await comments.edit(root, "Source edit");
      if (!pod.files.has(task.url) && request.method === "PUT" && request.url.endsWith(".ttl")) {
        attemptedUrl = request.url;
        pod.seed(request.url, request.body);
        throw new TypeError("Reconciliation response lost");
      }
      if (attemptedUrl === request.url && request.method === "GET")
        return new Response(null, { status: 503 });
    };
    await expect(move.run()).rejects.toThrow("Some comments are still moving. Retry");
    pod.intercept = undefined;
    const moved = await store.readTask(`${target.tracker.stateStore}moved.ttl`);
    const destination = store.comments(target, moved);
    const copied = (await destination.list())[0]?.root;
    if (!copied) throw new Error("Missing copied root");
    await destination.edit(copied, "Destination edit");
    const before = pod.mutations().length;
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(move.run()).rejects.toMatchObject({
        message: "Some comments are still moving. Retry",
        cause: { status: 412, url: attemptedUrl },
      });
    expect(pod.mutations()).toHaveLength(before);
    expect((await destination.list())[0]?.root.text).toBe("Destination edit");
    expect((await comments.list())[0]?.root.text).toBe("Source edit");
  });

  it("keeps the destination version when both source and destination have later edits", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url) {
        const moved = await store.readTask(`${target.tracker.stateStore}moved.ttl`);
        const destination = store.comments(target, moved);
        const copied = (await destination.list())[0]?.root;
        if (!copied) throw new Error("Missing copied root");
        await destination.edit(copied, "Destination edit");
        await comments.edit(root, "Source edit");
      }
    };
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    expect(pod.files.has(root.url)).toBe(false);
    expect((await store.comments(target, moved).list())[0]?.root.text).toBe("Destination edit");
    expect(await comments.list()).toEqual([]);
  });

  it("keeps a destination edit across multiple newer source revisions and cleanup retries", async () => {
    const { store, pod, source, target, task, comments, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === task.url) {
        const moved = await store.readTask(`${target.tracker.stateStore}moved.ttl`);
        const destination = store.comments(target, moved);
        const copied = (await destination.list())[0]?.root;
        if (!copied) throw new Error("Missing copied root");
        await destination.edit(copied, "Destination edit");
        await comments.edit(root, "Source edit");
      }
      if (request.method === "DELETE" && request.url === root.url)
        return new Response(null, { status: 503 });
    };
    await expect(move.run()).rejects.toMatchObject({ cause: { status: 503 } });
    pod.intercept = undefined;
    const latest = (await comments.list())[0]?.root;
    if (!latest) throw new Error("Missing source root");
    await comments.edit(latest, "Newer source edit");
    const moved = await move.run();
    expect((await store.comments(target, moved).list())[0]?.root.text).toBe("Destination edit");
    expect(await comments.list()).toEqual([]);
  });

  it("reconciles a lost source comment DELETE response without duplicating its destination", async () => {
    const { store, pod, source, target, task, root } = await setup();
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url === root.url) {
        pod.files.delete(root.url);
        throw new TypeError("Comment DELETE response lost");
      }
    };
    const moved = await store.moveTaskToProject(task, source, target, "moved");
    expect(pod.files.has(root.url)).toBe(false);
    const threads = await store.comments(target, moved).list();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies).toHaveLength(1);
  });

  it("retries comment cleanup after the move commits without recreating the source", async () => {
    const { store, pod, source, target, task, root } = await setup();
    const move = store.prepareTaskMove(task, source, target, "moved");
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === root.url
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(move.run()).rejects.toMatchObject({
      message: "Some comments are still moving. Retry",
      cause: { status: 503 },
    });
    expect(pod.files.has(task.url)).toBe(false);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    expect(pod.files.has(root.url)).toBe(false);
    expect((await store.comments(target, moved).list())[0]?.replies).toHaveLength(1);
  });
});
