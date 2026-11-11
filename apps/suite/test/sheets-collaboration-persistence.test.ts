// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  cells,
  checkpoint,
  LOCAL_ORIGIN,
  sheetStates,
} from "../src/apps/sheets/lib/collaboration/model";
import {
  WorkbookCollaboration,
  workbookMirrorName,
} from "../src/apps/sheets/lib/collaboration/persistence";
import type { Snapshot } from "../src/apps/sheets/lib/contract";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

const container = `${POD}sheets/shared/collab/`;
const snapshot: Snapshot = {
  id: "book",
  sheetOrder: ["data"],
  styles: {},
  sheets: {
    data: {
      id: "data",
      name: "Data",
      rowCount: 3,
      columnCount: 2,
      cellData: { 0: { 0: { v: "Seed" } } },
    },
  },
};

function transport() {
  const updates = new Map<string, Uint8Array>();
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT") {
      if (updates.has(url)) return new Response(null, { status: 412 });
      updates.set(url, new Uint8Array(init.body as ArrayBuffer));
      return new Response(null, { status: 201 });
    }
    const value = updates.get(url);
    return new Response(value as BodyInit | undefined, { status: value ? 200 : 404 });
  });
  class FakeStore extends SolidUpdateStore {
    writes = 0;
    failWrite = false;
    failRead = false;
    constructor() {
      super({ container, fetch });
    }
    override async appendUpdate(update: Uint8Array) {
      if (this.failWrite) {
        this.failWrite = false;
        throw new Error("Offline");
      }
      this.writes++;
      const url = `${container}${crypto.randomUUID()}`;
      updates.set(url, update.slice());
      return { url };
    }
    override async listUpdateUrls() {
      if (this.failRead) throw new Error("Unavailable");
      return [...updates.keys()];
    }
    override async readUpdate(url: string) {
      return updates.get(url) ?? null;
    }
    override async loadUpdates() {
      return (await this.listUpdateUrls()).map((url) => ({
        url,
        update: updates.get(url) as Uint8Array,
      }));
    }
  }
  const open = async (readOnly = false) => {
    const store = new FakeStore();
    const runtime = new WorkbookCollaboration(container, fetch, readOnly, store);
    await runtime.open(snapshot);
    return { runtime, store };
  };
  return { updates, fetch, FakeStore, open };
}

function edit(runtime: WorkbookCollaboration, value: string) {
  const state = sheetStates(runtime.doc).get("data");
  const key = [...cells(state as NonNullable<typeof state>).keys()][0] as string;
  runtime.doc.transact(
    () => cells(state as NonNullable<typeof state>).set(key, { v: value }),
    LOCAL_ORIGIN,
  );
}

afterEach(() => vi.useRealTimers());

