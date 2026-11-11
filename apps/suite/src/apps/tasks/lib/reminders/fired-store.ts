// AUTHORED-BY Codex GPT-6.1-Sol
import { computeFireTimes, type Reminder } from "../model/reminders";

export interface FiredReminderStore {
  /** Atomically record a new fire key; true only for the caller that claims it first. */
  claim(key: string): Promise<boolean>;
  /** Claims to merge into a recovered primary store before it accepts new claims. */
  keys?(): Promise<string[]>;
  /** Called once per scheduler tick, outside the individual claim transactions. */
  prune?(): Promise<void>;
}

/** Device identity uses scheduling inputs, independent of RDF node ids or task edits. */
export function reminderKey(
  taskUrl: string,
  reminder: Reminder,
  fireTime: Date,
  due = fireTime,
): string {
  computeFireTimes(taskUrl, due, [reminder]);
  const trigger = reminder.offset ?? (reminder.time as Date).toISOString();
  return `${taskUrl}/reminder-${encodeURIComponent(trigger)}@${fireTime.toISOString()}|due=${due.toISOString()}`;
}

export function createMemoryFiredStore(): FiredReminderStore {
  const keys = new Set<string>();
  return {
    async keys() {
      return [...keys];
    },
    async claim(key) {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
  };
}

const STORE = "firedReminders";
const RETENTION = 30 * 86400000;
const LOCAL_KEY = "tasks.firedReminders";

/** Reload-safe fallback. IndexedDB remains the cross-tab atomic authority when available. */
export function createLocalStorageFiredStore(storage: Storage): FiredReminderStore {
  function read(): Map<string, number> {
    const value: unknown = JSON.parse(storage.getItem(LOCAL_KEY) ?? "{}");
    return new Map(
      Object.entries(value && typeof value === "object" ? value : {}).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  }
  function write(keys: Map<string, number>) {
    storage.setItem(LOCAL_KEY, JSON.stringify(Object.fromEntries(keys)));
  }
  return {
    async keys() {
      return [...read().keys()];
    },
    async claim(key) {
      const keys = read();
      if (keys.has(key)) return false;
      keys.set(key, Date.now());
      write(keys);
      return true;
    },
    async prune() {
      const keys = read();
      for (const [key, at] of keys) if (at < Date.now() - RETENTION) keys.delete(key);
      write(keys);
    },
  };
}

/** Lazy atomic claims across tabs/connections, with a tab-local cache of known fired keys. */
export function createIndexedDbFiredStore(indexedDB: IDBFactory): FiredReminderStore {
  let database: Promise<IDBDatabase> | undefined;
  const known = new Map<string, number>();
  function open(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("tasks", version);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Tasks reminder database upgrade is blocked."));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        if (!db.objectStoreNames.contains(STORE)) {
          db.close();
          resolve(open(db.version + 1));
        } else {
          db.onversionchange = () => {
            db.close();
            database = undefined;
          };
          resolve(db);
        }
      };
    });
  }
  async function db(): Promise<IDBDatabase> {
    database ??= open().catch((error: unknown) => {
      database = undefined;
      throw error;
    });
    return database;
  }
  async function claim(key: string): Promise<boolean> {
    if (known.has(key)) return false;
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const now = new Date();
      let claimed = false;
      tx.oncomplete = () => {
        known.set(key, now.getTime());
        resolve(claimed);
      };
      tx.onerror = tx.onabort = () => reject(tx.error);
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result === undefined) {
          store.put(now.toISOString(), key);
          claimed = true;
        }
      };
    });
  }
  async function prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION);
    for (const [key, at] of known) if (at < cutoff.getTime()) known.delete(key);
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
      const scan = store.openCursor();
      scan.onsuccess = () => {
        const cursor = scan.result;
        if (cursor) {
          if (cursor.value < cutoff.toISOString()) cursor.delete();
          cursor.continue();
        }
      };
    });
  }
  return { claim, prune };
}
