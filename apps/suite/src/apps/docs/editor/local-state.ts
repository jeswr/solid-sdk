// AUTHORED-BY Codex
import { type IndexeddbPersistence, storeState } from "y-indexeddb";
import { applyUpdate, type Doc } from "yjs";

/** Read the whole shared mirror: another tab may have compacted its update keys. */
export async function loadPersistedLocalState(doc: Doc, mirror: IndexeddbPersistence) {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  doc.on("update", onUpdate);
  try {
    const database = mirror.db ?? (await mirror._db);
    if (!database) {
      // In-memory adapters implement the provider's merge/store contract.
      await storeState(mirror, true);
    } else {
      const updates = await new Promise<Uint8Array[]>((resolve, reject) => {
        const transaction = database.transaction("updates", "readonly");
        const request = transaction.objectStore("updates").getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
      doc.transact(() => {
        for (const update of updates) applyUpdate(doc, update, mirror);
      }, mirror);
    }
    return changed;
  } finally {
    doc.off("update", onUpdate);
  }
}
