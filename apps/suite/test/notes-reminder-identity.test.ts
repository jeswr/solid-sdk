// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { DataFactory } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { documentSubject } from "../src/apps/docs/lib/model/document";
import { writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { buildNote, NoteDoc } from "../src/apps/notes/lib/model/note";
import { createNotesStore, type StoredNote } from "../src/apps/notes/lib/model/store";
import {
  createBrowserFiredStore,
  createIndexedDbFiredStore,
  createMemoryFiredStore,
} from "../src/apps/notes/lib/reminders/fired-store";
import { createReminderScheduler, reminderKey } from "../src/apps/notes/lib/reminders/scheduler";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};
const ROOT = "https://pod.example/";
const NOTE_URL = `${ROOT}notes/external.ttl`;
const ACCOUNT = `${ROOT}#identity`;
const NOW = new Date("2026-11-11T12:00:00Z");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(reminder = NOW) {
  const pod = createDemoPod({ root: ROOT });
  const dataset = buildNote(NOTE_URL, { title: "External", body: "Original", reminder, now: NOW });
  const doc = new NoteDoc(documentSubject(NOTE_URL), dataset, DataFactory);
  doc.reminderId = undefined;
  doc.created = undefined;
  await writeRdf(NOTE_URL, dataset, { createOnly: true, fetchImpl: pod.fetch });
  const calls: { method: string; etag: string | null; status: number }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await pod.fetch(url, init);
    calls.push({
      method: init?.method ?? "GET",
      etag: new Headers(init?.headers).get("if-match"),
      status: response.status,
    });
    return response;
  };
  const options = { podRoot: ROOT, webId: ACCOUNT, fetch: fetchImpl };
  const store = createNotesStore(options);
  const external = (await store.read(NOTE_URL)) as StoredNote;
  expect(external.reminderId).toBeUndefined();
  return { pod, store, options, external, calls };
}

it("identifies through If-Match before delivery and converges concurrent tabs on the winning identifier", async () => {
  const s = await fixture();
  const factory = new IDBFactory();
  const notify = vi.fn();
  const secondStore = createNotesStore(s.options);
  const secondSnapshot = (await secondStore.read(NOTE_URL)) as StoredNote;
  const schedulers = [s.store, secondStore].map((store) =>
    createReminderScheduler({
      fired: createBrowserFiredStore(
        ACCOUNT,
        createMemoryFiredStore(),
        createIndexedDbFiredStore(ACCOUNT, factory),
      ),
      identify: (note) => store.identifyReminder(note as StoredNote),
      notify: (note) => {
        expect(s.calls.some((call) => call.method === "PUT" && call.status === 205)).toBe(true);
        expect(note.reminderId).toBeTruthy();
        notify(note);
      },
    }),
  );
  await Promise.all(
    schedulers.map((scheduler, index) =>
      scheduler.tick([[s.external, secondSnapshot][index] as StoredNote], NOW.getTime()),
    ),
  );
  const persisted = (await s.store.read(NOTE_URL)) as StoredNote;
  expect(notify).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ reminderId: persisted.reminderId }),
  );
  expect(s.calls.filter((call) => call.method === "PUT")).toEqual([
    { method: "PUT", etag: s.external.etag, status: 205 },
    { method: "PUT", etag: s.external.etag, status: 412 },
  ]);
  expect(await s.store.identifyReminder(persisted)).toBe(persisted);
  await schedulers[0]?.tick([s.external], NOW.getTime());
  expect(notify).toHaveBeenCalledTimes(1);
});

it("shares one identity when tab B edits a future external reminder while tab A retains its old snapshot", async () => {
  const trigger = new Date(NOW.getTime() + 60_000);
  const s = await fixture(trigger);
  const factory = new IDBFactory();
  const notify = vi.fn();
  const page = () =>
    createBrowserFiredStore(
      ACCOUNT,
      createMemoryFiredStore(),
      createIndexedDbFiredStore(ACCOUNT, factory),
    );
  const pages = [page(), page()] as const;
  const tabB = createNotesStore({ ...s.options, fired: pages[1] });
  const edited = await tabB.save(
    (await tabB.read(NOTE_URL)) as StoredNote,
    { title: "Edited before due" },
    s.external.etag,
  );
  expect(edited.reminderId).toBeTruthy();
  expect(s.external.reminderId).toBeUndefined();
  vi.setSystemTime(trigger);
  const tabA = createReminderScheduler({
    fired: pages[0],
    identify: (note) => s.store.identifyReminder(note as StoredNote),
    notify,
  });
  const schedulerB = createReminderScheduler({
    fired: pages[1],
    identify: (note) => tabB.identifyReminder(note as StoredNote),
    notify,
  });
  await Promise.all([tabA.tick([s.external], Date.now()), schedulerB.tick([edited], Date.now())]);
  expect(notify).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ reminderId: edited.reminderId, title: edited.title }),
  );
});

