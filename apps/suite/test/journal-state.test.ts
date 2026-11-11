// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EntryData, JournalEntry, JournalStore } from "@jeswr/solid-journal";
import { expect, it, vi } from "vitest";
import { JournalController } from "../src/apps/journal/state/journal-controller";

const data: EntryData = { text: "Today was a good day.", created: new Date("2026-11-11") };
const original: JournalEntry = { ...data, url: "https://pod.example/journal/one.ttl", etag: '"1"' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let version = 1;
  const server = new Map([[original.url, original]]);
  const store: JournalStore = {
    container: "https://pod.example/journal/",
    initialize: vi.fn(async () => {}),
    list: vi.fn(async () => [...server.values()]),
    save: vi.fn(async (value, existing) => {
      const saved = {
        ...value,
        url: existing?.url ?? "https://pod.example/journal/new.ttl",
        etag: `"${++version}"`,
      };
      server.set(saved.url, saved);
      return saved;
    }),
    remove: vi.fn(async (entry) => {
      server.delete(entry.url);
    }),
    attach: vi.fn(async () => "https://pod.example/journal/photo.png"),
    photo: vi.fn(),
  };
  const failed = vi.fn();
  const controller = new JournalController(store, failed);
  return { store, failed, controller };
}
it("loads, notifies subscribers and stops notifying after unsubscribe", async () => {
  const { controller } = fixture();
  const changed = vi.fn();
  const stop = controller.subscribe(changed);
  expect(controller.getSnapshot().loading).toBe(true);
  await controller.load();
  expect(controller.getSnapshot().entries).toEqual([original]);
  expect(changed).toHaveBeenCalledOnce();
  stop();
  await controller.load();
  expect(changed).toHaveBeenCalledOnce();
});
it("paints saves immediately and serialises writes against confirmed versions", async () => {
  const { store, controller } = fixture();
  await controller.load();
  const first = deferred<JournalEntry>();
  vi.mocked(store.save).mockReturnValueOnce(first.promise);
  controller.save({ ...data, title: "first" }, original);
  controller.save({ ...data, title: "second" }, original);
  expect(controller.getSnapshot().entries[0]?.title).toBe("second");
  expect(controller.getSnapshot().saving).toBe(2);
  first.resolve({ ...original, title: "first", etag: '"2"' });
  await controller.settled();
  expect(vi.mocked(store.save).mock.calls[1]?.[1]?.etag).toBe('"2"');
  expect(controller.getSnapshot().entries[0]?.title).toBe("second");
  expect(controller.getSnapshot().saving).toBe(0);
});
it("doesn't resurrect failed writes when both pending updates fail, and retains retry data", async () => {
  const { store, controller, failed } = fixture();
  await controller.load();
  vi.mocked(store.save)
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"));
  controller.save({ ...data, title: "first" }, original);
  controller.save({ ...data, title: "second" }, original);
  await controller.settled();
  expect(controller.getSnapshot().entries).toEqual([original]);
  expect(controller.getSnapshot().failed).toHaveLength(2);
  expect(failed).toHaveBeenCalledTimes(2);
  controller.retryFailed();
  await controller.settled();
  expect(controller.getSnapshot().entries[0]?.title).toBe("second");
  expect(controller.getSnapshot().failed).toEqual([]);
});
it("doesn't let an older failure roll back a newer successful update", async () => {
  const { store, controller } = fixture();
  await controller.load();
  vi.mocked(store.save).mockRejectedValueOnce(new Error("offline"));
  controller.save({ ...data, title: "old" }, original);
  controller.save({ ...data, title: "new" }, original);
  await controller.settled();
  expect(controller.getSnapshot().entries[0]?.title).toBe("new");
});
it("fences stale reads started before writes and overlapping reloads", async () => {
  const { store, controller } = fixture();
  const old = deferred<JournalEntry[]>();
  vi.mocked(store.list).mockReturnValueOnce(old.promise);
  const loading = controller.load();
  controller.save({ ...data, title: "new" });
  await controller.settled();
  old.resolve([original]);
  await loading;
  expect(controller.getSnapshot().entries.some((entry) => entry.title === "new")).toBe(true);
  const delayed = deferred<JournalEntry[]>();
  vi.mocked(store.list).mockReturnValueOnce(delayed.promise);
  const read = controller.load();
  vi.mocked(store.list).mockResolvedValueOnce([original]);
  await controller.load();
  delayed.resolve([]);
  await read;
  expect(controller.getSnapshot().entries).toEqual([original]);
});
it("retains loaded content during a read error and permits retry", async () => {
  const { store, controller } = fixture();
  await controller.load();
  vi.mocked(store.list).mockRejectedValueOnce(new Error("network"));
  await controller.load();
  expect(controller.getSnapshot()).toMatchObject({
    loading: false,
    error: true,
    entries: [original],
  });
  await controller.load();
  expect(controller.getSnapshot().error).toBe(false);
});
it("ignores a stale read failure and skips a reload while a write is pending", async () => {
  const { store, controller } = fixture();
  const old = deferred<JournalEntry[]>();
  vi.mocked(store.list).mockReturnValueOnce(old.promise);
  const reading = controller.load();
  await controller.load();
  old.reject(new Error("late network error"));
  await reading;
  expect(controller.getSnapshot().error).toBe(false);
  const save = deferred<JournalEntry>();
  vi.mocked(store.save).mockReturnValueOnce(save.promise);
  controller.save({ ...data, title: "pending" }, original);
  await controller.load();
  expect(controller.getSnapshot().entries[0]?.title).toBe("pending");
  save.resolve({ ...original, title: "pending" });
  await controller.settled();
});
it("optimistically removes an entry, rolls back on failure and retries deletion", async () => {
  const { store, controller } = fixture();
  await controller.load();
  vi.mocked(store.remove).mockRejectedValueOnce(new Error("offline"));
  controller.remove(original);
  expect(controller.getSnapshot().entries).toEqual([]);
  await controller.settled();
  expect(controller.getSnapshot().entries).toEqual([original]);
  controller.retryFailed();
  await controller.settled();
  expect(controller.getSnapshot().entries).toEqual([]);
});
it("uploads photos in the background and retains files after failure", async () => {
  const { store, controller } = fixture();
  const photo = new Blob(["image"], { type: "image/png" });
  vi.mocked(store.attach).mockRejectedValueOnce(new Error("offline"));
  controller.save(data, undefined, [photo]);
  expect(controller.getSnapshot().entries).toHaveLength(1);
  await controller.settled();
  expect(controller.getSnapshot().failed[0]?.photos).toEqual([photo]);
  controller.retryFailed();
  await controller.settled();
  expect(
    controller.getSnapshot().entries.find((entry) => entry.url.endsWith("new.ttl"))?.images,
  ).toEqual(["https://pod.example/journal/photo.png"]);
});
it("clears previously loaded records when access is revoked", async () => {
  const { store, controller } = fixture();
  await controller.load();
  vi.mocked(store.list).mockRejectedValueOnce({ code: "forbidden" });
  await controller.load();
  expect(controller.getSnapshot()).toMatchObject({ entries: [], error: true });
});
it("retains uploaded photo references when a later upload fails, then retries only the remaining photo", async () => {
  const { store, controller } = fixture();
  const first = new Blob(["first"], { type: "image/png" });
  const second = new Blob(["second"], { type: "image/png" });
  vi.mocked(store.attach)
    .mockResolvedValueOnce("https://pod.example/journal/first.png")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("https://pod.example/journal/second.png");
  controller.save(data, undefined, [first, second]);
  await controller.settled();
  expect(controller.getSnapshot().failed[0]?.photos).toEqual([second]);
  expect(controller.getSnapshot().failed[0]?.data?.images).toEqual([
    "https://pod.example/journal/first.png",
  ]);
  controller.retryFailed();
  await controller.settled();
  expect(store.attach).toHaveBeenCalledTimes(3);
  expect(
    controller.getSnapshot().entries.find((entry) => entry.url.endsWith("new.ttl"))?.images,
  ).toEqual(["https://pod.example/journal/first.png", "https://pod.example/journal/second.png"]);
});
