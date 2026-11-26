// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it, vi } from "vitest";
import { purgeUnscopedFiredReminders } from "../../src/apps/tasks/lib/reminders/fired-store";

const hashed = "a".repeat(64);

/** A synchronous-ish fake of the one object store the purge walks with a cursor. */
function fake(keys: IDBValidKey[], { hasStore = true, abort = false } = {}) {
  const remaining = [...keys];
  const deleted: IDBValidKey[] = [];
  const close = vi.fn();
  const db = {
    close,
    objectStoreNames: { contains: (name: string) => name === "firedReminders" && hasStore },
    transaction: (name: string, mode: string) => {
      expect(name).toBe("firedReminders");
      expect(mode).toBe("readwrite");
      const tx = {} as IDBTransaction;
      const scan = {} as IDBRequest;
      Object.assign(tx, {
        error: new Error("aborted"),
        objectStore: () => ({
          openCursor: () => {
            const step = () => {
              queueMicrotask(() => {
                if (abort) return tx.onabort?.({} as Event);
                const key = remaining.shift();
                if (key === undefined) {
                  Object.assign(scan, { result: null });
                  scan.onsuccess?.({} as Event);
                  tx.oncomplete?.({} as Event);
                  return;
                }
                Object.assign(scan, {
                  result: { key, delete: () => deleted.push(key), continue: step },
                });
                scan.onsuccess?.({} as Event);
              });
            };
            step();
            return scan;
          },
        }),
      });
      return tx;
    },
  } as unknown as IDBDatabase;
  const factory = {
    open: () => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        Object.assign(request, { result: db });
        request.onsuccess?.({} as Event);
      });
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, deleted, close };
}

describe("purging pre-scoping fired reminder records", () => {
  it("deletes every key that is not a digest and keeps digests", async () => {
    const { factory, deleted, close } = fake([
      "https://pod.test/tasks/a.ttl|Call the clinic",
      hashed,
      42,
      "A".repeat(64),
    ]);
    await purgeUnscopedFiredReminders(factory);
    expect(deleted).toEqual(["https://pod.test/tasks/a.ttl|Call the clinic", 42, "A".repeat(64)]);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("does nothing when the database has no reminder store", async () => {
    const { factory, deleted, close } = fake(["legacy"], { hasStore: false });
    await purgeUnscopedFiredReminders(factory);
    expect(deleted).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects with the transaction error and still closes the database", async () => {
    const { factory, close } = fake(["legacy"], { abort: true });
    await expect(purgeUnscopedFiredReminders(factory)).rejects.toThrow("aborted");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
