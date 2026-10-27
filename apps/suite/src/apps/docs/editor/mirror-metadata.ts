// AUTHORED-BY Codex
import type { IndexeddbPersistence } from "y-indexeddb";

type Metadata = Record<"pending" | "title" | "edit", unknown>;
/** Keep the comparison and writes in one cross-tab IndexedDB transaction. */
export async function updateMirrorMetadata(
  mirror: IndexeddbPersistence,
  update: (current: Metadata) => Record<string, string | number> | undefined,
  active: () => boolean,
): Promise<void> {
  const keys = ["pending", "title", "edit"] as const;
  const database = mirror.db ?? (await mirror._db);
  // In-memory mirror adapters expose the same get/set contract without a database.
  if (!database) {
    const [pending, title, edit] = await Promise.all(keys.map((key) => mirror.get(key)));
    const writes = active() ? update({ pending, title, edit }) : undefined;
    for (const [key, value] of Object.entries(writes ?? {})) {
      if (!active()) return;
      await mirror.set(key, value);
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("custom", "readwrite");
    const store = transaction.objectStore("custom");
    const current: Metadata = { pending: undefined, title: undefined, edit: undefined };
    let remaining = keys.length;
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        current[key] = request.result;
        if (--remaining || !active()) return;
        const writes = update(current);
        for (const [name, value] of Object.entries(writes ?? {})) store.put(value, name);
      };
    }
  });
}
