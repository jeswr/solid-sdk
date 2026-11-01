// AUTHORED-BY Codex GPT-6.1-Sol
import type { BookmarkData } from "@jeswr/solid-bookmark";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openReadingList, type ReadingList, updateWithRetry } from "../src/reading-list.js";

const data: BookmarkData = {
  url: "https://example.org/article",
  title: "An article worth revisiting",
  tags: ["rdf", "solid"],
  archived: false,
};

describe.each(["solid", "lws"] as const)("reading list on %s", (protocol) => {
  let storage: StorageClient;
  let list: ReadingList;

  beforeEach(async () => {
    storage = createMemoryStorage({ protocol, root: "https://pod.example/", pageSize: 1 });
    list = await openReadingList(storage);
  });

  it("creates a container and returns its URL", async () => {
    const root = await storage.list(storage.root);
    expect(root.items).toEqual([
      expect.objectContaining({ url: list.container, kind: "container" }),
    ]);
    expect((await storage.head(list.container)).kind).toBe("container");
    expect(await list.list()).toEqual([]);
  });

  it("round-trips title, tags, archived and a default creation time", async () => {
    const before = Date.now();
    const item = await list.add(data);
    expect(item.bookmark.created?.getTime()).toBeGreaterThanOrEqual(before);
    expect(item.bookmark.created?.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await list.list()).toEqual([item]);
    expect(item.bookmark).toMatchObject(data);
    expect((await storage.read(item.url)).etag).toBe(item.etag);
  });

  it("follows all listing pages and sorts newest first by the bookmark's created time", async () => {
    const middle = await list.add({ ...data, created: new Date("2026-02-01T00:00:00Z") });
    const newest = await list.add({ ...data, created: new Date("2026-03-01T00:00:00Z") });
    const oldest = await list.add({ ...data, created: new Date("2026-01-01T00:00:00Z") });
    expect((await list.list()).map((item) => item.url)).toEqual([
      newest.url,
      middle.url,
      oldest.url,
    ]);
  });

  it("conditionally updates archived, stamps modified and changes the ETag", async () => {
    const item = await list.add(data);
    const before = Date.now();
    const updated = await list.update(item, { archived: true });
    expect(updated.bookmark).toMatchObject({
      ...data,
      archived: true,
      created: item.bookmark.created,
    });
    expect(updated.bookmark.modified?.getTime()).toBeGreaterThanOrEqual(before);
    expect(updated.bookmark.modified?.getTime()).toBeLessThanOrEqual(Date.now());
    expect(updated.etag).not.toBe(item.etag);
    expect(await list.list()).toEqual([updated]);

    const stale = list.update(item, { title: "Stale overwrite" });
    await expect(stale).rejects.toBeInstanceOf(StorageError);
    await expect(stale).rejects.toMatchObject({ code: "precondition-failed" });
    expect(await list.list()).toEqual([updated]);
  });

  it("reapplies a change to fresh content after a concurrent edit", async () => {
    const item = await list.add(data);
    await list.update(item, { title: "Another reader's title" });
    const updated = await updateWithRetry(list, item, { archived: true });
    expect(updated.bookmark).toMatchObject({ title: "Another reader's title", archived: true });
    expect(await list.list()).toEqual([updated]);
  });

  it("re-reads content again when an edit races with the retry helper's first read", async () => {
    const item = await list.add(data);
    const update = list.update.bind(list);
    const reads = vi.spyOn(list, "list");
    const updates = vi.spyOn(list, "update").mockImplementationOnce(async (current, changes) => {
      await update(current, { notes: "Concurrent notes" });
      return update(current, changes);
    });
    const updated = await updateWithRetry(list, item, { archived: true });
    expect(updated.bookmark).toMatchObject({ ...data, archived: true, notes: "Concurrent notes" });
    expect(reads).toHaveBeenCalledTimes(2);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(await list.list()).toEqual([updated]);
  });

  it("conditionally removes a bookmark", async () => {
    const item = await list.add(data);
    const updated = await list.update(item, { archived: true });
    await expect(list.remove(item)).rejects.toMatchObject({ code: "precondition-failed" });
    await list.remove(updated);
    expect(await list.list()).toEqual([]);
    await expect(storage.head(item.url)).rejects.toMatchObject({ code: "not-found" });
  });

  it("ignores non-Turtle files, empty non-bookmark Turtle and child containers", async () => {
    const item = await list.add(data);
    await storage.create(list.container, "An ordinary note", { contentType: "text/plain" });
    await storage.create(list.container, null, { contentType: "text/turtle" });
    await storage.create(list.container, null, { kind: "container" });
    expect(await list.list()).toEqual([item]);
  });

  it("reopens a remembered container without creating another one", async () => {
    const item = await list.add(data);
    const create = vi.spyOn(storage, "create");
    const reopened = await openReadingList(storage, list.container);
    expect(reopened.container).toBe(list.container);
    expect(await reopened.list()).toEqual([item]);
    expect(create).not.toHaveBeenCalled();
  });

  it("obtains a validator with HEAD when create returns no ETag", async () => {
    const create = storage.create.bind(storage);
    vi.spyOn(storage, "create").mockImplementationOnce(async (...args) => ({
      ...(await create(...args)),
      etag: null,
    }));
    const head = vi.spyOn(storage, "head");
    const item = await list.add(data);
    expect(head).toHaveBeenCalledWith(item.url);
    expect(await list.list()).toEqual([item]);
  });

  it("re-reads the content and ETag when an update commits without returning a validator", async () => {
    const item = await list.add(data);
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
      ...(await write(...args)),
      etag: null,
    }));
    const updated = await list.update(item, { archived: true });
    expect(updated.bookmark.archived).toBe(true);
    expect(updated.etag).not.toBe(item.etag);
    expect(await list.list()).toEqual([updated]);
  });

  it("passes the listing signal to pagination and resource reads", async () => {
    await list.add(data);
    const listing = vi.spyOn(storage, "listAll");
    const read = vi.spyOn(storage, "read");
    const controller = new AbortController();
    await list.list(controller.signal);
    expect(listing).toHaveBeenCalledWith(list.container, { signal: controller.signal });
    expect(read).toHaveBeenCalledWith(expect.any(String), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(list.list(controller.signal)).rejects.toMatchObject({ code: "network" });
  });

  it("reports a removed bookmark when a retry cannot re-read it", async () => {
    const item = await list.add(data);
    await list.remove(item);
    await expect(updateWithRetry(list, item, { archived: true })).rejects.toThrow(
      "The bookmark was removed",
    );
  });
});

it("uses the LWS memory backend's assigned container URL unchanged when the hint is taken", async () => {
  const storage = createMemoryStorage({ protocol: "lws", root: "https://pod.example/" });
  await storage.create(storage.root, null, { kind: "container", name: "reading-list" });
  const create = vi.spyOn(storage, "create");
  const list = await openReadingList(storage);
  const assigned = await create.mock.results[0]?.value;
  expect(list.container).toBe(assigned.url);
  expect(list.container).not.toBe(new URL("reading-list/", storage.root).href);
  const item = await list.add(data);
  expect(await storage.parentOf(item.url)).toBe(assigned.url);
  expect(await list.list()).toEqual([item]);
});
