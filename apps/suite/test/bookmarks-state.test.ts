// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { BookmarkRepository, StoredBookmark } from "@jeswr/solid-bookmark/pod";
import { describe, expect, it, vi } from "vitest";
import { createLibraryStore } from "../src/apps/bookmarks/state/library-store";

const record = (id = "one"): StoredBookmark => ({
  url: `https://pod.example/bookmarks/${id}.ttl`,
  etag: '"1"',
  data: { url: "https://example.org/", title: "Original", tags: ["old"] },
});
function setup() {
  const first = record();
  const repo: BookmarkRepository = {
    initialize: vi.fn(async () => {}),
    list: vi.fn(async () => [first]),
    create: vi.fn(async (data) => ({
      url: "https://pod.example/bookmarks/new.ttl",
      etag: '"new"',
      data,
    })),
    update: vi.fn(async (previous, patch) => ({
      ...previous,
      etag: '"2"',
      data: { ...previous.data, ...patch },
    })),
    remove: vi.fn(async () => {}),
  };
  const failure = vi.fn();
  const store = createLibraryStore(repo, failure);
  return { repo, failure, store, first };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("optimistic bookmark library", () => {
  it("tags an untagged record and drops edits to a create that failed", async () => {
    const { store, repo, first, failure } = setup();
    vi.mocked(repo.list).mockResolvedValue([{ ...first, data: { url: first.data.url } }]);
    await store.load();
    await store.tag([first.url], "new");
    expect(store.getSnapshot().items[0]?.data.tags).toEqual(["new"]);
    const creating = deferred<StoredBookmark>();
    vi.mocked(repo.create).mockReturnValueOnce(creating.promise);
    const add = store.add([{ id: "local", data: { url: "https://example.net/" } }]);
    const edit = store.edit(["local"], { title: "Queued edit" });
    creating.reject(new Error("Create failed"));
    await add;
    await edit;
    expect(store.getSnapshot().items).toHaveLength(1);
    expect(failure).toHaveBeenCalledOnce();
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
  it("does not start queued writes after the session is disposed", async () => {
    const { store, repo, first } = setup();
    await store.load();
    const write = store.edit([first.url], { title: "Pending" });
    store.dispose();
    await write;
    expect(repo.update).not.toHaveBeenCalled();
  });
  it("stops a bulk write between records after account teardown", async () => {
    const { store, repo, first } = setup();
    vi.mocked(repo.list).mockResolvedValue([first, record("two")]);
    await store.load();
    const pending = deferred<StoredBookmark>();
    vi.mocked(repo.update).mockReturnValueOnce(pending.promise);
    const write = store.edit([first.url, record("two").url], { title: "Pending" });
    await Promise.resolve();
    store.dispose();
    pending.resolve(first);
    await write;
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
  it("does not publish an in-flight save which settles after account teardown", async () => {
    const { store, repo, first, failure } = setup();
    await store.load();
    const pending = deferred<StoredBookmark>();
    vi.mocked(repo.update).mockReturnValueOnce(pending.promise);
    const write = store.edit([first.url], { title: "Pending" });
    await Promise.resolve();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();
    pending.reject(new Error("Late failure"));
    await write;
    expect(listener).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });
  it("keeps local IDs stable on refresh and skips unchanged fields and duplicate tags", async () => {
    const { store, repo, first } = setup();
    await store.load();
    await store.edit([first.url], { title: "Original" });
    await store.tag([first.url], "old");
    expect(repo.update).not.toHaveBeenCalled();
    await store.add([{ id: "local", data: { url: "https://example.net/", title: "New" } }]);
    const created = await vi.mocked(repo.create).mock.results[0]?.value;
    if (!created) throw new Error("Missing created fixture");
    vi.mocked(repo.list).mockResolvedValue([first, created]);
    await store.load();
    expect(store.getSnapshot().items.map((item) => item.id)).toEqual([first.url, "local"]);
    await store.edit(["local"], { title: "Still editable" });
    expect(store.getSnapshot().items[1]?.data.title).toBe("Still editable");
  });
  it("loads and publishes stable snapshots to subscribers", async () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot().status).toBe("loading");
    await store.load();
    expect(store.getSnapshot().status).toBe("ready");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await store.load();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("makes adds, edits, archive, bulk tags and delete visible immediately", async () => {
    const { store, first, repo } = setup();
    await store.load();
    const edit = store.edit([first.url], { title: "New", archived: true });
    expect(store.getSnapshot().items[0]?.data.title).toBe("New");
    expect(store.getSnapshot().saving).toBe(1);
    await edit;
    await store.tag([first.url], " new ");
    expect(store.getSnapshot().items[0]?.data.tags).toEqual(["new", "old"]);
    await store.tag([first.url], " ");
    expect(repo.update).toHaveBeenCalledTimes(2);
    const add = store.add([{ id: "local", data: { url: "https://example.net/" } }]);
    expect(store.getSnapshot().items).toHaveLength(2);
    await add;
    const undo = store.remove([first.url]);
    expect(store.getSnapshot().items).toHaveLength(1);
    undo();
    expect(store.getSnapshot().items).toHaveLength(2);
    await store.settled();
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().saving).toBe(0);
  });
  it("rolls back both failed edits without resurrecting an unconfirmed value", async () => {
    const { store, repo, failure, first } = setup();
    await store.load();
    const pending = deferred<StoredBookmark>();
    vi.mocked(repo.update)
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new Error("second"));
    const one = store.edit([first.url], { title: "First edit" });
    const two = store.edit([first.url], { title: "Second edit", notes: "New note" });
    expect(store.getSnapshot().items[0]?.data.title).toBe("Second edit");
    pending.reject(new Error("first"));
    await one;
    await two;
    expect(store.getSnapshot().items[0]?.data).toEqual(first.data);
    expect(failure).toHaveBeenCalledTimes(2);
  });
  it("keeps newer changes to unrelated fields and uses confirmed versions in order", async () => {
    const { store, repo, first } = setup();
    await store.load();
    vi.mocked(repo.update).mockRejectedValueOnce(new Error("offline"));
    void store.edit([first.url], { archived: true });
    await store.edit([first.url], { title: "Keep me" });
    expect(store.getSnapshot().items[0]?.data).toMatchObject({ title: "Keep me" });
    expect(store.getSnapshot().items[0]?.data.archived).toBeUndefined();
    await store.tag([first.url], "x");
    expect(vi.mocked(repo.update).mock.calls[2]?.[0].etag).toBe('"2"');
  });
  it("undoes a failed delete without creating a duplicate", async () => {
    const { store, repo, first, failure } = setup();
    await store.load();
    vi.mocked(repo.remove).mockRejectedValueOnce(new Error("denied"));
    const undo = store.remove([first.url]);
    undo();
    await store.settled();
    expect(store.getSnapshot().items).toHaveLength(1);
    expect(repo.create).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
  });
  it("handles partial bulk failures and ignores missing records", async () => {
    const { store, repo, first } = setup();
    vi.mocked(repo.list).mockResolvedValue([first, record("two")]);
    await store.load();
    vi.mocked(repo.update).mockRejectedValueOnce(new Error("conflict"));
    await store.edit([first.url, record("two").url, "missing"], { archived: true });
    expect(store.getSnapshot().items.map((item) => Boolean(item.data.archived))).toEqual([
      false,
      true,
    ]);
    vi.mocked(repo.create).mockRejectedValueOnce(new Error("create failure"));
    await store.add([{ id: "failed", data: { url: "https://example.net/" } }]);
    expect(store.getSnapshot().items).toHaveLength(2);
  });
  it("fences stale refreshes and reports read errors, clearing denied data", async () => {
    const { store, repo, first } = setup();
    await store.load();
    const slow = deferred<StoredBookmark[]>();
    vi.mocked(repo.list).mockReturnValueOnce(slow.promise);
    const read = store.load();
    await store.edit([first.url], { title: "Keep" });
    slow.resolve([first]);
    await read;
    expect(store.getSnapshot().items[0]?.data.title).toBe("Keep");
    vi.mocked(repo.list).mockRejectedValueOnce(new Error("offline"));
    await store.load();
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().items).toHaveLength(1);
    vi.mocked(repo.list).mockRejectedValueOnce({ code: "forbidden" });
    await store.load();
    expect(store.getSnapshot().items).toEqual([]);
  });
  it("fences out-of-order successes, errors and disposed sessions", async () => {
    const { store, repo } = setup();
    const slow = deferred<StoredBookmark[]>();
    vi.mocked(repo.list).mockReturnValueOnce(slow.promise);
    const old = store.load();
    await store.load();
    slow.reject(new Error("stale error"));
    await old;
    expect(store.getSnapshot().status).toBe("ready");
    const late = deferred<StoredBookmark[]>();
    vi.mocked(repo.list).mockReturnValueOnce(late.promise);
    const read = store.load();
    store.dispose();
    late.resolve([]);
    await read;
    await store.edit([record().url], { title: "Ignored" });
    expect(repo.update).not.toHaveBeenCalled();
    expect(store.getSnapshot().items).toHaveLength(1);
  });
});
