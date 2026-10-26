// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
/**
 * Browser demo storage. Requests arriving together share a snapshot commit,
 * with a revision compare-and-set in one IndexedDB transaction. A stale tab
 * replays the batch against the winner, including HTTP preconditions. Responses
 * and notifications are released only after the commit is durable.
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
/** The demo pod behaves like a remote server: unreachable while the browser is offline. */
function offline(pod: DemoPod): DemoPod {
  return {
    ...pod,
    fetch: async (input, init) => {
      if (navigator.onLine === false) throw new TypeError("Demo pod is offline");
      return pod.fetch(input, init);
    },
  };
}

export function getDemoPod(): Promise<DemoPod> {
  current ??= (async () => {
    const db = await openDb();
    let stored = db ? await readStored(db) : undefined;
    const seed = stored ? undefined : await buildDemoSeed(Date.now());
    const fresh = () => createDemoPod({ root: DEMO_ROOT, ...(seed ? { seed } : {}) });
    let view = stored ? createDemoPod({ root: DEMO_ROOT, snapshot: stored.snapshot }) : fresh();
    if (!db) return offline(view);
    if (!stored) {
      if (!(await commit(db, undefined, view.snapshot()))) {
        stored = await readStored(db);
        if (stored) view = createDemoPod({ root: DEMO_ROOT, snapshot: stored.snapshot });
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
        ? createDemoPod({ root: DEMO_ROOT, snapshot: latest.snapshot })
        : createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
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

    interface PendingRequest {
      request: Request;
      mutation: boolean;
      durable: boolean;
      body: Uint8Array<ArrayBuffer> | undefined;
      resolve: (response: Response) => void;
      reject: (error: unknown) => void;
    }
    let pending: PendingRequest[] = [];
    const flush = () => {
      const batch = pending;
      pending = [];
      void serial(async () => {
        if (!active) throw new Error("Demo pod session was reset");
        const durable = batch.some((request) => request.durable);
        for (;;) {
          // Plain read batches use the view refreshed by BroadcastChannel. A batch with
          // a mutation or a conditional read starts from the latest durable revision.
          const latest = durable ? await readStored(db) : undefined;
          const trial = !durable
            ? view
            : latest
              ? createDemoPod({ root: DEMO_ROOT, snapshot: latest.snapshot })
              : createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
          const changed: string[] = [];
          const unsubscribe = trial.subscribe((url) => changed.push(url));
          const responses: Response[] = [];
          let dirty = false;
          try {
            for (const { request, body, mutation } of batch) {
              const response = await trial.fetch(request.url, {
                method: request.method,
                headers: request.headers,
                signal: request.signal,
                ...(body ? { body } : {}),
              });
              responses.push(response);
              dirty ||= mutation && response.ok;
            }
          } finally {
            unsubscribe();
          }
          if (!active) throw new Error("Demo pod session was reset");
          if (dirty && !(await commit(db, latest?.revision, trial.snapshot()))) continue;
          view = trial;
          for (const url of new Set(changed)) {
            notify(url);
            channel?.postMessage(url);
          }
          batch.forEach(({ resolve }, index) => {
            resolve(responses[index] as Response);
          });
          return;
        }
      }).catch((error: unknown) => {
        for (const { reject } of batch) reject(error);
      });
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      // Materialise once so retries also work for Requests and streaming bodies.
      const request = new Request(input, init);
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
      // Simulated network latency belongs outside the storage queue. Concurrent
      // requests travel together and share a commit, including conditional edits.
      return new Promise<Response>((resolve, reject) => {
        if (!pending.length) setTimeout(flush, 60);
        pending.push({
          request,
          body,
          mutation,
          // A conditional read is a precondition check, so it must see the durable pod
          // rather than this tab's view, which another tab's commit may not have refreshed yet.
          durable:
            mutation || request.headers.has("if-match") || request.headers.has("if-none-match"),
          resolve,
          reject,
        });
      });
    };
    return offline({
      root: DEMO_ROOT,
      fetch,
      snapshot: () => view.snapshot(),
      has: (url) => view.has(url),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
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
