// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6

import type {
  BookmarkListing,
  BookmarkRepository,
  StoredBookmark,
} from "@jeswr/solid-bookmark/pod";
import { BookmarkPrivacyError } from "@jeswr/solid-bookmark/pod";
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { BOOKMARK_UNDO_MS, createLibraryStore } from "../src/apps/bookmarks/state/library-store";

const record = (id = "one"): StoredBookmark => ({
  url: `https://pod.example/bookmarks/${id}.ttl`,
  etag: '"1"',
  data: { url: "https://example.org/", title: "Original", tags: ["old"] },
});
function setup() {
  const first = record();
  const repo: BookmarkRepository = {
    registration: "registered",
    initialize: vi.fn(async () => {}),
    list: vi.fn(async () => ({ items: [first], skipped: [] })),
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
  it("publishes child failures and registration status without blanking readable bookmarks", async () => {
    const { repo, store, first } = setup();
    const skipped = [{ url: "https://pod.example/blocked.ttl", reason: "forbidden" as const }];
    vi.mocked(repo.list).mockResolvedValueOnce({ items: [first], skipped });
    Object.defineProperty(repo, "registration", { value: "failed", configurable: true });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", skipped, registration: "failed" });
    expect(store.getSnapshot().items[0]?.id).toBe(first.url);
    Object.defineProperty(repo, "registration", { value: "registered" });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ skipped: [], registration: "registered" });
  });
  it("tags an untagged record and drops edits to a create that failed", async () => {
    const { store, repo, first, failure } = setup();
    vi.mocked(repo.list).mockResolvedValue({
      items: [{ ...first, data: { url: first.data.url } }],
      skipped: [],
    });
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
    vi.mocked(repo.list).mockResolvedValue({ items: [first, record("two")], skipped: [] });
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
    vi.mocked(repo.list).mockResolvedValue({ items: [first, created], skipped: [] });
    await store.load();
    expect(store.getSnapshot().items.map((item) => item.id)).toEqual([first.url, "local"]);
    await store.add([{ id: "local", data: created.data }]);
    expect(repo.create).toHaveBeenCalledOnce();
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
    const commit = vi.fn();
    const undo = store.remove([first.url], commit);
    expect(store.getSnapshot().items).toHaveLength(1);
    undo();
    undo();
    expect(store.getSnapshot().items).toHaveLength(2);
    await store.settled();
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.remove).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
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
  it("commits a conditional delete only after the undo window, restoring the item on failure", async () => {
    vi.useFakeTimers();
    try {
      const { store, repo, first, failure } = setup();
      await store.load();
      vi.mocked(repo.remove).mockRejectedValueOnce(new Error("denied"));
      const commit = vi.fn();
      const undo = store.remove([first.url], commit);
      await vi.advanceTimersByTimeAsync(BOOKMARK_UNDO_MS - 1);
      expect(repo.remove).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await store.settled();
      expect(repo.remove).toHaveBeenCalledWith(first);
      expect(commit).toHaveBeenCalledOnce();
      expect(store.getSnapshot().items).toHaveLength(1);
      expect(failure).toHaveBeenCalledOnce();
      undo();
      expect(repo.create).not.toHaveBeenCalled();
      store.remove([first.url], commit);
      await vi.advanceTimersByTimeAsync(BOOKMARK_UNDO_MS);
      expect(store.getSnapshot().items).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels pending hard deletes when the session closes", async () => {
    vi.useFakeTimers();
    try {
      const { store, repo, first } = setup();
      await store.load();
      const commit = vi.fn();
      store.remove([first.url], commit);
      store.dispose();
      store.remove([first.url], commit)();
      await vi.advanceTimersByTimeAsync(BOOKMARK_UNDO_MS);
      expect(repo.remove).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("fences editor changes against both refreshes and preceding optimistic writes", async () => {
    const { store, repo, first, failure } = setup();
    await store.load();
    const current = { ...first, etag: '"external"', data: { ...first.data, notes: "Remote" } };
    vi.mocked(repo.list).mockResolvedValueOnce({ items: [current], skipped: [] });
    await store.load();
    expect(() => store.edit([first.url], { notes: "Local" }, first.data)).toThrow("changed");
    await store.edit([first.url], { title: "Local title" }, first.data);
    expect(repo.update).toHaveBeenCalledWith(current, { title: "Local title" });
    expect(store.getSnapshot().items[0]?.data.notes).toBe("Remote");

    vi.mocked(repo.update).mockRejectedValueOnce(new Error("Earlier edit failed"));
    const pending = store.edit([first.url], { title: "Optimistic" });
    const opening = store.getSnapshot().items[0]?.data;
    await store.edit([first.url], { title: "From editor" }, opening);
    await pending;
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(failure.mock.lastCall?.[0]).toMatchObject({
      message: expect.stringContaining("changed"),
    });
    expect(() => store.edit(["missing"], { title: "Gone" }, first.data)).toThrow("changed");
  });
  it.each([
    new StorageError("rate-limited", { url: record().url, method: "POST", status: 429 }),
    new StorageError("unauthenticated", { url: record().url, method: "POST", status: 401 }),
    new BookmarkPrivacyError(),
  ])("stops terminal imports and retries only failed and unattempted bookmarks (%s)", async (error) => {
    const { store, repo, failure } = setup();
    await store.load();
    const batch = ["saved", "failed", "unattempted"].map((id) => ({
      id,
      data: { url: `https://example.net/${id}` },
    }));
    const initialCreate = vi.mocked(repo.create).getMockImplementation();
    const firstSave = deferred<StoredBookmark>();
    const [saved] = batch;
    if (!saved) throw new Error("Missing import fixture");
    vi.mocked(repo.create).mockReturnValueOnce(firstSave.promise).mockRejectedValueOnce(error);
    const importing = store.importBookmarks(batch);
    await store.retryImport();
    firstSave.resolve({
      url: "https://pod.example/bookmarks/saved.ttl",
      etag: '"saved"',
      data: saved.data,
    });
    await importing;
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(failure).toHaveBeenCalledWith(error);
    expect(store.getSnapshot().importRemaining).toBe(2);
    expect(store.getSnapshot().items.map(({ data }) => data.url)).toContain(saved.data.url);
    if (initialCreate) vi.mocked(repo.create).mockImplementation(initialCreate);
    await store.retryImport();
    expect(
      vi
        .mocked(repo.create)
        .mock.calls.slice(2)
        .map(([data]) => data),
    ).toEqual(batch.slice(1).map(({ data }) => data));
    expect(store.getSnapshot().importRemaining).toBe(0);
  });
  it("handles partial bulk failures and ignores missing records", async () => {
    const { store, repo, first } = setup();
    vi.mocked(repo.list).mockResolvedValue({ items: [first, record("two")], skipped: [] });
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
    const slow = deferred<BookmarkListing>();
    vi.mocked(repo.list).mockReturnValueOnce(slow.promise);
    const read = store.load();
    await store.edit([first.url], { title: "Keep" });
    slow.resolve({ items: [first], skipped: [] });
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
  it("clears previously read bookmarks and shows an error when the session expires", async () => {
    const { store, repo } = setup();
    await store.load();
    expect(store.getSnapshot().items).toHaveLength(1);
    const error = { code: "unauthenticated" };
    vi.mocked(repo.list).mockRejectedValueOnce(error);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error, items: [] });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
    expect(store.getSnapshot().items).toHaveLength(1);
  });
  it("fences out-of-order successes, errors and disposed sessions", async () => {
    const { store, repo } = setup();
    const slow = deferred<BookmarkListing>();
    vi.mocked(repo.list).mockReturnValueOnce(slow.promise);
    const old = store.load();
    await store.load();
    slow.reject(new Error("stale error"));
    await old;
    expect(store.getSnapshot().status).toBe("ready");
    const late = deferred<BookmarkListing>();
    vi.mocked(repo.list).mockReturnValueOnce(late.promise);
    const read = store.load();
    store.dispose();
    late.resolve({ items: [], skipped: [] });
    await read;
    await store.edit([record().url], { title: "Ignored" });
    expect(repo.update).not.toHaveBeenCalled();
    expect(store.getSnapshot().items).toHaveLength(1);
  });
});
