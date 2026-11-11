// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { TaskCommentStore } from "../../src/apps/tasks/lib/model/comments";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { now, storage, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const OA = "http://www.w3.org/ns/oa#";
const bob = "https://bob.test/profile#me";
async function setup() {
  const fixture = await frameCache();
  const task = await fixture.store.createTask(fixture.inbox, { state: "open", title: "Discuss" });
  const comments = fixture.store.comments(fixture.inbox, task);
  return { ...fixture, task, comments };
}
describe("task annotations", () => {
  it("uses a discovered stateStore instead of guessing the task folder from the tracker URL", async () => {
    const { store, inbox, pod } = await frameCache();
    const folder = `${storage}legacy/issues/`;
    await pod.emptyContainer(folder);
    inbox.tracker.stateStore = folder;
    const task = await store.createTask(inbox, { state: "open", title: "Legacy task" });
    const comments = store.comments(inbox, task);
    expect(comments.container).toBe(`${folder}comments/`);
    expect((await comments.create("Comment")).target).toBe(task.task.id);
  });
  it("breaks creation-time ties by resource URL and rejects replies targeting replies", async () => {
    const { comments, pod } = await setup();
    const a = await comments.create("A", webId, now);
    const b = await comments.create("B", webId, now);
    expect((await comments.list()).map(({ root }) => root.url)).toEqual([a.url, b.url].sort());
    const reply = await comments.reply(a, "Reply");
    const nested = await comments.reply(a, "Malformed nested reply");
    const data = await pod.dataset(nested.url);
    node(nested.id, data).setIri(`${OA}hasTarget`, reply.id);
    pod.seed(nested.url, await serialize(data));
    await expect(comments.edit(nested, "No nesting")).rejects.toThrow("Invalid reply target");
  });
  it("lazily creates a project comments container and writes a TextualBody targeting task#it", async () => {
    const { comments, pod, task, inbox } = await setup();
    expect(comments.container).toBe(`${inbox.tracker.stateStore}comments/`);
    expect(await comments.list()).toEqual([]);
    expect(pod.files.has(comments.container)).toBe(false);
    const root = await comments.create('  Plain "text"\nhttps://example.org  ', webId, now);
    const data = await pod.dataset(root.url);
    const annotation = node(root.id, data);
    expect(root).toMatchObject({
      creator: webId,
      created: now.toISOString(),
      kind: "root",
      target: task.task.id,
      deleted: false,
    });
    expect(root.id).toBe(`${root.url}#it`);
    expect([...annotation.types]).toEqual([`${OA}Annotation`]);
    expect(annotation.iri(`${OA}motivatedBy`)).toBe(`${OA}commenting`);
    expect(annotation.iri(`${OA}hasTarget`)).toBe(`${task.url}#it`);
    expect(annotation.nodes(`${OA}hasSelector`).size).toBe(0);
    expect(annotation.nodes(`${OA}bodyValue`).size).toBe(0);
    const body = [...annotation.nodes(`${OA}hasBody`)][0];
    expect(body?.termType).toBe("BlankNode");
    expect(body?.types.has(`${OA}TextualBody`)).toBe(true);
    expect(body?.text(`${NS.RDF}value`)).toBe('Plain "text"\nhttps://example.org');
    expect(body?.text("http://purl.org/dc/elements/1.1/format")).toBe("text/plain");
    const writes = pod.mutations().filter((request) => request.url.startsWith(comments.container));
    expect(writes).toHaveLength(2);
    expect(writes.every((request) => request.headers.get("If-None-Match") === "*")).toBe(true);
  });

  it("orders roots and replies oldest first and excludes other tasks' threads", async () => {
    const { comments, store, inbox, pod } = await setup();
    const late = await comments.create("Later", webId, new Date("2026-11-01"));
    const early = await comments.create("Earlier", webId, now);
    const reply = await comments.reply(early, "Reply later", webId, new Date("2026-11-03"));
    const first = await comments.reply(early, "Reply first", webId, new Date("2026-11-02"));
    const other = await store.createTask(inbox, { state: "open", title: "Other" });
    const foreign = store.comments(inbox, other);
    const foreignRoot = await foreign.create("Other task");
    const foreignReply = await foreign.reply(foreignRoot, "Other reply");
    const replyNode = node(reply.id, await pod.dataset(reply.url));
    expect(replyNode.iri(`${OA}motivatedBy`)).toBe(`${OA}replying`);
    expect(replyNode.iri(`${OA}hasTarget`)).toBe(early.id);
    expect(await comments.list()).toEqual([
      { root: early, replies: [first, reply] },
      { root: late, replies: [] },
    ]);
    await expect(comments.reply(reply, "nested")).rejects.toThrow("Invalid reply target");
    await expect(comments.edit(foreignReply, "wrong task")).rejects.toThrow(
      "Invalid comment target",
    );
  });

  it("edits conditionally, preserves creation and foreign metadata, and adds modified", async () => {
    const { comments, pod } = await setup();
    const root = await comments.create("Before", webId, now);
    const data = await pod.dataset(root.url);
    node(root.id, data).setText(`${NS.DCT}description`, "Preserved");
    pod.seed(root.url, await serialize(data));
    const entry = (await comments.list())[0]?.root;
    if (!entry) throw new Error("Missing root");
    const editedAt = new Date("2026-11-04T10:00:00Z");
    await comments.edit(entry, "  After  ", editedAt);
    const updated = node(root.id, await pod.dataset(root.url));
    expect(updated.date(`${NS.DCT}created`)).toEqual(now);
    expect(updated.date(`${NS.DCT}modified`)).toEqual(editedAt);
    expect(updated.text(`${NS.DCT}description`)).toBe("Preserved");
    expect((await comments.list())[0]?.root.text).toBe("After");
    expect(pod.mutations().at(-1)?.headers.get("If-Match")).toBe(entry.etag);
    const count = pod.mutations().length;
    await expect(comments.edit(entry, "Stale")).rejects.toMatchObject({ status: 412 });
    await expect(comments.delete(entry)).rejects.toMatchObject({ status: 412 });
    expect(pod.mutations()).toHaveLength(count);
  });

  it("deletes replies and empty roots, and tombstones roots with replies", async () => {
    const { comments, pod } = await setup();
    const empty = await comments.create("No replies");
    await comments.delete(empty);
    expect(pod.files.has(empty.url)).toBe(false);
    expect(pod.mutations().at(-1)).toMatchObject({ method: "DELETE", url: empty.url });
    expect(pod.mutations().at(-1)?.headers.get("If-Match")).toBe(empty.etag);
    const root = await comments.create("Parent");
    const reply = await comments.reply(root, "Keep me");
    const tombstonedAt = new Date("2026-11-04");
    await comments.delete(root, tombstonedAt);
    const thread = (await comments.list())[0];
    expect(thread?.root).toMatchObject({
      text: "[Comment deleted]",
      deleted: true,
      creator: webId,
    });
    expect(thread?.replies).toEqual([reply]);
    const annotation = node(root.id, await pod.dataset(root.url));
    expect(annotation.date(`${NS.DCT}modified`)).toEqual(tombstonedAt);
    expect(annotation.iri(`${OA}hasTarget`)).toBe(root.target);
    if (!thread) throw new Error("Missing thread");
    await expect(comments.edit(thread.root, "Restore")).rejects.toThrow();
    await comments.delete(reply);
    expect(pod.files.has(reply.url)).toBe(false);
    await comments.delete(thread.root);
    expect(await comments.list()).toEqual([]);
  });

  it("enforces session creators and ownership before mutations", async () => {
    const { comments, inbox, task, pod } = await setup();
    const other = new TaskCommentStore(inbox, task, bob, pod.fetch);
    const root = await comments.create("Mine");
    const count = pod.mutations().length;
    await expect(comments.create("Spoof", bob)).rejects.toThrow("signed-in account");
    await expect(comments.reply(root, "Spoof", bob)).rejects.toThrow("signed-in account");
    await expect(other.edit(root, "Stolen")).rejects.toThrow("own comments");
    await expect(other.delete(root)).rejects.toThrow("own comments");
    await expect(comments.create("  ")).rejects.toThrow("Enter a comment");
    await expect(comments.edit(root, "  ")).rejects.toThrow("Enter a comment");
    expect(pod.mutations()).toHaveLength(count);
  });

  it("propagates denied writes and listing failures", async () => {
    const { comments, pod } = await setup();
    pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 403 }) : undefined;
    await expect(comments.create("Denied")).rejects.toMatchObject({ status: 403 });
    pod.intercept = () => new Response(null, { status: 503 });
    await expect(comments.list()).rejects.toMatchObject({ status: 503 });
  });

  it("lets an append-only collaborator create without rewriting the task or project", async () => {
    const { comments, inbox, task, pod } = await setup();
    await comments.create("Owner");
    const collaborator = new TaskCommentStore(inbox, task, bob, pod.fetch);
    const before = pod.mutations().length;
    pod.intercept = (request) =>
      request.method !== "GET" &&
      (!request.url.startsWith(comments.container) || request.headers.has("If-Match"))
        ? new Response(null, { status: 403 })
        : undefined;
    const comment = await collaborator.create("Collaborator");
    expect(comment.creator).toBe(bob);
    expect(pod.mutations().slice(before)).toHaveLength(1);
    expect(pod.mutations().at(-1)?.url).toBe(comment.url);
  });
});
