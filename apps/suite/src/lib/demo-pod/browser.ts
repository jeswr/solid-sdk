// AUTHORED-BY Claude Opus 5.5
/**
 * Browser wiring for the demo pod: one pod per tab, restored from IndexedDB
 * and saved back (debounced) after every write, so a reload keeps the user's
 * uploads. Falls back to an in-memory pod when IndexedDB is unavailable.
 */

import { createDemoPod, type DemoPod, type DemoPodSnapshot } from "./pod";
import { buildDemoSeed, DEMO_ROOT } from "./seed";

const DB_NAME = "solid-suite-demo";
const STORE = "pods";
const KEY = DEMO_ROOT;

function openDb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

function readSnapshot(db: IDBDatabase): Promise<DemoPodSnapshot | undefined> {
  return new Promise((resolve) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => {
      const value = request.result as DemoPodSnapshot | undefined;
      resolve(value?.version === 1 ? value : undefined);
    };
    request.onerror = () => resolve(undefined);
  });
}

function writeSnapshot(db: IDBDatabase, snapshot: DemoPodSnapshot | undefined): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (snapshot) store.put(snapshot, KEY);
    else store.delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

let current: Promise<DemoPod> | undefined;

/** The tab's demo pod (created on first use). */
export function getDemoPod(): Promise<DemoPod> {
  current ??= (async () => {
    const db = await openDb();
    const snapshot = db ? await readSnapshot(db) : undefined;
    const pod = createDemoPod(
      snapshot
        ? { root: DEMO_ROOT, snapshot, latency: 60 }
        : { root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()), latency: 60 },
    );
    if (db) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const save = () => {
        timer = undefined;
        void writeSnapshot(db, pod.snapshot());
      };
      if (!snapshot) save();
      pod.subscribe(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(save, 250);
      });
      addEventListener("pagehide", () => timer && save());
    }
    return {
      ...pod,
      fetch: async (input, init) => {
        if (!navigator.onLine) throw new TypeError("Demo pod is offline");
        return pod.fetch(input, init);
      },
    };
  })();
  return current;
}

/** Throw away the saved demo pod; the next load starts from the seed. */
export async function resetDemoPod(): Promise<void> {
  const db = await openDb();
  if (db) await writeSnapshot(db, undefined);
  current = undefined;
}
