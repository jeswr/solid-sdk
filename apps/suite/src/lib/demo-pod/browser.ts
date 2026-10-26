// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * Browser demo storage. Every mutation reads the latest durable pod and commits
 * with a revision compare-and-set in one IndexedDB transaction. A stale tab
 * retries against the winner instead of replacing its files with an old view.
 */

import { createDemoPod, type DemoPod, type DemoPodSnapshot } from "./pod";
import { buildDemoSeed, DEMO_ROOT } from "./seed";

const DB_NAME = "solid-suite-demo";
const STORE = "pods";
const KEY = DEMO_ROOT;
const CHANNEL = "solid-suite-demo-changes";

interface StoredPod {
  readonly revision: string;
  readonly snapshot: DemoPodSnapshot;
}

function openDb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

function storedPod(value: StoredPod | DemoPodSnapshot | undefined): StoredPod | undefined {
  // Migrate the previous snapshot format on the next successful commit.
  if (value && "version" in value)
    return value.version === 1 ? { revision: "legacy", snapshot: value } : undefined;
  return value;
}

function readStored(db: IDBDatabase): Promise<StoredPod | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(storedPod(request.result));
    request.onerror = () => reject(request.error);
  });
}

/** The read, revision comparison and write all run in the same IDB transaction. */
function commit(
  db: IDBDatabase,
  expected: string | undefined,
  snapshot: DemoPodSnapshot,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(KEY);
    let committed = false;
    request.onsuccess = () => {
      if (storedPod(request.result)?.revision !== expected) return;
      store.put({ revision: crypto.randomUUID(), snapshot } satisfies StoredPod, KEY);
      committed = true;
    };
    tx.oncomplete = () => resolve(committed);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

let current: Promise<DemoPod> | undefined;
let dispose: (() => void) | undefined;

/** The tab's stable demo pod facade (created on first use). */
export function getDemoPod(): Promise<DemoPod> {
  current ??= (async () => {
    const db = await openDb();
    let stored = db ? await readStored(db) : undefined;
    const seed = stored ? undefined : await buildDemoSeed(Date.now());
    const fresh = () => createDemoPod({ root: DEMO_ROOT, ...(seed ? { seed } : {}), latency: 60 });
    let view = stored
      ? createDemoPod({ root: DEMO_ROOT, snapshot: stored.snapshot, latency: 60 })
      : fresh();
    if (!db) return view;
    if (!stored) {
      if (!(await commit(db, undefined, view.snapshot()))) {
        stored = await readStored(db);
        if (stored)
          view = createDemoPod({ root: DEMO_ROOT, snapshot: stored.snapshot, latency: 60 });
      }
    }

    const channel =
      typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL);
    const listeners = new Set<(url: string) => void>();
    let active = true;
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(work: () => Promise<T>): Promise<T> => {
      const pending = queue.then(work);
      queue = pending.catch(() => undefined);
      return pending;
    };
    const notify = (url: string) => {
      for (const listener of listeners) listener(url);
    };
    const reload = async () => {
      const latest = await readStored(db);
      view = latest
        ? createDemoPod({ root: DEMO_ROOT, snapshot: latest.snapshot, latency: 60 })
        : createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()), latency: 60 });
    };
    if (channel)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string") return;
        const url = event.data;
        void serial(async () => {
          await reload();
          notify(url);
        }).catch(() => undefined);
      };
    dispose = () => {
      active = false;
      channel?.close();
      db.close();
    };

    const fetch: typeof globalThis.fetch = async (input, init) => {
      // Materialise once so retries also work for Requests and streaming bodies.
      const request = new Request(input, init);
      const method = request.method;
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
      const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
      return serial(async () => {
        if (!active) throw new Error("Demo pod session was reset");
        // Reads use this tab's view, which other tabs' commits refresh over the channel.
        if (!mutation)
          return view.fetch(request.url, {
            method,
            headers: request.headers,
            signal: request.signal,
          });
        for (;;) {
          const latest = await readStored(db);
          const trial = latest
            ? createDemoPod({ root: DEMO_ROOT, snapshot: latest.snapshot, latency: 60 })
            : createDemoPod({
                root: DEMO_ROOT,
                seed: await buildDemoSeed(Date.now()),
                latency: 60,
              });
          const changed: string[] = [];
          trial.subscribe((url) => changed.push(url));
          const response = await trial.fetch(request.url, {
            method,
            headers: request.headers,
            signal: request.signal,
            ...(body ? { body } : {}),
          });
          if (!active) throw new Error("Demo pod session was reset");
          if (mutation && response.ok && !(await commit(db, latest?.revision, trial.snapshot())))
            continue;
          view = trial;
          if (mutation && response.ok)
            for (const url of changed) {
              notify(url);
              channel?.postMessage(url);
            }
          return response;
        }
      });
    };
    return {
      root: DEMO_ROOT,
      fetch,
      snapshot: () => view.snapshot(),
      has: (url) => view.has(url),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  })();
  return current;
}

/** Throw away the saved demo pod; other tabs reload through the same channel. */
export async function resetDemoPod(): Promise<void> {
  dispose?.();
  dispose = undefined;
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  const channel =
    typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL);
  channel?.postMessage(DEMO_ROOT);
  channel?.close();
  current = undefined;
}
