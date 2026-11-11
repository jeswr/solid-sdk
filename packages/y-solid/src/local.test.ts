// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
import { Doc, encodeStateAsUpdate, encodeStateVector, mergeUpdates } from "yjs";
import {
  clearLocalMirrors,
  coversUpdates,
  hasUnconfirmedLocalState,
  LocalMirrorError,
  loadPersistedLocalState,
  openLocalMirror,
  prepareLocalMirror,
  retireLocalMirror,
  waitForLocalMirror,
} from "./local.js";

// Reuse the workspace's installed browser-storage fixture; no new dependency.
const {
  IDBFactory,
  IDBKeyRange,
  IDBDatabase: FakeDatabase,
  IDBObjectStore: FakeObjectStore,
} = createRequire(new URL("../../solid-offline/package.json", import.meta.url))("fake-indexeddb");
vi.mock("y-indexeddb", async (original) => {
  const actual = await original<typeof import("y-indexeddb")>();
  return { ...actual, storeState: vi.fn(actual.storeState) };
});
const opened: { doc: Doc; mirror: IndexeddbPersistence }[] = [];
let factory: { databases(): Promise<{ name?: string }[]> };
beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});
afterEach(async () => {
  for (const { mirror, doc } of opened.splice(0)) {
    await mirror.destroy();
    doc.destroy();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function open(name: string = crypto.randomUUID()) {
  const doc = new Doc();
  const mirror = new IndexeddbPersistence(name, doc);
  opened.push({ doc, mirror });
  await mirror.whenSynced;
  return { doc, mirror };
}
async function confirm(mirror: IndexeddbPersistence, update = encodeStateAsUpdate(mirror.doc)) {
  await mirror.set("confirmed", Uint8Array.from(update).buffer);
}

it("distinguishes empty, pending, acknowledged and subsequently edited durable state", async () => {
  const { doc, mirror } = await open();
  expect(await hasUnconfirmedLocalState(mirror)).toBe(false);
  doc.getText("body").insert(0, "Saved");
  expect(await hasUnconfirmedLocalState(mirror)).toBe(true);
  await mirror.set("confirmed", "not a buffer");
  expect(await hasUnconfirmedLocalState(mirror)).toBe(true);
  await confirm(mirror);
  const load = vi.fn();
  expect(await hasUnconfirmedLocalState(mirror, load)).toBe(false);
  expect(load).not.toHaveBeenCalled();
  doc.getText("body").insert(5, " pending");
  expect(await hasUnconfirmedLocalState(mirror)).toBe(true);
  const remote = encodeStateAsUpdate(doc);
  expect(await hasUnconfirmedLocalState(mirror, async () => remote)).toBe(false);
  expect(await mirror.get("confirmed")).toEqual(Uint8Array.from(remote).buffer);
  doc.getText("body").delete(0, 5);
  expect(await hasUnconfirmedLocalState(mirror, async () => remote)).toBe(true);
});

it("does not acknowledge dependent structs without their missing predecessors", async () => {
  const { doc, mirror } = await open();
  const source = new Doc();
  try {
    source.getText("body").insert(0, "First");
    const vector = encodeStateVector(source);
    source.getText("body").insert(5, "Second");
    const delta = encodeStateAsUpdate(source, vector);
    const database = mirror.db as NonNullable<IndexeddbPersistence["db"]>;
    await new Promise<void>((resolve) => {
      const tx = database.transaction("updates", "readwrite");
      tx.objectStore("updates").add(delta);
      tx.oncomplete = () => resolve();
    });
    await confirm(mirror);
    expect(coversUpdates(encodeStateAsUpdate(doc), [delta])).toBe(false);
    expect(await hasUnconfirmedLocalState(mirror)).toBe(true);
    expect(await loadPersistedLocalState(doc, mirror)).toBe(false);
    expect(await hasUnconfirmedLocalState(mirror)).toBe(true);
  } finally {
    source.destroy();
  }
});

it("acknowledges equivalent deletion representations and rejects uncovered deletions", () => {
  const doc = new Doc({ gc: false });
  try {
    doc.getText("body").insert(0, "Removed");
    const insert = encodeStateAsUpdate(doc);
    const vector = encodeStateVector(doc);
    doc.getText("body").delete(0, 7);
    const deletion = encodeStateAsUpdate(doc, vector);
    expect(coversUpdates(insert, [deletion])).toBe(false);
    expect(coversUpdates(mergeUpdates([insert, deletion]), [insert, deletion])).toBe(true);
    expect(() => coversUpdates(new Uint8Array([255]), [])).toThrow();
  } finally {
    doc.destroy();
  }
});

it("reloads a shared mirror after another tab compacted its update keys", async () => {
  const a = await open("shared");
  const b = await open("shared");
  a.doc.getText("body").insert(0, "Another tab");
  await storeState(a.mirror, true);
  expect(b.doc.getText("body").toString()).toBe("");
  expect(await loadPersistedLocalState(b.doc, b.mirror)).toBe(true);
  expect(b.doc.getText("body").toString()).toBe("Another tab");
  expect(await loadPersistedLocalState(b.doc, b.mirror)).toBe(false);
  // Exercise deferred database acquisition too.
  b.mirror.db = null;
  expect(await hasUnconfirmedLocalState(b.mirror)).toBe(true);
  expect(await loadPersistedLocalState(b.doc, b.mirror)).toBe(false);
});

it("supports in-memory adapters and removes observers when merge/store fails", async () => {
  const doc = new Doc();
  const adapter = {
    doc,
    db: null,
    // biome-ignore lint/style/useNamingConvention: y-indexeddb adapter contract.
    _db: Promise.resolve(null),
    get: vi.fn(),
    set: vi.fn(),
  } as unknown as IndexeddbPersistence;
  try {
    expect(await hasUnconfirmedLocalState(adapter)).toBe(false);
    doc.getText("body").insert(0, "Memory");
    expect(await hasUnconfirmedLocalState(adapter)).toBe(true);
    vi.mocked(storeState).mockImplementationOnce(async () => {
      doc.getText("body").insert(0, "Merged ");
    });
    expect(await loadPersistedLocalState(doc, adapter)).toBe(true);
    const off = vi.spyOn(doc, "off");
    vi.mocked(storeState).mockRejectedValueOnce(new Error("Storage failed"));
    await expect(loadPersistedLocalState(doc, adapter)).rejects.toThrow("Storage failed");
    expect(off).toHaveBeenCalledWith("update", expect.any(Function));
  } finally {
    doc.destroy();
  }
});

it("propagates durable read failures and always removes the merge observer", async () => {
  const { doc, mirror } = await open();
  const database = mirror.db as NonNullable<IndexeddbPersistence["db"]>;
  const transact = database.transaction.bind(database);
  vi.spyOn(database, "transaction").mockImplementation(
    (...args: Parameters<typeof database.transaction>) => {
      const transaction = transact(...args);
      queueMicrotask(() => transaction.abort());
      return transaction;
    },
  );
  const off = vi.spyOn(doc, "off");
  await expect(loadPersistedLocalState(doc, mirror)).rejects.toBeNull();
  expect(off).toHaveBeenCalledWith("update", expect.any(Function));
  await expect(hasUnconfirmedLocalState(mirror)).rejects.toBeNull();
});

it("quarantines unversioned and superseded pending mirrors without merging them into the new instance", async () => {
  const legacy = await open("registry");
  legacy.doc.getText("body").insert(0, "Unversioned pending");
  await prepareLocalMirror("registry", "first");
  const retiredLegacy = await open("registry:retired");
  expect(retiredLegacy.doc.getText("body").toString()).toBe("Unversioned pending");
  const first = await open("first");
  expect(first.doc.getText("body").length).toBe(0);
  first.doc.getText("body").insert(0, "First pending");
  await prepareLocalMirror("registry", "second");
  const retiredFirst = await open("first:retired");
  expect(retiredFirst.doc.getText("body").toString()).toBe("First pending");
  const second = await open("second");
  expect(second.doc.getText("body").length).toBe(0);
  second.doc.getText("body").insert(0, "Confirmed second");
  await confirm(second.mirror);
  await prepareLocalMirror("registry", "third");
  const names = (await factory.databases()).map((entry: { name?: string }) => entry.name);
  expect(names).not.toContain("second:retired");
  const third = await open("third");
  third.doc.getText("body").insert(0, "Still live");
  await prepareLocalMirror("registry", "third");
  expect(await (await open("third")).mirror.get("confirmed")).toBeUndefined();
  expect((await open("third")).doc.getText("body").toString()).toBe("Still live");
  // Close test connections before explicit database deletion.
  for (const item of opened.splice(0)) {
    await item.mirror.destroy();
    item.doc.destroy();
  }
  await clearLocalMirrors("registry");
  const remaining = (await factory.databases()).map((entry) => entry.name);
  for (const name of ["registry", "third", "registry:retired", "first:retired"])
    expect(remaining).not.toContain(name);
});

it("clears an unused namespace and rejects corrupt registry metadata without losing pending data", async () => {
  await clearLocalMirrors("empty");
  const { doc, mirror } = await open("registry");
  await mirror.set("retiredMirrors", "malformed");
  await expect(prepareLocalMirror("registry", "next")).rejects.toThrow();
  await mirror.set("retiredMirrors", JSON.stringify({ invalid: true }));
  await prepareLocalMirror("registry", "next");
  await mirror.set("retiredMirrors", JSON.stringify([12, "archive", "archive"]));
  await prepareLocalMirror("registry", "other");
  expect(JSON.parse(await mirror.get("retiredMirrors"))).toEqual(["archive"]);
  expect(doc.getText("body").length).toBe(0);
});

it.each([
  "archive",
  "source",
])("preserves the original pending update if the %s transaction aborts", async (stage) => {
  const { doc, mirror } = await open("registry");
  doc.getText("body").insert(0, "Keep pending");
  await hasUnconfirmedLocalState(mirror);
  const transact = FakeDatabase.prototype.transaction;
  const spy = vi.spyOn(FakeDatabase.prototype, "transaction").mockImplementation(function (
    this: { name: string },
    ...args: unknown[]
  ) {
    const transaction = transact.apply(this, args);
    if (
      (stage === "archive" &&
        this.name === "registry:retired" &&
        args[0] === "updates" &&
        args[1] === "readwrite") ||
      (stage === "source" &&
        this.name === "registry" &&
        Array.isArray(args[0]) &&
        args[0].length === 2)
    )
      queueMicrotask(() => transaction.abort());
    return transaction;
  });
  await expect(prepareLocalMirror("registry", "new")).rejects.toBeNull();
  spy.mockRestore();
  const reopened = await open("registry");
  expect(reopened.doc.getText("body").toString()).toBe("Keep pending");
  expect(await hasUnconfirmedLocalState(reopened.mirror)).toBe(true);
});

it("archives a late cross-tab update before clearing the superseded mirror", async () => {
  const { doc, mirror } = await open("registry");
  doc.getText("body").insert(0, "First");
  await hasUnconfirmedLocalState(mirror);
  const transact = FakeDatabase.prototype.transaction;
  let appended = false;
  vi.spyOn(FakeDatabase.prototype, "transaction").mockImplementation(function (
    this: { name: string },
    ...args: unknown[]
  ) {
    const transaction = transact.apply(this, args);
    if (!appended && this.name === "registry:retired" && args[0] === "updates") {
      transaction.addEventListener(
        "complete",
        () => {
          appended = true;
          doc.getText("body").insert(5, " and late");
        },
        { once: true },
      );
    }
    return transaction;
  });
  await prepareLocalMirror("registry", "next");
  expect(appended).toBe(true);
  expect((await open("registry:retired")).doc.getText("body").toString()).toBe("First and late");
  expect((await open("next")).doc.getText("body").length).toBe(0);
});

it("rejects an asynchronous database-open denial before attaching an upstream provider", async () => {
  const cause = new DOMException("Storage denied", "SecurityError");
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    const request = { error: cause } as IDBOpenDBRequest;
    queueMicrotask(() => request.onerror?.(new Event("error")));
    return request;
  });
  await expect(prepareLocalMirror("denied", "next")).rejects.toMatchObject({
    name: "LocalMirrorError",
    mirrorName: "denied",
    cause,
  });
  await expect(clearLocalMirrors("denied")).rejects.toBeInstanceOf(LocalMirrorError);
});

it("rejects corrupt persisted hydration without changing the live document", async () => {
  const { mirror } = await open("corrupt");
  const database = mirror.db as NonNullable<IndexeddbPersistence["db"]>;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction("updates", "readwrite");
    transaction.objectStore("updates").add(new Uint8Array([255]));
    transaction.oncomplete = () => resolve();
  });
  const live = new Doc();
  try {
    live.getText("body").insert(0, "Online state");
    await expect(openLocalMirror("corrupt", live)).rejects.toBeInstanceOf(LocalMirrorError);
    expect(live.getText("body").toString()).toBe("Online state");
  } finally {
    live.destroy();
  }
});

