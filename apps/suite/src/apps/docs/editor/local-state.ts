// AUTHORED-BY Codex
import { type IndexeddbPersistence, storeState } from "y-indexeddb";
import { applyUpdate, type Doc, encodeStateAsUpdate } from "yjs";
import { coversUpdates } from "./update-coverage";

async function persistedUpdates(database: IDBDatabase) {
  return new Promise<Uint8Array[]>((resolve, reject) => {
    const transaction = database.transaction("updates", "readonly");
    const request = transaction.objectStore("updates").getAll();
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}

/** The pending marker can abort independently of y-indexeddb's delta transaction. */
export async function hasUnconfirmedLocalState(
  mirror: IndexeddbPersistence,
  loadConfirmed: () => Promise<Uint8Array | undefined> = async () => undefined,
) {
  const database = mirror.db ?? (await mirror._db);
  const updates = database ? await persistedUpdates(database) : [encodeStateAsUpdate(mirror.doc)];
  const empty = new Uint8Array([0, 0]);
  if (coversUpdates(empty, updates)) return false;
  const stored: unknown = await mirror.get("confirmed");
  // IndexedDB can clone buffers from another realm (including browser adapters).
  let confirmed: Uint8Array | undefined =
    Object.prototype.toString.call(stored) === "[object ArrayBuffer]"
      ? new Uint8Array(stored as ArrayBuffer)
      : undefined;
  if (confirmed && coversUpdates(confirmed, updates)) return false;
  // An old baseline can miss either local edits or newly loaded pod updates.
  // Reconcile against this mirror's own log, including retired incarnations,
  // rather than trusting the pending flag or HTML snapshot.
  const remote = await loadConfirmed();
  if (remote) {
    confirmed = remote;
    await mirror.set("confirmed", Uint8Array.from(confirmed).buffer);
  }
  return !(confirmed && coversUpdates(confirmed, updates));
}

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
      const updates = await persistedUpdates(database);
      doc.transact(() => {
        for (const update of updates) applyUpdate(doc, update, mirror);
      }, mirror);
    }
    return changed;
  } finally {
    doc.off("update", onUpdate);
  }
}
