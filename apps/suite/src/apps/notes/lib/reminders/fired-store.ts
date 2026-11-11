// AUTHORED-BY Codex GPT-6.1-Sol
const DAY = 86_400_000;
export const MAX_FIRED_REMINDERS = 2000;
const DATABASE = "suite.notes.reminders";
const STORE = "firedReminders";
type History = [string, number][];

export interface FiredReminderStore {
  /** True only after this caller has atomically claimed the reminder. */
  claim(key: string, now: number): Promise<boolean>;
  /** Release a successfully claimed reminder that was never delivered. */
  release(key: string): Promise<void>;
}

function prune(history: History, now: number): Map<string, number> {
  return new Map(
    history
      .filter(([, time]) => time > Math.max(now, time) - 30 * DAY)
      .sort((a, b) => a[1] - b[1])
      .slice(-MAX_FIRED_REMINDERS),
  );
}

export function createMemoryFiredStore(): FiredReminderStore {
  let history = new Map<string, number>();
  return {
    async claim(key, now) {
      history = prune([...history], now);
      if (history.has(key)) return false;
      history.set(key, now);
      history = prune([...history], now);
      return true;
    },
    async release(key) {
      history.delete(key);
    },
  };
}

/** As in Tasks, a readwrite transaction locks the read/merge/claim across tabs.
 * Accounts have separate bounded histories; Notes has its own database.
 * Close each connection after its claim, including failed/blocked opens.
 */
export function createIndexedDbFiredStore(
  account: string,
  indexedDB: IDBFactory,
): FiredReminderStore {
  const update = (key: string, now?: number): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Notes reminder database upgrade is blocked."));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let claimed = false;
        tx.oncomplete = () => {
          db.close();
          resolve(claimed);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
        const read = store.get(account);
        read.onsuccess = () => {
          const history =
            now === undefined
              ? new Map<string, number>(read.result)
              : prune(read.result ?? [], now);
          if (now === undefined) history.delete(key);
          else if (!history.has(key)) {
            history.set(key, now);
            claimed = true;
          }
          store.put(now === undefined ? [...history] : [...prune([...history], now)], account);
        };
      };
    });
  };
  return {
    claim: update,
    async release(key) {
      await update(key);
    },
  };
}