it("contains a preliminary probe transaction abort and closes its database", async () => {
  const transact = FakeDatabase.prototype.transaction;
  const close = vi.spyOn(FakeDatabase.prototype, "close");
  vi.spyOn(FakeDatabase.prototype, "transaction").mockImplementation(function (
    this: { name: string },
    ...args: unknown[]
  ) {
    const transaction = transact.apply(this, args);
    if (args[0] === "updates" && args[1] === "readonly") queueMicrotask(() => transaction.abort());
    return transaction;
  });
  await expect(prepareLocalMirror("aborted", "next")).rejects.toBeInstanceOf(LocalMirrorError);
  expect(close).toHaveBeenCalled();
});

it.each([
  "abort",
  "request error",
])("rejects and destroys the real provider if hydration fails after synced (%s)", async (fault) => {
  if (fault === "request error") {
    const seed = await open("aborted-hydration");
    await seed.mirror.destroy();
    seed.doc.destroy();
  }
  const add = FakeObjectStore.prototype.add;
  const destroyed = vi.spyOn(IndexeddbPersistence.prototype, "destroy");
  let aborted = false;
  let injected = false;
  vi.spyOn(FakeObjectStore.prototype, "add").mockImplementation(function (
    this: IDBObjectStore,
    ...args: unknown[]
  ) {
    if (this.name === "updates" && !injected) {
      injected = true;
      this.transaction.addEventListener("abort", () => {
        aborted = true;
      });
      // The seeded update at key 1 makes the write fail and abort naturally.
      const request =
        fault === "request error" ? add.call(this, args[0], 1) : add.apply(this, args);
      if (fault === "abort") request.addEventListener("success", () => this.transaction.abort());
      return request;
    }
    return add.apply(this, args);
  });
  const doc = new Doc();
  try {
    doc.getText("body").insert(0, "Online state to persist");
    await expect(openLocalMirror("aborted-hydration", doc)).rejects.toMatchObject({
      name: "LocalMirrorError",
      mirrorName: "aborted-hydration",
    });
    expect(aborted).toBe(true);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(doc.getText("body").toString()).toBe("Online state to persist");
    // Reopening queues behind the abort and its failed requests. Vitest also
    // fails this test if the upstream initialization leaks a rejection.
    expect((await open("aborted-hydration")).doc.getText("body").toString()).toBe("");
  } finally {
    doc.destroy();
  }
});

