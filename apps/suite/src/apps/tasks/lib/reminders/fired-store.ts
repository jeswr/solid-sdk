// AUTHORED-BY Codex GPT-6.1-Sol
import { computeFireTimes, type Reminder } from "../model/reminders";

export interface FiredReminderStore {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<void>;
}

/** Same trigger identity used by the RDF model, followed by the actual ISO fire time. */
export function reminderKey(taskUrl: string, reminder: Reminder, fireTime: Date): string {
  // Due is needed only to validate the trigger, not to derive its stable identity.
  const [trigger] = computeFireTimes(taskUrl, fireTime, [reminder]);
  return `${(trigger as { id: string }).id}@${fireTime.toISOString()}`;
}

export function createMemoryFiredStore(): FiredReminderStore {
  const keys = new Set<string>();
  return {
    async has(key) {
      return keys.has(key);
    },
    async add(key) {
      keys.add(key);
    },
  };
}

const STORE = "firedReminders";
const RETENTION = 30 * 86400000;

/** Lazy storage; timestamps record when fired, with expired entries pruned on every access. */
export function createIndexedDbFiredStore(indexedDB: IDBFactory): FiredReminderStore {
  let database: Promise<IDBDatabase> | undefined;
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
  async function access(key: string, add: boolean): Promise<boolean> {
    database ??= open().catch((error: unknown) => {
      database = undefined;
      throw error;
    });
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const now = new Date();
      const cutoff = new Date(now.getTime() - RETENTION).toISOString();
      let found = false;
      tx.oncomplete = () => resolve(found);
      tx.onerror = tx.onabort = () => reject(tx.error);
      const scan = store.openCursor();
      scan.onsuccess = () => {
        const cursor = scan.result;
        if (cursor) {
          if (cursor.value < cutoff) cursor.delete();
          cursor.continue();
        } else if (add) store.put(now.toISOString(), key);
        else {
          const request = store.get(key);
          request.onsuccess = () => {
            found = request.result !== undefined;
          };
        }
      };
    });
  }
  return {
    has: (key) => access(key, false),
    async add(key) {
      await access(key, true);
    },
  };
}