it.each([
  403,
  503,
  "offline",
])("delivers once by URL and trigger when pod identification fails (%s)", async (failure) => {
  const s = await fixture();
  const store = createNotesStore({
    ...s.options,
    fetch: (url, init) => {
      if (init?.method !== "PUT") return s.pod.fetch(url, init);
      if (failure === "offline") return Promise.reject(new TypeError("Offline"));
      return Promise.resolve(new Response(null, { status: failure as number }));
    },
  });
  const fired = createMemoryFiredStore();
  const notify = vi.fn();
  const scheduler = createReminderScheduler({
    fired,
    identify: (note) => store.identifyReminder(note as StoredNote),
    notify,
  });
  await scheduler.tick([s.external], NOW.getTime());
  await scheduler.tick([s.external], NOW.getTime());
  expect(notify).toHaveBeenCalledExactlyOnceWith(s.external);
  expect(await fired.claim(reminderKey(s.external), NOW.getTime())).toBe(false);
  expect((await s.store.read(NOTE_URL))?.reminderId).toBeUndefined();
});

it.each([
  "removed",
  "postponed",
  "not a note",
])("rechecks the winner after 412 when the reminder was %s", async (change) => {
  const s = await fixture();
  if (change === "not a note") {
    await writeRdf(NOTE_URL, buildNote(NOTE_URL, { title: "Gone" }), {
      etag: s.external.etag,
      fetchImpl: s.pod.fetch,
    });
    // A non-note document is represented by the normal reader's undefined result.
    vi.spyOn(s.store, "read").mockResolvedValueOnce(undefined);
  } else {
    await s.store.save(
      s.external,
      { reminder: change === "removed" ? null : new Date(NOW.getTime() + 60_000).toISOString() },
      s.external.etag,
    );
  }
  const notify = vi.fn();
  await createReminderScheduler({
    fired: createMemoryFiredStore(),
    identify: (note) => s.store.identifyReminder(note as StoredNote),
    notify,
  }).tick([s.external], NOW.getTime());
  expect(notify).not.toHaveBeenCalled();
});

it.each([
  [403, "indexedDB"],
  [503, "indexedDB"],
  ["offline", "indexedDB"],
  ["offline", "memory"],
])("remembers URL-keyed delivery after identification recovers from %s (%s history)", async (failure, history) => {
  const s = await fixture();
  const factory = new IDBFactory();
  const durable = createIndexedDbFiredStore(ACCOUNT, factory);
  if (history === "memory") {
    vi.spyOn(durable, "claim").mockRejectedValueOnce(new Error("Storage quota exceeded"));
    vi.spyOn(durable, "deliver").mockRejectedValueOnce(new Error("Storage quota exceeded"));
  }
  const fired = createBrowserFiredStore(ACCOUNT, createMemoryFiredStore(), durable);
  let recovered = false;
  const store = createNotesStore({
    ...s.options,
    fired,
    fetch: (url, init) => {
      if (recovered || init?.method !== "PUT") return s.pod.fetch(url, init);
      if (failure === "offline") return Promise.reject(new TypeError("Offline"));
      return Promise.resolve(new Response(null, { status: failure as number }));
    },
  });
  const notify = vi.fn();
  const scheduler = createReminderScheduler({
    fired,
    identify: (note) => store.identifyReminder(note as StoredNote),
    notify,
  });
  await scheduler.tick([s.external], NOW.getTime());
  expect(notify).toHaveBeenCalledExactlyOnceWith(s.external);
  recovered = true;
  await createReminderScheduler({
    fired:
      history === "memory"
        ? fired
        : createBrowserFiredStore(ACCOUNT, createMemoryFiredStore(), durable),
    identify: (note) => store.identifyReminder(note as StoredNote),
    notify,
  }).tick([s.external], NOW.getTime());
  const identified = (await store.read(NOTE_URL)) as StoredNote;
  expect(identified.reminderId).toBeTruthy();
  await createReminderScheduler({
    fired: createBrowserFiredStore(ACCOUNT, createMemoryFiredStore(), durable),
    notify,
  }).tick([identified], NOW.getTime());
  expect(notify).toHaveBeenCalledExactlyOnceWith(s.external);
  expect(await fired.claim(reminderKey(identified), NOW.getTime())).toBe(false);
  expect(await durable.claim(reminderKey(identified), NOW.getTime())).toBe(false);
});

it.each([
  "read",
  "mark",
])("keeps pod identification successful when delivery history %s fails", async (failure) => {
  const s = await fixture();
  const fired = createMemoryFiredStore();
  const notify = vi.fn();
  if (failure === "mark") {
    await createReminderScheduler({ fired, notify }).tick([s.external], NOW.getTime());
    vi.spyOn(fired, "markDelivered").mockRejectedValue(new Error("Storage unavailable"));
  } else {
    vi.spyOn(fired, "wasDelivered").mockRejectedValue(new Error("Storage unavailable"));
  }
  await createReminderScheduler({
    fired,
    identify: (note) => s.store.identifyReminder(note as StoredNote),
    notify,
  }).tick([s.external], NOW.getTime());
  expect((await s.store.read(NOTE_URL))?.reminderId).toBeTruthy();
  expect(notify).toHaveBeenCalledTimes(1);
});