it.each(["abort", "missing updates"])("rejects if hydration verification has %s", async (fault) => {
  const getAll = FakeObjectStore.prototype.getAll;
  let reads = 0;
  vi.spyOn(FakeObjectStore.prototype, "getAll").mockImplementation(function (
    this: IDBObjectStore,
    ...args: unknown[]
  ) {
    if (this.name === "updates" && this.transaction.mode === "readonly" && ++reads === 2) {
      if (fault === "abort") queueMicrotask(() => this.transaction.abort());
      else return getAll.call(this, 0);
    }
    return getAll.apply(this, args);
  });
  const destroyed = vi.spyOn(IndexeddbPersistence.prototype, "destroy");
  const doc = new Doc();
  try {
    doc.getText("body").insert(0, "Online state to persist");
    await expect(openLocalMirror("failed-verification", doc)).rejects.toBeInstanceOf(
      LocalMirrorError,
    );
    expect(reads).toBe(2);
    expect(destroyed).toHaveBeenCalledOnce();
  } finally {
    doc.destroy();
  }
});

it("only reports readiness after hydration and verification transactions commit", async () => {
  const transact = FakeDatabase.prototype.transaction;
  const committed: string[] = [];
  vi.spyOn(FakeDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase,
    ...args: unknown[]
  ) {
    const transaction = transact.apply(this, args);
    transaction.addEventListener("complete", () => committed.push(transaction.mode));
    return transaction;
  });
  const doc = new Doc();
  doc.getText("body").insert(0, "Durable online state");
  const mirror = await openLocalMirror("committed-hydration", doc);
  opened.push({ doc, mirror });
  expect(committed).toEqual(["versionchange", "readonly", "readwrite", "readonly"]);
  expect((await open("committed-hydration")).doc.getText("body").toString()).toBe(
    "Durable online state",
  );
});

