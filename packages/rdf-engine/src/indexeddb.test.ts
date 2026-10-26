// AUTHORED-BY Codex GPT-6
import { afterEach, expect, test, vi } from "vitest";
import { createIndexedDbPersistence } from "./indexeddb.js";

// A controllable browser API boundary: results and commit/error events are independent.
// Real browser round-trips are also exercised by the lane's Chromium acceptance check.
function boundary(
  options: {
    result?: unknown;
    openError?: boolean;
    blocked?: boolean;
    abort?: boolean;
    failTransaction?: boolean;
    deferCommit?: boolean;
  } = {},
) {
  const tx = {
    error: null,
    oncomplete: () => {},
    onerror: () => {},
    onabort: () => {},
    objectStore: vi.fn(),
  };
  const complete = () => {
    if (options.abort) tx.onabort();
    else tx.oncomplete();
  };
  const get = vi.fn(() => {
    if (!options.deferCommit) queueMicrotask(complete);
    return { result: options.result };
  });
  const put = vi.fn(() => {
    if (!options.deferCommit) queueMicrotask(complete);
    return { result: "key" };
  });
  tx.objectStore.mockReturnValue({ get, put });
  const db = {
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn(() => {
      if (options.failTransaction) throw new Error("transaction unavailable");
      return tx;
    }),
  };
  const request = {
    result: db,
    error: new Error("open failed"),
    onupgradeneeded: () => {},
    onsuccess: () => {},
    onerror: () => {},
    onblocked: () => {},
  };
  const open = vi.fn(() => {
    queueMicrotask(() => {
      if (options.openError) request.onerror();
      else if (options.blocked) {
        request.onblocked();
        request.onsuccess();
      } else {
        request.onupgradeneeded();
        request.onsuccess();
      }
    });
    return request;
  });
  return { factory: { open } as unknown as IDBFactory, open, db, tx, get, put, complete };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("IndexedDB uses default database/key, distinguishes missing snapshots, and closes each connection", async () => {
  const api = boundary();
  vi.stubGlobal("indexedDB", api.factory);
  const persist = createIndexedDbPersistence();
  expect(await persist.load()).toBeNull();
  expect(api.open).toHaveBeenCalledWith("jeswr-rdf-engine", 1);
  expect(api.db.createObjectStore).toHaveBeenCalledWith("snapshots");
  expect(api.db.transaction).toHaveBeenCalledWith("snapshots", "readonly");
  expect(api.get).toHaveBeenCalledWith("index");
  expect(api.db.close).toHaveBeenCalledTimes(1);
  const bytes = new Uint8Array([1, 2, 3]);
  await persist.save(bytes);
  expect(api.put).toHaveBeenCalledWith(bytes, "index");
  expect(api.put.mock.calls[0]?.[0]).not.toBe(bytes);
  expect(api.db.transaction).toHaveBeenLastCalledWith("snapshots", "readwrite");
  expect(api.db.close).toHaveBeenCalledTimes(2);
});

test("IndexedDB isolates configured keys, copies loaded bytes and waits for transaction commit", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const api = boundary({ result: bytes, deferCommit: true });
  const persist = createIndexedDbPersistence({
    databaseName: "app",
    key: "search",
    indexedDB: api.factory,
  });
  let settled = false;
  const loading = persist.load().then((result) => {
    settled = true;
    return result;
  });
  await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(settled).toBe(false);
  expect(api.db.close).not.toHaveBeenCalled();
  api.complete();
  const actual = await loading;
  expect(actual).toEqual(bytes);
  expect(actual).not.toBe(bytes);
  expect(api.get).toHaveBeenCalledWith("search");
  expect(api.open).toHaveBeenCalledWith("app", 1);
  const saving = persist.save(bytes);
  await vi.waitFor(() => expect(api.put).toHaveBeenCalled());
  api.complete();
  await saving;
  expect(api.db.close).toHaveBeenCalledTimes(2);
});

test("IndexedDB reports unavailable/open/blocked/transaction/invalid-data failures and closes opened connections", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(createIndexedDbPersistence().load()).rejects.toThrow("unavailable");
  for (const options of [
    { openError: true },
    { blocked: true },
    { abort: true },
    { failTransaction: true },
    { result: "invalid" },
  ]) {
    const api = boundary(options);
    await expect(createIndexedDbPersistence({ indexedDB: api.factory }).load()).rejects.toThrow();
    expect(api.db.close).toHaveBeenCalledTimes(options.openError ? 0 : 1);
  }
});