it("saves the identifier before waiting on delivery history", async () => {
  const s = await fixture();
  const fired = createMemoryFiredStore();
  let resume!: (delivered: boolean) => void;
  let checked!: () => void;
  const checking = new Promise<void>((resolve) => {
    checked = resolve;
  });
  vi.spyOn(fired, "wasDelivered").mockImplementation(() => {
    checked();
    return new Promise((resolve) => {
      resume = resolve;
    });
  });
  const tick = createReminderScheduler({
    fired,
    identify: (note) => s.store.identifyReminder(note as StoredNote),
    notify: vi.fn(),
  }).tick([s.external], NOW.getTime());
  await checking;
  expect((await s.store.read(NOTE_URL))?.reminderId).toBeTruthy();
  resume(false);
  await tick;
});

it("allows a changed trigger returned by identification after a URL-keyed delivery", async () => {
  const s = await fixture();
  const fired = createMemoryFiredStore();
  const notify = vi.fn();
  await createReminderScheduler({ fired, notify }).tick([s.external], NOW.getTime());
  const changed = {
    ...s.external,
    reminderId: "changed",
    reminder: new Date(NOW.getTime() - 1).toISOString(),
  };
  await createReminderScheduler({ fired, notify, identify: async () => changed }).tick(
    [s.external],
    NOW.getTime(),
  );
  expect(notify.mock.calls.map(([note]) => note)).toEqual([s.external, changed]);
});

it.each([
  "text save",
  "archive",
])("suppresses an overdue external reminder after its first %s assigns an identifier", async (action) => {
  const s = await fixture(new Date(NOW.getTime() - 1));
  const fired = createMemoryFiredStore();
  const store = createNotesStore({ ...s.options, fired });
  const notify = vi.fn();
  // A read-only/offline earlier delivery used the URL fallback.
  await createReminderScheduler({ fired, notify }).tick([s.external], NOW.getTime());
  const saved =
    action === "text save"
      ? await store.save(s.external, { title: "Edited" }, s.external.etag)
      : await store.archive(s.external);
  expect(saved.reminderId).toBeTruthy();
  await createReminderScheduler({ fired, notify }).tick([saved], NOW.getTime());
  expect(notify).toHaveBeenCalledExactlyOnceWith(s.external);
  expect((await store.read(saved.url))?.reminderId).toBe(saved.reminderId);
});

it.each(["open", "write"])("text edits reach the pod when IndexedDB %s fails", async (failure) => {
  const s = await fixture(new Date(NOW.getTime() - 1));
  const factory = new IDBFactory();
  const failed = vi.fn();
  if (failure === "open") {
    vi.spyOn(factory, "open").mockImplementation(() => {
      failed();
      throw new Error("Opening IndexedDB failed");
    });
  } else {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = put.call(this, value, key);
      failed();
      this.transaction.abort();
      return request;
    });
  }
  vi.stubGlobal("indexedDB", factory);
  const fired = createBrowserFiredStore(ACCOUNT, createMemoryFiredStore());
  const marked = vi.spyOn(fired, "markDelivered");
  const store = createNotesStore({ ...s.options, fired });
  let saved = await store.save(
    s.external,
    { body: "Edited despite storage failure" },
    s.external.etag,
  );
  expect(await store.read(NOTE_URL)).toMatchObject({
    body: "Edited despite storage failure",
    reminderId: saved.reminderId,
  });
  await marked.mock.results[0]?.value;
  expect(failed).toHaveBeenCalledOnce();
  saved = await store.save(saved, { reminder: null }, saved.etag);
  expect(saved.reminder).toBeUndefined();
  expect((await store.archive(saved)).location).toBe("archived");
});

it("does not await local delivery bookkeeping or propagate rejected bookkeeping to pod writes", async () => {
  const s = await fixture();
  const fired = createMemoryFiredStore();
  const mark = vi
    .spyOn(fired, "markDelivered")
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockRejectedValue(new Error("Storage failed"));
  const store = createNotesStore({ ...s.options, fired });
  const saved = await store.save(s.external, { title: "Saved without waiting" }, s.external.etag);
  expect(saved.title).toBe("Saved without waiting");
  expect(mark).toHaveBeenCalledExactlyOnceWith(reminderKey(saved), NOW.getTime());
  const another = await fixture();
  const rejected = createNotesStore({ ...another.options, fired });
  expect(
    (
      await rejected.save(
        another.external,
        { title: "Saved despite rejection" },
        another.external.etag,
      )
    ).title,
  ).toBe("Saved despite rejection");
});

it("uses account page memory by default to suppress an overdue identifier", async () => {
  const s = await fixture();
  const saved = await s.store.save(s.external, { title: "Identified" }, s.external.etag);
  const notify = vi.fn();
  await createReminderScheduler({ fired: createBrowserFiredStore(ACCOUNT), notify }).tick(
    [saved],
    NOW.getTime(),
  );
  expect(notify).not.toHaveBeenCalled();
});
