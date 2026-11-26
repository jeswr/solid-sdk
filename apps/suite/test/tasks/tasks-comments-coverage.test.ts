// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { frameCache } from "./tasks-frame-fixtures";

const OA = "http://www.w3.org/ns/oa#";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const { store, inbox, pod } = await frameCache();
  const task = await store.createTask(inbox, { state: "open", title: "Task" });
  return { comments: store.comments(inbox, task), pod };
}

describe("comment write-permission probe", () => {
  it.each([
    [401, null, false],
    [403, 'user="write"', false],
    [500, 'user="write"', undefined],
    [200, null, undefined],
    [200, 'public="read"', undefined],
    [200, 'user="read"', false],
    [200, 'user="read write"', true],
  ] as const)("HEAD %s with WAC-Allow %s resolves to %s", async (status, header, expected) => {
    const { comments, pod } = await fixture();
    pod.intercept = (request) =>
      request.method === "HEAD"
        ? new Response(null, { status, ...(header ? { headers: { "WAC-Allow": header } } : {}) })
        : undefined;
    expect(await comments.canWrite()).toBe(expected);
  });
  it("leaves the answer unknown when the probe cannot reach the pod", async () => {
    const { comments, pod } = await fixture();
    pod.intercept = () => {
      throw new TypeError("offline");
    };
    expect(await comments.canWrite()).toBeUndefined();
  });
});

describe("strict comment listings and clean-up", () => {
  it("aborts a recoverable move when a comment fails with something other than a malformed-comment error", async () => {
    const { comments } = await fixture();
    await comments.create("Keep");
    vi.spyOn(
      comments as unknown as { parse(resource: unknown): unknown },
      "parse",
    ).mockImplementation(() => {
      throw new ModelError(500, comments.container);
    });
    await expect(
      comments.prepareMove(comments.container, "https://pod.test/t.ttl#it"),
    ).rejects.toMatchObject({ status: 500 });
  });
  it("removes a task's thread but leaves replies that target something else", async () => {
    const { comments, pod } = await fixture();
    const root = await comments.create("Root");
    const reply = await comments.reply(root, "Reply");
    const stray = await comments.reply(root, "Stray");
    const dataset = await pod.dataset(stray.url);
    node(stray.id, dataset).setIri(`${OA}hasTarget`, `${comments.container}ghost.ttl#it`);
    pod.seed(stray.url, await serialize(dataset));
    await comments.removeAll();
    expect(pod.files.has(root.url)).toBe(false);
    expect(pod.files.has(reply.url)).toBe(false);
    expect(pod.files.has(stray.url)).toBe(true);
  });

  it("treats a comment that is already gone while clearing a thread as removed", async () => {
    const { comments, pod } = await fixture();
    const root = await comments.create("Root");
    const reply = await comments.reply(root, "Reply");
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === reply.url
        ? new Response(null, { status: 404 })
        : undefined;
    await comments.removeAll();
    expect(pod.files.has(root.url)).toBe(false);
  });
  it("surfaces any other failure while clearing a thread", async () => {
    const { comments, pod } = await fixture();
    const root = await comments.create("Root");
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === root.url
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(comments.removeAll()).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(root.url)).toBe(true);
  });
});
