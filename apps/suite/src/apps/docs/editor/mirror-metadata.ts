// AUTHORED-BY Codex
import { type IndexeddbPersistence, storeState } from "y-indexeddb";
import { applyUpdate, Doc, encodeStateAsUpdate, equalSnapshots, snapshot } from "yjs";

export type MirrorMetadata = Record<"pending" | "title" | "edit" | "alternateEdits", unknown>;
/** Keep the comparison and writes in one cross-tab IndexedDB transaction. */
export async function updateMirrorMetadata(
  mirror: IndexeddbPersistence,
  update: (current: MirrorMetadata) => Record<string, string | number> | undefined,
  active: () => boolean,
  confirmed?: Uint8Array,
  localUpdate?: Uint8Array,
): Promise<boolean> {
  const covered = (updates: Uint8Array[]) => {
    if (!confirmed) return true;
    const probe = new Doc();
    try {
      applyUpdate(probe, confirmed);
      const durable = snapshot(probe);
      for (const update of updates) applyUpdate(probe, update);
      // A state vector must cover every client's clock. Deletion-only updates
      // do not advance those clocks, so compare the delete sets as well.
      if (!equalSnapshots(durable, snapshot(probe))) return false;
      // Unintegrated structs have no clock in the vector yet. Retain them too.
      const merged = encodeStateAsUpdate(probe);
      return (
        merged.length === confirmed.length &&
        merged.every((byte, index) => byte === confirmed[index])
      );
    } finally {
      probe.destroy();
    }
  };
  const keys = ["pending", "title", "edit", "alternateEdits"] as const;
  const database = mirror.db ?? (await mirror._db);
  // In-memory mirror adapters expose the same get/set contract without a database.
  if (!database) {
    const [pending, title, edit, alternateEdits] = await Promise.all(
      keys.map((key) => mirror.get(key)),
    );
    const writes =
      active() && covered(confirmed ? [encodeStateAsUpdate(mirror.doc)] : [])
        ? update({ pending, title, edit, alternateEdits })
        : undefined;
    for (const [key, value] of Object.entries(writes ?? {})) {
      if (!active()) return false;
      await mirror.set(key, value);
    }
    if (writes && localUpdate) await storeState(mirror, true);
    return writes !== undefined;
  }
  return new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(
      confirmed || localUpdate ? ["custom", "updates"] : ["custom"],
      "readwrite",
    );
    const store = transaction.objectStore("custom");
    const current: MirrorMetadata = {
      pending: undefined,
      title: undefined,
      edit: undefined,
      alternateEdits: undefined,
    };
    let remaining = keys.length + (confirmed ? 1 : 0);
    let updates: Uint8Array[] = [];
    let written = false;
    const finish = () => {
      if (--remaining || !active() || !covered(updates)) return;
      const writes = update(current);
      for (const [name, value] of Object.entries(writes ?? {})) store.put(value, name);
      if (writes && localUpdate) transaction.objectStore("updates").add(localUpdate);
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
