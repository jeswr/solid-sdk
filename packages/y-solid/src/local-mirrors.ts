// AUTHORED-BY Codex GPT-6.1-Sol
import { clearDocument, IndexeddbPersistence } from "y-indexeddb";
import { Doc, encodeStateAsUpdate } from "yjs";
import { hasUnconfirmedLocalState, loadPersistedLocalState } from "./local.js";
import { coversUpdates } from "./update-coverage.js";

async function withMirror<T>(name: string, action: (mirror: IndexeddbPersistence) => Promise<T>) {
  const doc = new Doc();
  const mirror = new IndexeddbPersistence(name, doc);
  try {
    await mirror.whenSynced;
    return await action(mirror);
  } finally {
    await mirror.destroy();
    doc.destroy();
  }
}

/** Isolate an obsolete incarnation; only unacknowledged updates merit retention. */
async function retire(mirror: IndexeddbPersistence) {
  let retired: string | undefined;
  const database = await mirror._db;
  for (;;) {
    // Another tab can append after hydration, or compact all the update keys.
    await loadPersistedLocalState(mirror.doc, mirror);
    const pending = await hasUnconfirmedLocalState(mirror);
    const baseline = encodeStateAsUpdate(mirror.doc);
    if (pending) {
      retired = `${mirror.name}:retired`;
      await withMirror(retired, async (archive) => {
        const database = await archive._db;
        // Commit the archive before attempting to clear the source.
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("updates", "readwrite");
          transaction.objectStore("updates").add(baseline);
          transaction.oncomplete = () => resolve();
          transaction.onabort = transaction.onerror = () => reject(transaction.error);
        });
      });
    }
    const cleared = await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction(["updates", "custom"], "readwrite");
      const updates = transaction.objectStore("updates");
      const request = updates.getAll();
      let cleared = false;
      request.onsuccess = () => {
        // Keep verification and deletion in one transaction. If another tab wrote
        // during archival, include its update in a new archive before retrying.
        if (!coversUpdates(baseline, request.result)) return;
        updates.clear();
        transaction.objectStore("custom").clear();
        cleared = true;
      };
      transaction.oncomplete = () => resolve(cleared);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
    if (cleared) return retired;
  }
}

function retiredNames(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((name): name is string => typeof name === "string")
    : [];
}

/** A namespace also quarantines updates from the former, unversioned mirror. */
export async function prepareLocalMirror(namespace: string, name: string) {
  await withMirror(namespace, async (registry) => {
    const previous: unknown = await registry.get("activeMirror");
    if (previous === name) return;
    const retired = retiredNames(await registry.get("retiredMirrors"));
    if (typeof previous === "string") {
      const archive = await withMirror(previous, retire);
      if (archive) retired.push(archive);
    }
    const legacy = await retire(registry);
    if (legacy) retired.push(legacy);
    await registry.set("retiredMirrors", JSON.stringify([...new Set(retired)]));
    await registry.set("activeMirror", name);
  });
}

/** Explicit deletion discards this namespace's active and retired local mirrors. */
export async function clearLocalMirrors(namespace: string) {
  const names = await withMirror(namespace, async (registry) => {
    const active: unknown = await registry.get("activeMirror");
    return [
      ...retiredNames(await registry.get("retiredMirrors")),
      ...(typeof active === "string" ? [active] : []),
    ];
  });
  for (const name of new Set([...names, namespace])) await clearDocument(name);
}
