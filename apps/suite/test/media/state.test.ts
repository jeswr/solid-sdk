// AUTHORED-BY Codex (GPT-6.1 Sol)
import type {
  MediaEntry,
  MediaListing,
  MediaRecord,
  MediaRepository,
} from "@jeswr/solid-media-log";
import { describe, expect, it, vi } from "vitest";
import { MediaStore } from "../../src/apps/media/state/media-store";

const entry: MediaEntry = { title: "Paper Moons", kind: "film", status: "want", rating: 1 };
const original: MediaRecord = {
  id: "https://pod.example/media/1",
  url: "https://pod.example/media/1",
  etag: '"1"',
  data: entry,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}
function repository(): MediaRepository {
  return {
    load: vi.fn(async () => ({ records: [original], incomplete: false })),
    save: vi.fn(async (data, record) => ({ ...(record ?? original), etag: '"next"', data })),
  };
}
async function ready() {
  const repo = repository();
  const store = new MediaStore(Promise.resolve(repo));
  await store.load();
  return { repo, store };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
describe("media intent queue", () => {
  it("loads initial, empty, incomplete and error states", async () => {
    const repo = repository();
    const store = new MediaStore(Promise.resolve(repo));
    expect(store.getSnapshot().loading).toBe(true);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({
      loading: false,
      error: false,
      records: [original],
    });
    vi.mocked(repo.load).mockResolvedValueOnce({ records: [], incomplete: true });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ records: [], incomplete: true });
    vi.mocked(repo.load).mockRejectedValueOnce(new Error("Offline"));
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: true });
  });
  it("paints optimistically and settles with the returned version without blocking another action", async () => {
    const { repo, store } = await ready();
    const write = deferred<MediaRecord>();
    vi.mocked(repo.save).mockReturnValueOnce(write.promise);
    const task = store.save({ ...entry, rating: 4 }, original);
    expect(store.getSnapshot()).toMatchObject({ saving: 1, records: [{ data: { rating: 4 } }] });
    write.resolve({ ...original, etag: '"2"', data: { ...entry, rating: 4 } });
    await task;
    expect(store.getSnapshot()).toMatchObject({
      saving: 0,
      records: [{ etag: '"2"', data: { rating: 4 } }],
    });
  });
  it("removes a failed older edit while preserving a newer edit to another field", async () => {
    const { repo, store } = await ready();
    const write = deferred<MediaRecord>();
    vi.mocked(repo.save).mockReturnValueOnce(write.promise);
    const first = store.save({ ...entry, rating: 2 }, original).catch(() => {});
    const visible = store.getSnapshot().records[0] as MediaRecord;
    const second = store.save({ ...visible.data, review: "Loved the ending" }, visible);
    expect(repo.save).not.toHaveBeenCalled();
    await tick();
    expect(repo.save).toHaveBeenCalledTimes(1);
    write.reject(new Error("Offline"));
    await first;
    await second;
    expect(store.getSnapshot().records[0]?.data).toMatchObject({
      rating: 1,
      review: "Loved the ending",
    });
    expect(vi.mocked(repo.save).mock.calls[1]?.[0]).toMatchObject({
      rating: 1,
      review: "Loved the ending",
    });
  });
  it("restores the confirmed baseline if two successive edits to the same field both fail", async () => {
    const { repo, store } = await ready();
    vi.mocked(repo.save).mockRejectedValue(new Error("Offline"));
    const first = store.save({ ...entry, rating: 2 }, original).catch(() => {});
    const visible = store.getSnapshot().records[0] as MediaRecord;
    const second = store.save({ ...visible.data, rating: 3 }, visible).catch(() => {});
    await Promise.all([first, second]);
    expect(store.getSnapshot().records[0]?.data.rating).toBe(1);
    expect(store.getSnapshot().saving).toBe(0);
  });
  it("uses the successful predecessor's ETag and keeps the latest same-field intent", async () => {
    const { repo, store } = await ready();
    const first = store.save({ ...entry, rating: 2 }, original);
    const visible = store.getSnapshot().records[0] as MediaRecord;
    const second = store.save({ ...visible.data, rating: 3 }, visible);
    await Promise.all([first, second]);
    expect(vi.mocked(repo.save).mock.calls[1]?.[1]?.etag).toBe('"next"');
    expect(store.getSnapshot().records[0]?.data.rating).toBe(3);
  });
  it("handles optimistic additions, following edits and failed creation", async () => {
    const { repo, store } = await ready();
    const creating = deferred<MediaRecord>();
    vi.mocked(repo.save).mockReturnValueOnce(creating.promise);
    const first = store.save({ ...entry, title: "New work" });
    const added = store
      .getSnapshot()
      .records.find((record) => record.id.startsWith("new:")) as MediaRecord;
    const second = store.save({ ...added.data, review: "A review" }, added);
    creating.resolve({ ...added, url: "https://pod.example/media/2", etag: '"2"' });
    await first;
    await second;
    expect(store.getSnapshot().records.find((record) => record.id === added.id)).toMatchObject({
      data: { review: "A review" },
      url: "https://pod.example/media/2",
    });
    vi.mocked(repo.save).mockRejectedValue(new Error("Offline"));
    const failed = store.save({ ...entry, title: "Failed work" }).catch(() => {});
    const failedRecord = store
      .getSnapshot()
      .records.find((record) => record.data.title === "Failed work") as MediaRecord;
    const later = store.save({ ...failedRecord.data, rating: 5 }, failedRecord).catch(() => {});
    await failed;
    await later;
    expect(store.getSnapshot().records.some((record) => record.id === failedRecord.id)).toBe(false);
  });
  it("does not save no-op patches and validates before touching state", async () => {
    const { repo, store } = await ready();
    await store.save(entry, original);
    expect(repo.save).not.toHaveBeenCalled();
    expect(() => store.save({ ...entry, rating: 3.2 }, original)).toThrow(TypeError);
    expect(store.getSnapshot().saving).toBe(0);
  });
  it("fences stale refreshes and ignores refresh while edits are pending", async () => {
    const { repo, store } = await ready();
    const stale = deferred<MediaListing>();
    vi.mocked(repo.load).mockReturnValueOnce(stale.promise);
    const load = store.load();
    await tick();
    const write = deferred<MediaRecord>();
    vi.mocked(repo.save).mockReturnValueOnce(write.promise);
    const save = store.save({ ...entry, rating: 5 }, original);
    const calls = vi.mocked(repo.load).mock.calls.length;
    await store.load();
    expect(repo.load).toHaveBeenCalledTimes(calls);
    stale.resolve({ records: [original], incomplete: false });
    await load;
    expect(store.getSnapshot().records[0]?.data.rating).toBe(5);
    write.resolve({ ...original, data: { ...entry, rating: 5 } });
    await save;
  });
  it("only accepts the newest refresh and retains loaded items on network failure", async () => {
    const { repo, store } = await ready();
    const first = deferred<MediaListing>();
    vi.mocked(repo.load).mockReturnValueOnce(first.promise);
    const stale = store.load();
    await tick();
    vi.mocked(repo.load).mockResolvedValueOnce({
      records: [{ ...original, data: { ...entry, title: "Fresh" } }],
      incomplete: false,
    });
    await store.load();
    first.reject(new Error("Offline"));
    await stale;
    expect(store.getSnapshot()).toMatchObject({
      error: false,
      records: [{ data: { title: "Fresh" } }],
    });
    vi.mocked(repo.load).mockRejectedValueOnce(new Error("Offline"));
    await store.load();
    expect(store.getSnapshot()).toMatchObject({
      error: true,
      records: [{ data: { title: "Fresh" } }],
    });
  });
  it("notifies subscribers, supports unsubscription and drops late reads on disposal", async () => {
    const { repo, store } = await ready();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    await store.load();
    expect(listener).toHaveBeenCalledOnce();
    off();
    await store.load();
    expect(listener).toHaveBeenCalledOnce();
    const read = deferred<MediaListing>();
    vi.mocked(repo.load).mockReturnValueOnce(read.promise);
    const task = store.load();
    store.dispose();
    read.resolve({ records: [], incomplete: false });
    await task;
    expect(store.getSnapshot().records).toHaveLength(1);
  });
});
it.each([
  "forbidden",
  "unauthenticated",
] as const)("clears loaded private records on %s", async (code) => {
  const { StorageError } = await import("@jeswr/storage-client");
  const { repo, store } = await ready();
  vi.mocked(repo.load).mockRejectedValueOnce(
    new StorageError(code, { url: "https://pod.example/media/", method: "GET" }),
  );
  await store.load();
  expect(store.getSnapshot()).toMatchObject({ records: [], error: true });
});
it("ignores a late successful write after its account store is disposed", async () => {
  const { repo, store } = await ready();
  const write = deferred<MediaRecord>();
  vi.mocked(repo.save).mockReturnValueOnce(write.promise);
  const task = store.save({ ...entry, rating: 5 }, original);
  await tick();
  const snapshot = store.getSnapshot();
  const listener = vi.fn();
  store.subscribe(listener);
  store.dispose();
  write.resolve({ ...original, data: { ...entry, rating: 5 }, etag: '"late"' });
  await task;
  expect(listener).not.toHaveBeenCalled();
  expect(store.getSnapshot()).toBe(snapshot);
});
