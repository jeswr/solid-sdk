// AUTHORED-BY Codex
import { type IndexeddbPersistence, storeState } from "y-indexeddb";
import { encodeStateAsUpdate } from "yjs";
import { coversUpdates } from "./update-coverage";

export type MirrorMetadata = Record<"pending" | "title" | "edit" | "alternateEdits", unknown>;
/** Keep the comparison and writes in one cross-tab IndexedDB transaction. */
export async function updateMirrorMetadata(
  mirror: IndexeddbPersistence,
  update: (current: MirrorMetadata) => Record<string, string | number> | undefined,
  active: () => boolean,
  confirmed?: Uint8Array,
  localUpdate?: Uint8Array,
): Promise<boolean> {
  const covered = (updates: Uint8Array[]) => !confirmed || coversUpdates(confirmed, updates);
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
    if (writes && confirmed) await mirror.set("confirmed", Uint8Array.from(confirmed).buffer);
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
      if (writes && confirmed) store.put(Uint8Array.from(confirmed).buffer, "confirmed");
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