it.each(
  [false, true].flatMap((pending) => [false, true].map((active) => ({ pending, active }))),
)("retires a closed publisher without replacing a newer registry entry (pending=$pending, active=$active)", async ({
  pending,
  active,
}) => {
  await prepareLocalMirror("registry", "old");
  const old = await open("old");
  old.doc.getText("body").insert(0, "Retired content");
  if (!pending) await confirm(old.mirror);
  // The current instance can already have become active on another tab.
  const registry = await open("registry");
  await registry.mirror.set("activeMirror", active ? "old" : "new");
  await retireLocalMirror("registry", "old");
  expect(await registry.mirror.get("activeMirror")).toBe(active ? undefined : "new");
  expect(JSON.parse(await registry.mirror.get("retiredMirrors"))).toEqual(
    pending ? ["old:retired"] : [],
  );
  if (pending)
    expect((await open("old:retired")).doc.getText("body").toString()).toBe("Retired content");
});

it("removes database readiness listeners after a successful hydration", async () => {
  const { mirror } = await open();
  const database = mirror.db as NonNullable<IndexeddbPersistence["db"]>;
  const remove = vi.spyOn(database, "removeEventListener");
  await waitForLocalMirror(mirror);
  expect(remove).toHaveBeenCalledWith("error", expect.any(Function), true);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});
