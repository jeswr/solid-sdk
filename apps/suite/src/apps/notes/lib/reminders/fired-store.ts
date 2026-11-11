// AUTHORED-BY Codex GPT-6.1-Sol
const DAY = 86_400_000;
export const MAX_FIRED_REMINDERS = 2000;
export const CLAIM_TTL = 30_000;
const DATABASE = "suite.notes.reminders";
const STORE = "firedReminders";
type Record =
  | { state: "pending"; owner: string; expires: number; time: number }
  | { state: "delivered"; time: number };
type History = [string, Record | number][];

export interface FiredReminderStore {
  /** A pending claim excludes other owners only until release or expiry. */
  claim(key: string, now: number, owner?: string): Promise<boolean>;
  owns(key: string, now: number, owner?: string): Promise<boolean>;
  deliver(key: string, now: number, owner?: string): Promise<void>;
  release(key: string, owner?: string): Promise<void>;
  wasDelivered(key: string, now: number): Promise<boolean>;
  /** Best-effort suppression when a save identifies an already overdue reminder. */
  markDelivered(key: string, now: number): Promise<void>;
}

function prune(history: History, now: number): Map<string, Record> {
  return new Map(
    history
      // Version-one numeric claims already represent delivered notifications.
      .map(([key, value]): [string, Record] => [
        key,
        typeof value === "number" ? { state: "delivered", time: value } : value,
      ])
      .filter(([, record]) =>
        record.state === "pending"
          ? record.expires > now
          : record.time > Math.max(now, record.time) - 30 * DAY,
      )
      .sort((a, b) => a[1].time - b[1].time)
      .slice(-MAX_FIRED_REMINDERS),
  );
}

type Update = (change: (history: Map<string, Record>) => boolean, now?: number) => Promise<boolean>;

function operations(update: Update): FiredReminderStore {
  const instance = crypto.randomUUID();
  const ownerFor = (key: string) => JSON.stringify([instance, key]);
  return {
    claim(key, now, owner = ownerFor(key)) {
      return update((history) => {
        if (history.has(key)) return false;
        history.set(key, { state: "pending", owner, expires: now + CLAIM_TTL, time: now });
        return true;
      }, now);
    },
    owns(key, now, owner = ownerFor(key)) {
      return update((history) => {
        const record = history.get(key);
        return record?.state === "pending" && record.owner === owner;
      }, now);
    },
    async deliver(key, now, owner = ownerFor(key)) {
      await update((history) => {
        const record = history.get(key);
        if (record?.state !== "pending" || record.owner !== owner) return false;
        history.set(key, { state: "delivered", time: now });
        return true;
      });
    },
    async release(key, owner = ownerFor(key)) {
      await update((history) => {
        const record = history.get(key);
        if (record?.state !== "pending" || record.owner !== owner) return false;
        history.delete(key);
        return true;
      });
    },
    wasDelivered(key, now) {
      return update((history) => history.get(key)?.state === "delivered", now);
    },
    async markDelivered(key, now) {
      await update((history) => {
        history.set(key, { state: "delivered", time: now });
        return true;
      }, now);
    },
  };
}

export function createMemoryFiredStore(): FiredReminderStore {
  let history = new Map<string, Record>();
  return operations(async (change, now) => {
    history = prune([...history], now ?? Number.NEGATIVE_INFINITY);
    const result = change(history);
    history = prune([...history], now ?? Number.NEGATIVE_INFINITY);
    return result;
  });
}

/** A readwrite transaction locks the read/merge/write across tabs. Accounts
 * have separate bounded histories; each operation closes its connection.
 */
export function createIndexedDbFiredStore(
  account: string,
  indexedDB: IDBFactory,
): FiredReminderStore {
  return operations((change, now) => {
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
        let result = false;
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
        const read = store.get(account);
        read.onsuccess = () => {
          const history = prune(read.result ?? [], now ?? Number.NEGATIVE_INFINITY);
          result = change(history);
          store.put([...prune([...history], now ?? Number.NEGATIVE_INFINITY)], account);
        };
      };
    });
  });
}

const pageMemory = new Map<string, FiredReminderStore>();
/** Scheduler mounts and note saves share account-scoped fallback history. The
 * optional stores let tests model separate browser documents sharing IndexedDB.
 */
export function createBrowserFiredStore(
  account: string,
  memory = pageMemory.get(account) ?? createMemoryFiredStore(),
  durable = typeof indexedDB === "undefined"
    ? memory
    : createIndexedDbFiredStore(account, indexedDB),
): FiredReminderStore {
  pageMemory.set(account, memory);
  const claims = new Map<
    string,
    { owner: string | undefined; store: FiredReminderStore; expires: number }
  >();
  const forget = (key: string, owner: string | undefined) => {
    if (claims.get(key)?.owner === owner) claims.delete(key);
  };
  return {
    async claim(key, now, owner) {
      for (const [claimedKey, claim] of claims) if (claim.expires <= now) claims.delete(claimedKey);
      if (!(await memory.claim(key, now, owner))) return false;
      const claim = { owner, store: memory, expires: now + CLAIM_TTL };
      claims.set(key, claim);
      try {
        if (durable === memory || (await durable.claim(key, now, owner))) {
          claim.store = durable;
          return true;
        }
        // Rejected is not delivered. Retry against durable storage next time.
        await memory.release(key, owner);
        forget(key, owner);
        return false;
      } catch {
        return true;
      }
    },
    async deliver(key, now, owner) {
      await memory.deliver(key, now, owner);
      forget(key, owner);
      if (durable !== memory) await durable.deliver(key, now, owner).catch(() => {});
    },
    async owns(key, now, owner) {
      if (!(await memory.owns(key, now, owner))) return false;
      const claim = claims.get(key);
      const store = claim && claim.owner === owner ? claim.store : durable;
      try {
        return store === memory || (await store.owns(key, now, owner));
      } catch {
        return true;
      }
    },
    async release(key, owner) {
      if (durable !== memory) await durable.release(key, owner).catch(() => {});
      await memory.release(key, owner);
      forget(key, owner);
    },
    async wasDelivered(key, now) {
      if (await memory.wasDelivered(key, now)) return true;
      return durable !== memory && durable.wasDelivered(key, now).catch(() => false);
    },
    async markDelivered(key, now) {
      await memory.markDelivered(key, now);
      if (durable !== memory) await durable.markDelivered(key, now).catch(() => {});
    },
  };
}
