// AUTHORED-BY Codex GPT-6.1-Sol
const DAY = 86_400_000;
export const MAX_FIRED_REMINDERS = 2000;
const DATABASE = "suite.notes.reminders";
const STORE = "firedReminders";
type History = [string, number][];

export interface FiredReminderStore {
  /** True only after this caller has atomically claimed the reminder. */
  claim(key: string, now: number): Promise<boolean>;
}

function prune(history: History, now: number): Map<string, number> {
  return new Map(
    history
      .filter(([, time]) => time > now - 30 * DAY && time <= now)
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
  return {
    claim(key, now) {
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
            const history = prune(read.result ?? [], now);
            if (!history.has(key)) {
              history.set(key, now);
              claimed = true;
            }
            store.put([...prune([...history], now)], account);
          };
        };
      });
    },
  };
}