it("recovers an offline edit from the WebID-scoped mirror after failed teardown and persists it before snapshot saves", async () => {
  const { IDBFactory, IDBKeyRange } = createRequire(
    `${process.cwd()}/../../packages/solid-offline/package.json`,
  )("fake-indexeddb") as {
    IDBFactory: new () => IDBFactory;
    IDBKeyRange: typeof globalThis.IDBKeyRange;
  };
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const h = await harness();
  const runtimes: WorkbookCollaboration[] = [];
  try {
    const book = await h.service.create({ title: "Offline", snapshot });
    const first = (await h.service.collaborate?.(
      book.container,
      book.snapshot,
      false,
    )) as WorkbookCollaboration;
    runtimes.push(first);
    const baseline = first.checkpoint();
    h.setHook((call) =>
      call.method === "PUT" && call.url.includes("/collab/")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    edit(first, "Offline edit");
    await expect(first.flush()).rejects.toThrow();
    const pending = {
      ...structuredClone(book.snapshot),
      collaboration: first.checkpoint(),
      sheets: {
        data: {
          ...(book.snapshot.sheets as Record<string, object>).data,
          cellData: { 0: { 0: { v: "Offline edit" } } },
        },
      },
    };
    expect(pending.collaboration.stateVector).toBe(baseline.stateVector);
    expect(checkpoint(first.doc).stateVector).not.toBe(baseline.stateVector);
    await expect(first.destroy()).rejects.toThrow();
    // A snapshot can finish after collaboration teardown. Its vector must still
    // describe only the confirmed log, even if the grid contains offline edits.
    h.setHook(() => undefined);
    const saved = await h.service.save(book.container, pending, book.version);
    const other = createWorkbookService({ ...h.options, webId: "https://other.example/#me" });
    const isolated = (await other.collaborate?.(
      book.container,
      pending,
      false,
    )) as WorkbookCollaboration;
    runtimes.push(isolated);
    expect(JSON.stringify(sheetStates(isolated.doc).toJSON())).not.toContain("Offline edit");
    const viewer = (await h.service.collaborate?.(
      book.container,
      pending,
      true,
    )) as WorkbookCollaboration;
    runtimes.push(viewer);
    expect(JSON.stringify(sheetStates(viewer.doc).toJSON())).not.toContain("Offline edit");
    const recovered = (await h.service.collaborate?.(
      book.container,
      pending,
      false,
    )) as WorkbookCollaboration;
    runtimes.push(recovered);
    expect(JSON.stringify(sheetStates(recovered.doc).toJSON())).toContain("Offline edit");
    const next = structuredClone(book.snapshot);
    next.collaboration = recovered.checkpoint();
    next.sheets = {
      data: {
        ...(next.sheets as Record<string, object>).data,
        cellData: { 0: { 0: { v: "Offline edit" } } },
      },
    };
    await h.service.save(book.container, next, saved.version);
    const persisted = await h.storage.loadSnapshot(book.container);
    expect(persisted.value.collaboration).toEqual(next.collaboration);
    const fresh = (await other.collaborate?.(
      book.container,
      persisted.value,
      true,
    )) as WorkbookCollaboration;
    runtimes.push(fresh);
    expect(JSON.stringify(sheetStates(fresh.doc).toJSON())).toContain("Offline edit");
    const log = new Y.Doc();
    for (const entry of await fresh.provider.store.loadUpdates()) Y.applyUpdate(log, entry.update);
    expect(checkpoint(log).stateVector).toBe(next.collaboration.stateVector);
    log.destroy();
    expect(workbookMirrorName(WEBID, book.container)).not.toBe(
      workbookMirrorName("other", book.container),
    );
    expect(workbookMirrorName(WEBID, book.container)).not.toBe(
      workbookMirrorName(WEBID, `${book.container}other/`),
    );
  } finally {
    h.setHook(() => undefined);
    await Promise.all(runtimes.map((runtime) => runtime.destroy().catch(() => {})));
    vi.unstubAllGlobals();
  }
});

it("uses a single canonical seed for racing first-openers and never reseeds a later load", async () => {
  const t = transport();
  const [a, b] = await Promise.all([t.open(), t.open()]);
  try {
    expect(t.updates.size).toBe(1);
    expect(checkpoint(a.runtime.doc)).toEqual(checkpoint(b.runtime.doc));
    edit(a.runtime, "Persisted");
    await a.runtime.flush();
    await b.runtime.sync();
    expect(sheetStates(a.runtime.doc).toJSON()).toEqual(sheetStates(b.runtime.doc).toJSON());
    const c = await t.open();
    expect([
      ...cells(
        sheetStates(c.runtime.doc).get("data") as NonNullable<
          ReturnType<ReturnType<typeof sheetStates>["get"]>
        >,
      ).values(),
    ]).toContainEqual({ v: "Persisted" });
    expect(t.fetch).toHaveBeenCalledTimes(2); // Winner and losing If-None-Match seed attempts.
    await c.runtime.destroy();
  } finally {
    await a.runtime.destroy();
    await b.runtime.destroy();
  }
});

it("keeps canonical seed creation inside the normalized log container", async () => {
  const t = transport();
  const runtime = new WorkbookCollaboration(
    container.slice(0, -1),
    t.fetch,
    false,
    new t.FakeStore(),
  );
  await runtime.open(snapshot);
  expect(runtime.container).toBe(container);
  expect([...t.updates.keys()]).toEqual([`${container}seed`]);
  await runtime.destroy();
});

it("keeps legacy and initialized view-only loads read-only, including stray local Y transactions", async () => {
  const t = transport();
  const empty = await t.open(true);
  expect(t.updates.size).toBe(0);
  expect(sheetStates(empty.runtime.doc).size).toBe(0);
  const writer = await t.open();
  await empty.runtime.sync();
  const viewer = await t.open(true);
  edit(writer.runtime, "Remote");
  await writer.runtime.flush();
  await viewer.runtime.sync();
  expect(sheetStates(viewer.runtime.doc).toJSON()).toEqual(
    sheetStates(writer.runtime.doc).toJSON(),
  );
  edit(viewer.runtime, "Stray");
  await viewer.runtime.flush();
  expect(viewer.store.writes).toBe(0);
  expect(empty.store.writes).toBe(0);
  await Promise.all([empty.runtime.destroy(), viewer.runtime.destroy(), writer.runtime.destroy()]);
});

it("repairs failed appends with full state before a flush can acknowledge persistence", async () => {
  const t = transport();
  const a = await t.open();
  a.store.failWrite = true;
  edit(a.runtime, "Retained");
  await a.runtime.flush();
  expect(a.store.writes).toBe(1);
  const b = await t.open();
  expect(sheetStates(b.runtime.doc).toJSON()).toEqual(sheetStates(a.runtime.doc).toJSON());
  await a.runtime.destroy();
  await a.runtime.destroy();
  await a.runtime.sync();
  await b.runtime.destroy();
});

it("retains a newer append failure while an older full-state repair is in flight", async () => {
  const t = transport();
  const a = await t.open();
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let repairing = false;
  const append = a.store.appendUpdate.bind(a.store);
  try {
    a.store.failWrite = true;
    edit(a.runtime, "First offline edit");
    await a.runtime.provider.flush();
    vi.spyOn(a.store, "appendUpdate").mockImplementationOnce(async (update) => {
      repairing = true;
      await waiting;
      return append(update);
    });
    const repair = a.runtime.flush();
    await vi.waitFor(() => expect(repairing).toBe(true));
    a.store.failWrite = true;
    edit(a.runtime, "Newer offline edit");
    await a.runtime.provider.flush();
    release();
    await repair;
    await a.runtime.flush();
    const b = await t.open();
    try {
      expect(sheetStates(b.runtime.doc).toJSON()).toEqual(sheetStates(a.runtime.doc).toJSON());
      expect(a.runtime.checkpoint().stateVector).toBe(checkpoint(b.runtime.doc).stateVector);
    } finally {
      await b.runtime.destroy();
    }
  } finally {
    release();
    await a.runtime.destroy();
  }
});

it("cleans up rejected hydration and seed writes and serializes sync retries", async () => {
  const t = transport();
  const store = new t.FakeStore();
  store.failRead = true;
  const failed = new WorkbookCollaboration(container, t.fetch, false, store);
  await expect(failed.open(snapshot)).rejects.toThrow("Unavailable");
  expect(failed.provider.destroyed).toBe(true);
  const badSeed = new WorkbookCollaboration(
    container,
    async () => new Response(null, { status: 403 }),
    false,
    new t.FakeStore(),
  );
  await expect(badSeed.open(snapshot)).rejects.toThrow();
  const a = await t.open();
  a.store.failRead = true;
  await expect(a.runtime.sync()).rejects.toThrow("Unavailable");
  a.store.failRead = false;
  await a.runtime.sync();
  await a.runtime.destroy();
});

it("responds to scoped notifications, focus, reconnect and visible polling, and tears down listeners", async () => {
  vi.useFakeTimers();
  const t = transport();
  const a = await t.open();
  let change: (url: string) => void = () => {};
  const unsubscribe = vi.fn();
  const subscribe = (listener: typeof change) => {
    change = listener;
    return unsubscribe;
  };
  const sync = vi.spyOn(a.runtime, "sync");
  const flush = vi.spyOn(a.runtime, "flush");
  a.runtime.watch(subscribe);
  a.runtime.watch(subscribe);
  expect(unsubscribe).toHaveBeenCalledOnce();
  change(`${container}remote`);
  change("https://foreign.example/update");
  change(container);
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await vi.advanceTimersByTimeAsync(30_000);
  const before = sync.mock.calls.length;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(sync).toHaveBeenCalledTimes(before);
  expect(flush).toHaveBeenCalled();
  await a.runtime.destroy();
  window.dispatchEvent(new Event("focus"));
  expect(sync).toHaveBeenCalledTimes(before);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it("stores real binary y-solid updates beside the workbook, preserves projections and checks scope", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Live", snapshot });
  const a = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  edit(a, "Real store");
  await a.flush();
  const b = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    true,
  )) as WorkbookCollaboration;
  expect(sheetStates(b.doc).toJSON()).toEqual(sheetStates(a.doc).toJSON());
  expect(
    h.calls.filter((call) => call.method === "PUT" && call.url.includes("/collab/")).length,
  ).toBeGreaterThanOrEqual(2);
  await expect(
    h.service.collaborate?.("https://foreign.example/sheets/book/", snapshot, false),
  ).rejects.toThrow();
  await a.destroy();
  await b.destroy();
});

