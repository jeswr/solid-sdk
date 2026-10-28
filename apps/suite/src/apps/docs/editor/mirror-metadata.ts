// AUTHORED-BY Codex
import type { IndexeddbPersistence } from "y-indexeddb";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";

type Metadata = Record<"pending" | "title" | "edit", unknown>;
/** Keep the comparison and writes in one cross-tab IndexedDB transaction. */
export async function updateMirrorMetadata(
  mirror: IndexeddbPersistence,
  update: (current: Metadata) => Record<string, string | number> | undefined,
  active: () => boolean,
  confirmed?: Uint8Array,
): Promise<boolean> {
  const covered = (updates: Uint8Array[]) => {
    if (!confirmed) return true;
    const probe = new Doc();
    try {
      applyUpdate(probe, confirmed);
      for (const update of updates) applyUpdate(probe, update);
      const merged = encodeStateAsUpdate(probe);
      return (
        merged.length === confirmed.length &&
        merged.every((byte, index) => byte === confirmed[index])
      );
    } finally {
      probe.destroy();
    }
  };
  const keys = ["pending", "title", "edit"] as const;
  const database = mirror.db ?? (await mirror._db);
  // In-memory mirror adapters expose the same get/set contract without a database.
  if (!database) {
    const [pending, title, edit] = await Promise.all(keys.map((key) => mirror.get(key)));
    const writes =
      active() && covered(confirmed ? [encodeStateAsUpdate(mirror.doc)] : [])
        ? update({ pending, title, edit })
        : undefined;
    for (const [key, value] of Object.entries(writes ?? {})) {
      if (!active()) return false;
      await mirror.set(key, value);
    }
    return writes !== undefined;
  }
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(
      confirmed ? ["custom", "updates"] : ["custom"],
      "readwrite",
    );
    const store = transaction.objectStore("custom");
    const current: Metadata = { pending: undefined, title: undefined, edit: undefined };
    let remaining = keys.length + (confirmed ? 1 : 0);
    let updates: Uint8Array[] = [];
    let written = false;
    const finish = () => {
      if (--remaining || !active() || !covered(updates)) return;
      const writes = update(current);
      for (const [name, value] of Object.entries(writes ?? {})) store.put(value, name);
      written = writes !== undefined;
    };
    transaction.oncomplete = () => resolve(written);
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
    if (confirmed) {
      const request = transaction.objectStore("updates").getAll();
      request.onsuccess = () => {
        updates = request.result;
        finish();
      };
    }
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        current[key] = request.result;
        finish();
      };
    }
  });
}
