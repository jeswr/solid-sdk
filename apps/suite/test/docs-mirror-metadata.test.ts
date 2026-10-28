// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import type { IndexeddbPersistence } from "y-indexeddb";
import { updateMirrorMetadata } from "../src/apps/docs/editor/mirror-metadata";

/** Serial request scheduler for the IndexedDB custom-store transaction seam. */
function database(values: Map<string, unknown>, fail = false) {
  return {
    transaction: () => {
      const requests: { key: string; result?: unknown; onsuccess?: () => void }[] = [];
      const transaction = {
        error: new DOMException("Storage failure", "UnknownError"),
        oncomplete: () => {},
        onabort: () => {},
        onerror: () => {},
        objectStore: () => ({
          get: (key: string) => {
            const request = { key };
            requests.push(request);
            return request;
          },
          put: (value: unknown, key: string) => values.set(key, value),
        }),
      };
      queueMicrotask(() => {
        if (fail) {
          transaction.onabort();
          return;
        }
        for (const request of requests) {
          request.result = values.get(request.key);
          request.onsuccess?.();
        }
        transaction.oncomplete();
      });
      return transaction;
    },
  } as unknown as IDBDatabase;
}
it("atomically compares pending metadata with the durable title across queued tab transactions", async () => {
  const values = new Map<string, unknown>([
    ["pending", 1],
    ["title", "Original"],
  ]);
  const mirror = { db: database(values) } as IndexeddbPersistence;
  const rename = updateMirrorMetadata(
    mirror,
    () => ({ pending: 1, title: "Rename in A", edit: "A" }),
    () => true,
  );
  const bodySave = updateMirrorMetadata(
    mirror,
    (current) => (current.title === "Original" ? { pending: 0 } : undefined),
    () => true,
  );
  await Promise.all([rename, bodySave]);
  expect(values.get("title")).toBe("Rename in A");
  expect(values.get("pending")).toBe(1);
  await updateMirrorMetadata(
    mirror,
    (current) => (current.title === "Rename in A" ? { pending: 0 } : undefined),
    () => true,
  );
  expect(values.get("pending")).toBe(0);
});
it("ignores a superseded metadata transaction and propagates transaction failures for retry", async () => {
  const values = new Map<string, unknown>([["pending", 1]]);
  const mirror = { db: database(values) } as IndexeddbPersistence;
  await updateMirrorMetadata(
    mirror,
    () => ({ pending: 0 }),
    () => false,
  );
  expect(values.get("pending")).toBe(1);
  await expect(
    updateMirrorMetadata(
      { db: database(values, true) } as IndexeddbPersistence,
      () => undefined,
      () => true,
    ),
  ).rejects.toMatchObject({ name: "UnknownError" });
});

it("waits for an opening mirror's database before comparing and updating metadata atomically", async () => {
  const values = new Map<string, unknown>([["pending", 1]]);
  let release = (_database: IDBDatabase) => {};
  const opening = new Promise<IDBDatabase>((resolve) => {
    release = resolve;
  });
  const get = vi.fn();
  const mirror = { db: null, get } as unknown as IndexeddbPersistence;
  Object.defineProperty(mirror, "_db", { value: opening });
  const writing = updateMirrorMetadata(
    mirror,
    () => ({ title: "Pending title" }),
    () => true,
  );
  expect(values.has("title")).toBe(false);
  release(database(values));
  await writing;
  expect(values.get("title")).toBe("Pending title");
  expect(get).not.toHaveBeenCalled();
});