it("reports corrupt hydration instead of seeding over a damaged log", async () => {
  const t = transport();
  t.updates.set(`${container}bad`, new Uint8Array([255]));
  await expect(t.open()).rejects.toThrow("corrupt update");
  expect(t.fetch).not.toHaveBeenCalled();
});

it("opens a same-origin public collaborator's log with credential-free reads and no writer", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Public", snapshot });
  const owner = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  const publicFetch = vi.fn<typeof fetch>(h.fetch);
  const service = createWorkbookService({
    ...h.options,
    podRoot: "https://pod.example/bob/",
    publicFetch,
  });
  const viewer = (await service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  expect(viewer.readOnly).toBe(true);
  expect(publicFetch).toHaveBeenCalled();
  expect(
    publicFetch.mock.calls.every(
      ([, init]) => init?.credentials === "omit" && (!init.method || init.method === "GET"),
    ),
  ).toBe(true);
  await viewer.destroy();
  await owner.destroy();
});

it("rejects an unpersisted or corrupt canonical seed and cleans up its provider", async () => {
  const t = transport();
  const missing = new WorkbookCollaboration(
    container,
    async () => new Response(null, { status: 201 }),
    false,
    new t.FakeStore(),
  );
  await expect(missing.open(snapshot)).rejects.toThrow("Couldn't load");
  const corrupt = new WorkbookCollaboration(
    container,
    async () => {
      t.updates.set(`${container}seed`, new Uint8Array([255]));
      return new Response(null, { status: 201 });
    },
    false,
    new t.FakeStore(),
  );
  await expect(corrupt.open(snapshot)).rejects.toThrow("corrupt update");
});

