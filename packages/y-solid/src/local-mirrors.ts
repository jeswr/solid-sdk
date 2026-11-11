// AUTHORED-BY Codex GPT-6.1-Sol
import { clearDocument, IndexeddbPersistence } from "y-indexeddb";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { hasUnconfirmedLocalState, loadPersistedLocalState } from "./local.js";
import { coversUpdates } from "./update-coverage.js";

/** Local durability is unavailable; callers may continue with online persistence. */
export class LocalMirrorError extends Error {
  constructor(
    readonly mirrorName: string,
    cause: unknown,
  ) {
    super("Couldn't open the local document mirror", { cause });
    this.name = "LocalMirrorError";
  }
}

/**
 * y-indexeddb 9.0.12 discards its initialization promise chain. Check the
 * database and persisted bytes before constructing it to contain storage denial
 * and corrupt hydration before upstream starts that discarded promise chain.
 */
export async function openLocalMirror(name: string, doc: Doc) {
  let database: IDBDatabase | undefined;
  const probe = new Doc();
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("updates", { autoIncrement: true });
        request.result.createObjectStore("custom");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const openedDatabase = database;
    const updates = await new Promise<Uint8Array[]>((resolve, reject) => {
      const transaction = openedDatabase.transaction("updates", "readonly");
      const request = transaction.objectStore("updates").getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    for (const update of updates) applyUpdate(probe, update);
  } catch (cause) {
    throw new LocalMirrorError(name, cause);
  } finally {
    database?.close();
    probe.destroy();
  }
  let mirror: IndexeddbPersistence;
  try {
    mirror = new IndexeddbPersistence(name, doc);
  } catch (cause) {
    throw new LocalMirrorError(name, cause);
  }
  await waitForLocalMirror(mirror);
  return mirror;
}

/** whenSynced alone never rejects when y-indexeddb fails to open its database. */
export async function waitForLocalMirror(mirror: IndexeddbPersistence) {
  let database: Awaited<IndexeddbPersistence["_db"]> | undefined;
  let finished = false;
  let failed: (cause: unknown) => void = () => {};
  const failure = new Promise<never>((_resolve, reject) => {
    failed = reject;
  });
  const databaseError = (event: Event) => failed(event);
  // Observable<string> permits error events, including adapters that expose
  // hydration errors. The pinned upstream version only emits "synced".
  mirror.on("error", failed);
  const opening = mirror._db.then((db) => {
    if (finished) return mirror.whenSynced;
    database = db;
    db?.addEventListener("error", databaseError);
    db?.addEventListener("abort", databaseError);
    return mirror.whenSynced;
  });
  try {
    await Promise.race([mirror.whenSynced, opening, failure]);
  } catch (cause) {
    // destroy itself rejects if _db rejected. Preserve the initialization cause.
    void mirror.destroy().catch(() => {});
    throw new LocalMirrorError(mirror.name, cause);
  } finally {
    finished = true;
    mirror.off("error", failed);
    database?.removeEventListener("error", databaseError);
    database?.removeEventListener("abort", databaseError);
  }
}

async function withMirror<T>(name: string, action: (mirror: IndexeddbPersistence) => Promise<T>) {
  const doc = new Doc();
  let mirror: IndexeddbPersistence | undefined;
  try {
    mirror = await openLocalMirror(name, doc);
    return await action(mirror);
  } finally {
    await mirror?.destroy().catch(() => {});
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

/** Close a superseded publisher first, then retain its unacknowledged edits. */
export async function retireLocalMirror(namespace: string, name: string) {
  await withMirror(namespace, async (registry) => {
    const retired = retiredNames(await registry.get("retiredMirrors"));
    const archive = await withMirror(name, retire);
    if (archive) retired.push(archive);
    await registry.set("retiredMirrors", JSON.stringify([...new Set(retired)]));
    if ((await registry.get("activeMirror")) === name) await registry.del("activeMirror");
  });
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
