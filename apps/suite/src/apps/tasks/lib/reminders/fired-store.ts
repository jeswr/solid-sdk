// AUTHORED-BY Codex GPT-6.1-Sol
import { computeFireTimes, type Reminder } from "../model/reminders";

export interface LegacyReminderClaim {
  /** Task URL, move identity, or named reminder prefixes used by the previous version. */
  prefixes: readonly string[];
  fireTime: Date;
}
export interface FiredReminderStore {
  /** Atomically record a new fire key; true only for the caller that claims it first. */
  claim(key: string, legacy?: LegacyReminderClaim): Promise<boolean>;
  /** Claims to merge into a recovered primary store before it accepts new claims. */
  keys?(): Promise<string[]>;
  /** Called once per scheduler tick, outside the individual claim transactions. */
  prune?(): Promise<void>;
}

/** Legacy keys end at the fire instant; current keys also carry the due instant. */
export function isLegacyReminderKey(key: string): boolean {
  return /@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(key);
}
function legacyClaimed(claims: ReadonlyMap<string, number>, legacy?: LegacyReminderClaim) {
  if (!legacy) return false;
  for (const [key, at] of claims)
    if (
      at >= legacy.fireTime.getTime() &&
      isLegacyReminderKey(key) &&
      legacy.prefixes.some((prefix) => key.startsWith(prefix))
    )
      return true;
  return false;
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
  const keys = new Map<string, number>();
  return {
    async keys() {
      return [...keys.keys()];
    },
    async claim(key, legacy) {
      if (keys.has(key) || legacyClaimed(keys, legacy)) return false;
      keys.set(key, Date.now());
      return true;
    },
  };
}

const STORE = "firedReminders";

const K = Array.from({ length: 64 }, (_, i) => {
  let n = 2;
  for (let found = 0; ; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (prime && found++ === i) return Math.floor((n ** (1 / 3) % 1) * 2 ** 32);
  }
});
/** Synchronous SHA-256 (hex), so claims stay deterministic where SubtleCrypto is async or absent. */
function digest(text: string): string {
  const data = new TextEncoder().encode(text);
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      w[i] =
        ((w[i - 16] as number) +
          (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) +
          (w[i - 7] as number) +
          (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) |
        0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          (K[i] as number) +
          (w[i] as number)) |
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = ((h[i] as number) + value) | 0;
    });
  }
  return h.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * Scope claims to one account and keep task URLs and titles out of storage: every key becomes a
 * digest of the WebID and the key. One account's claim never suppresses another's reminder.
 * Legacy-prefix suppression is dropped: the unscoped records it matched are purged.
 */
export function createAccountFiredStore(
  inner: FiredReminderStore,
  account: () => string,
): FiredReminderStore {
  const scoped = (key: string) => digest(`${account()}\n${key}`);
  return {
    async claim(key) {
      return inner.claim(scoped(key));
    },
    ...(inner.prune ? { prune: () => inner.prune?.() as Promise<void> } : {}),
  };
}

/** Delete pre-scoping IndexedDB records (any key that is not a digest). Best effort. */
export async function purgeUnscopedFiredReminders(indexedDB: IDBFactory): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tasks");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (!db.objectStoreNames.contains(STORE)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
      const scan = tx.objectStore(STORE).openCursor();
      scan.onsuccess = () => {
        const cursor = scan.result;
        if (!cursor) return;
        if (typeof cursor.key !== "string" || !HASHED.test(cursor.key)) cursor.delete();
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
}
const RETENTION = 30 * 86400000;
const LOCAL_KEY = "tasks.firedReminders";
export const SCOPED_LOCAL_KEY = "tasks.firedReminders.v2";
/** The unscoped record that held task URLs and titles in clear text. Dropped, never migrated. */
export const LEGACY_LOCAL_KEY = LOCAL_KEY;
const HASHED = /^[0-9a-f]{64}$/;

/** Reload-safe fallback. IndexedDB remains the cross-tab atomic authority when available. */
export function createLocalStorageFiredStore(
  storage: Storage,
  localKey = LOCAL_KEY,
): FiredReminderStore {
  function read(): Map<string, number> {
    const value: unknown = JSON.parse(storage.getItem(localKey) ?? "{}");
    return new Map(
      Object.entries(value && typeof value === "object" ? value : {}).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  }
  function write(keys: Map<string, number>) {
    storage.setItem(localKey, JSON.stringify(Object.fromEntries(keys)));
  }
  return {
    async keys() {
      return [...read().keys()];
    },
    async claim(key, legacy) {
      const keys = read();
      if (keys.has(key) || legacyClaimed(keys, legacy)) return false;
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
  const known = new Map<string, number>();
  let legacyClaims: Map<string, number> | undefined;
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
          db.onversionchange = () => db.close();
          resolve(db);
        }
      };
    });
  }
  // Each claim or prune uses its own short-lived connection. A tab never holds the shared
  // "tasks" database open between ticks, so other tabs' upgrades and test harnesses that wait
  // for connections to close are not blocked. Closing waits for the transaction to finish.
  async function withDb<T>(work: (database: IDBDatabase) => Promise<T>): Promise<T> {
    const database = await open();
    try {
      return await work(database);
    } finally {
      database.close();
    }
  }
  async function claim(key: string, legacy?: LegacyReminderClaim): Promise<boolean> {
    if (known.has(key)) return false;
    return withDb(
      (database) =>
        new Promise((resolve, reject) => {
          const tx = database.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const now = new Date();
          let claimed = false;
          let previous = legacyClaims;
          tx.oncomplete = () => {
            legacyClaims = previous;
            known.set(key, now.getTime());
            resolve(claimed);
          };
          tx.onerror = tx.onabort = () => reject(tx.error);
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result !== undefined) return;
            const accept = () => {
              if (!legacyClaimed(previous ?? new Map(), legacy)) {
                store.put(now.toISOString(), key);
                claimed = true;
              }
            };
            // Scheduler pruning normally loads these once per tick. Direct claims also
            // consult persisted legacy records before accepting their first new key.
            if (legacy && !previous) {
              previous = new Map();
              const scan = store.openCursor();
              scan.onsuccess = () => {
                const cursor = scan.result;
                if (cursor) {
                  if (typeof cursor.key === "string" && isLegacyReminderKey(cursor.key))
                    previous?.set(cursor.key, Date.parse(cursor.value));
                  cursor.continue();
                } else accept();
              };
            } else accept();
          };
        }),
    );
  }
  async function prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION);
    for (const [key, at] of known) if (at < cutoff.getTime()) known.delete(key);
    return withDb(
      (database) =>
        new Promise((resolve, reject) => {
          const tx = database.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const previous = new Map<string, number>();
          tx.oncomplete = () => {
            legacyClaims = previous;
            resolve();
          };
          tx.onerror = tx.onabort = () => reject(tx.error);
          const scan = store.openCursor();
          scan.onsuccess = () => {
            const cursor = scan.result;
            if (cursor) {
              if (cursor.value < cutoff.toISOString()) cursor.delete();
              else if (typeof cursor.key === "string" && isLegacyReminderKey(cursor.key))
                previous.set(cursor.key, Date.parse(cursor.value));
              cursor.continue();
            }
          };
        }),
    );
  }
  return { claim, prune };
}