it("contains background sync and teardown failures while retaining explicit errors for retries", async () => {
  const t = transport();
  const a = await t.open();
  a.store.failRead = true;
  a.runtime.watch(() => () => {});
  await expect(a.runtime.sync()).rejects.toThrow("Unavailable");
  const flush = vi.spyOn(a.runtime, "flush").mockRejectedValue(new Error("Offline"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  await Promise.resolve();
  await expect(a.runtime.destroy()).rejects.toThrow("Offline");
  expect(a.runtime.provider.destroyed).toBe(true);
  flush.mockRestore();
});

it.each([
  false,
  true,
])("isolates a recreated slug from its prior instance (unconfirmed=%s)", async (pending) => {
  const { IDBFactory, IDBKeyRange } = createRequire(
    `${process.cwd()}/../../packages/solid-offline/package.json`,
  )("fake-indexeddb");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const h = await harness();
  const runtimes: WorkbookCollaboration[] = [];
  try {
    const old = await h.service.create({ title: "Recreated", snapshot });
    const first = (await h.service.collaborate?.(
      old.container,
      old.snapshot,
      false,
    )) as WorkbookCollaboration;
    runtimes.push(first);
    if (pending)
      h.setHook((call) =>
        call.method === "PUT" && call.url.includes("/collab/")
          ? new Response(null, { status: 503 })
          : undefined,
      );
    edit(first, "Deleted content");
    await first.destroy().catch(() => {});
    h.setHook(() => undefined);
    // Deletion in another browser/account leaves this WebID's local mirror behind.
    await createWorkbookService({ ...h.options, webId: "another-browser" }).remove(old.container);
    const replacement = await h.service.create({
      title: "Recreated",
      snapshot: {
        ...snapshot,
        sheets: { data: { ...(snapshot.sheets as Record<string, object>).data, cellData: {} } },
      },
    });
    expect(replacement.container).toBe(old.container);
    expect(replacement.snapshot.id).not.toBe(old.snapshot.id);
    expect(workbookMirrorName(WEBID, old.container, old.snapshot.id as string)).not.toBe(
      workbookMirrorName(WEBID, old.container, replacement.snapshot.id as string),
    );
    const reopened = (await h.service.collaborate?.(
      replacement.container,
      replacement.snapshot,
      false,
    )) as WorkbookCollaboration;
    runtimes.push(reopened);
    expect(JSON.stringify(sheetStates(reopened.doc).toJSON())).not.toContain("Deleted content");
    const log = new Y.Doc();
    for (const entry of await reopened.provider.store.loadUpdates())
      Y.applyUpdate(log, entry.update);
    expect(JSON.stringify(sheetStates(log).toJSON())).not.toContain("Deleted content");
    log.destroy();
    const names = (await indexedDB.databases()).map((item) => item.name);
    const retired = `${workbookMirrorName(WEBID, old.container, old.snapshot.id as string)}:retired`;
    expect(names.includes(retired)).toBe(pending);
    await h.service.remove(replacement.container);
    const remaining = (await indexedDB.databases()).map((item) => item.name);
    expect(remaining).not.toContain(retired);
    expect(remaining).not.toContain(
      workbookMirrorName(WEBID, replacement.container, replacement.snapshot.id as string),
    );
  } finally {
    h.setHook(() => undefined);
    await Promise.all(runtimes.map((runtime) => runtime.destroy().catch(() => {})));
    vi.unstubAllGlobals();
  }
});

it("conditionally upgrades legacy workbook IDs once and returns the saved validator", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Legacy", snapshot });
  const legacy = { ...book.snapshot };
  delete legacy.id;
  await h.storage.saveSnapshot(book.container, legacy, { ifMatch: book.version.snapshotEtag });
  const opened = await h.service.open(book.container);
  expect(opened.snapshot.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(opened.snapshot.id).not.toBe(book.snapshot.id);
  const persisted = await h.storage.loadSnapshot(book.container);
  expect(persisted.value).toEqual(opened.snapshot);
  expect(persisted.etag).toBe(opened.version.snapshotEtag);
  expect((await h.service.open(book.container)).snapshot.id).toBe(opened.snapshot.id);
  await expect(
    h.service.save(book.container, opened.snapshot, opened.version),
  ).resolves.toBeDefined();
});

it("re-reads a legacy ID migration that loses its If-Match race", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Racing migration", snapshot });
  const legacy = { ...book.snapshot };
  delete legacy.id;
  await h.storage.saveSnapshot(book.container, legacy, { ifMatch: book.version.snapshotEtag });
  const winner = crypto.randomUUID();
  let raced = false;
  h.setHook(async (call) => {
    if (!raced && call.method === "PUT" && call.url.endsWith("workbook.json")) {
      raced = true;
      await h.pod.fetch(call.url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...book.snapshot, id: winner }),
      });
    }
    return undefined;
  });
  const opened = await h.service.open(book.container);
  expect(raced).toBe(true);
  expect(opened.snapshot.id).toBe(winner);
});
