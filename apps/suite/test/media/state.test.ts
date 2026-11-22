// AUTHORED-BY Codex (GPT-6.1 Sol)
import type {
  MediaEntry,
  MediaListing,
  MediaRecord,
  MediaRepository,
} from "@jeswr/solid-media-log";
import { mediaRepository, parseLetterboxdCsv, parseMediaLog } from "@jeswr/solid-media-log";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
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

it("imports as one bounded job, checking every existing record and publishing once per batch", async () => {
  const { repo, store } = await ready();
  const existing = Array.from({ length: 1201 }, (_, i) => ({
    ...original,
    id: String(i),
    data: { ...entry, title: `Film ${i}` },
  }));
  vi.mocked(repo.load).mockResolvedValue({ records: existing, incomplete: false });
  let active = 0;
  let maximum = 0;
  vi.mocked(repo.save).mockImplementation(async (data) => {
    maximum = Math.max(maximum, ++active);
    await tick();
    --active;
    if (data.title === "New 7") throw new Error("Offline");
    return { ...original, id: data.title, data };
  });
  const listener = vi.fn();
  store.subscribe(listener);
  const entries = Array.from({ length: 13 }, (_, i) => ({ ...entry, title: `New ${i}` }));
  const job = await store.importEntries([...entries, { ...entry, title: "Film 1200" }], 2);
  expect(repo.load).toHaveBeenLastCalledWith({ complete: true, signal: expect.any(AbortSignal) });
  expect(maximum).toBe(6);
  expect(job).toMatchObject({ running: false, imported: 12, failed: 1, skipped: 3, processed: 14 });
  expect(listener).toHaveBeenCalledTimes(6); // start, optimistic additions, three batches, finish
  expect(store.getSnapshot().records).toHaveLength(13);
});
it("cancels between batches, retaining the completed batch and removing unstarted optimistic entries", async () => {
  const { repo, store } = await ready();
  const write = deferred<MediaRecord>();
  vi.mocked(repo.save).mockReturnValue(write.promise);
  const task = store.importEntries(
    Array.from({ length: 20 }, (_, i) => ({ ...entry, title: `Import ${i}` })),
  );
  await tick();
  expect(repo.save).toHaveBeenCalledTimes(6);
  store.cancelImport();
  write.resolve(original);
  const job = await task;
  expect(job).toMatchObject({ cancelled: true, imported: 6, processed: 6, running: false });
  expect(repo.save).toHaveBeenCalledTimes(6);
  expect(store.getSnapshot().records).toHaveLength(7);
});
it.each([
  "source-cap",
  "timeout-or-cancelled",
  "listing-failure",
  "type-index-unavailable",
])("refuses imports when sources remain unscanned: %s", async (reason) => {
  const { repo, store } = await ready();
  vi.mocked(repo.load).mockResolvedValue({
    records: [],
    incomplete: true,
    skipped: reason === "source-cap" ? [] : [{ url: "https://pod.example/source/", reason }],
  });
  expect(await store.importEntries([{ ...entry, title: "A" }])).toMatchObject({
    failed: 1,
    imported: 0,
    running: false,
    error: "incomplete-library",
  });
  expect(repo.save).not.toHaveBeenCalled();
});
it("fences refresh while importing, refuses a second job and keeps unconfirmed committed items", async () => {
  const { repo, store } = await ready();
  const write = deferred<MediaRecord>();
  vi.mocked(repo.save).mockReturnValueOnce(write.promise);
  const task = store.importEntries([{ ...entry, title: "A" }]);
  await tick();
  const calls = vi.mocked(repo.load).mock.calls.length;
  await store.load();
  expect(repo.load).toHaveBeenCalledTimes(calls);
  await expect(store.importEntries([entry])).rejects.toThrow(/already running/);
  write.resolve({ ...original, data: { ...entry, title: "A" }, etag: null, unconfirmed: true });
  await task;
  expect(store.getSnapshot().records.find((r) => r.data.title === "A")).toMatchObject({
    unconfirmed: true,
  });
});
it("cancels duplicate checking and drops late import updates after account disposal", async () => {
  const { repo, store } = await ready();
  const read = deferred<MediaListing>();
  vi.mocked(repo.load).mockReturnValueOnce(read.promise);
  const task = store.importEntries([entry]);
  await tick();
  const snapshot = store.getSnapshot();
  store.dispose();
  read.resolve({ records: [], incomplete: false });
  await task;
  expect(repo.save).not.toHaveBeenCalled();
  expect(store.getSnapshot()).toBe(snapshot);
});
it("reports rejected items without treating them as an unscanned library or blocking imports", async () => {
  const { repo, store } = await ready();
  const skipped = [{ url: "https://pod.example/media/bad", reason: "not-rdf" }];
  vi.mocked(repo.load).mockResolvedValue({ records: [original], incomplete: false, skipped });
  await store.load();
  expect(store.getSnapshot()).toMatchObject({ incomplete: false, skipped });
  expect(await store.importEntries([{ ...entry, title: "A new film" }])).toMatchObject({
    imported: 1,
    failed: 0,
    skipped: 0,
  });
});
it("preserves an unconfirmed committed item when a background refresh cannot read it", async () => {
  const { repo, store } = await ready();
  vi.mocked(repo.save).mockResolvedValueOnce({
    ...original,
    data: { ...entry, rating: 5 },
    etag: null,
    unconfirmed: true,
  });
  await store.save({ ...entry, rating: 5 }, original);
  vi.mocked(repo.load).mockResolvedValueOnce({
    records: [],
    incomplete: false,
    skipped: [{ url: original.url as string, reason: "network" }],
  });
  await store.load();
  expect(store.getSnapshot().records[0]).toMatchObject({ unconfirmed: true, data: { rating: 5 } });
  expect(store.getSnapshot().incomplete).toBe(false);
  vi.mocked(repo.load).mockResolvedValueOnce({
    records: [{ ...original, data: { ...entry, rating: 5 } }],
    incomplete: false,
  });
  await store.load();
  expect(store.getSnapshot().records[0]?.unconfirmed).toBeUndefined();
});
it.each([
  "solid",
  "lws",
] as const)("imports watchlist.csv then diary.csv by updating the same record conditionally (%s)", async (protocol) => {
  const storage = createMemoryStorage({ root: "https://pod.example/", protocol });
  const repo = mediaRepository(storage, {
    find: async () => [],
    findAll: async () => new Map(),
    register: async () => undefined,
    unregister: async () => {},
    listClasses: async () => [],
  });
  const store = new MediaStore(Promise.resolve(repo));
  await store.load();
  const watchlist = parseLetterboxdCsv("Name,Year\nThe Copper Shore,2025", "want");
  expect(await store.importEntries(watchlist.entries)).toMatchObject({ imported: 1, failed: 0 });
  const record = store.getSnapshot().records[0] as MediaRecord;
  // Another client enriches the item after this store's watchlist snapshot.
  const current = await repo.save(
    {
      ...record.data,
      title: "The Copper SHORE",
      creator: "Aster Vale",
      source: "My cinema journal",
      origin: "https://example.org/films/copper-shore",
      repeatCount: 3,
      cover: "https://example.org/covers/copper-shore.jpg",
      started: "2026-11-01",
      progress: 1,
      progressUnit: "episode",
    },
    record,
  );
  const save = vi.spyOn(repo, "save");
  const write = vi.spyOn(storage, "write");
  const diary = parseLetterboxdCsv(
    "Name,Year,Watched Date,Rating,Review,Letterboxd URI\nThe Copper Shore,2025,2026-11-09,4.5,A favourite,https://letterboxd.com/film/the-copper-shore/",
  );
  expect(diary.entries[0]?.repeatCount).toBe(0);
  expect(await store.importEntries(diary.entries)).toMatchObject({
    imported: 1,
    skipped: 0,
    failed: 0,
  });
  expect(save.mock.calls[0]?.[1]).toMatchObject({ url: record.url, etag: current.etag });
  expect(write.mock.calls[0]?.[2]?.ifMatch).toBe(current.etag);
  expect(store.getSnapshot().records).toHaveLength(1);
  const updated = store.getSnapshot().records[0] as MediaRecord;
  expect(updated).toMatchObject({
    id: record.id,
    url: record.url,
    data: {
      status: "finished",
      finished: "2026-11-09",
      rating: 4.5,
      review: "A favourite",
    },
  });
  expect(updated.data).toEqual({
    ...current.data,
    status: "finished",
    finished: "2026-11-09",
    rating: 4.5,
    review: "A favourite",
  });
  expect(updated.etag).not.toBe(record.etag);
  expect(
    parseMediaLog(updated.url as string, (await storage.readRdf(updated.url as string)).dataset),
  ).toMatchObject(updated.data);
});
it("keeps an existing rating and review when a completion CSV omits them", async () => {
  const repo = repository();
  const existing = { ...original, data: { ...entry, review: "My earlier notes", repeatCount: 2 } };
  vi.mocked(repo.load).mockResolvedValue({ records: [existing], incomplete: false });
  const store = new MediaStore(Promise.resolve(repo));
  await store.load();
  const diary = parseLetterboxdCsv("Name,Year,Watched Date\nPaper Moons,,2026-11-09");
  expect(await store.importEntries(diary.entries)).toMatchObject({ imported: 1, failed: 0 });
  expect(store.getSnapshot().records[0]?.data).toEqual({
    ...existing.data,
    status: "finished",
    finished: "2026-11-09",
  });
});
it("rolls back a failed optimistic completion import and retains the watchlist item", async () => {
  const { repo, store } = await ready();
  const write = deferred<MediaRecord>();
  vi.mocked(repo.save).mockReturnValueOnce(write.promise);
  const task = store.importEntries([
    { ...entry, status: "finished", finished: "2026-11-09", rating: 4 },
  ]);
  await tick();
  expect(store.getSnapshot().records).toHaveLength(1);
  expect(store.getSnapshot().records[0]?.data.status).toBe("finished");
  write.reject(new Error("Precondition failed"));
  expect(await task).toMatchObject({ failed: 1, imported: 0 });
  expect(store.getSnapshot().records).toEqual([original]);
});
