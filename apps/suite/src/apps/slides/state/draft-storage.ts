// AUTHORED-BY Claude Opus 5.5
/**
 * Crash-recovery drafts shared by every Slides window of one account. Each window writes only
 * its own entry and keeps the others, so two tabs never overwrite each other's unsaved work.
 * A new window adopts the entries of windows that have closed: with Web Locks, a window is
 * open while it holds its lock; without them, an entry untouched for `staleAfter` counts as
 * closed. With Web Locks, an adopting window also claims each closed window's lock (if it is
 * still free) and holds it until it closes, so two windows opening at once never both adopt
 * the same drafts.
 */
interface Entry {
  at: number;
  value: string;
}
interface Locks {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}
export interface DraftStorage {
  /** Draft records to restore: those left by windows that have closed. */
  load(): Promise<string[]>;
  /** Replace this window's record. Throws when device storage is full or blocked. */
  save(value: string): void;
  dispose(): void;
}
const VERSION = 2;
const LEGACY = "legacy";

function hasEntries(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.length > 0;
    return ["drafts", "conflicts", "trash", "conflict"].some((key) => {
      const field = parsed?.[key];
      return Array.isArray(field) ? field.length > 0 : Boolean(field);
    });
  } catch {
    return true;
  }
}

export function createDraftStorage(
  key: string,
  options: {
    storage?: () => Storage;
    locks?: Locks | null;
    id?: string;
    now?: () => number;
    staleAfter?: number;
  } = {},
): DraftStorage {
  const storage = options.storage ?? (() => localStorage);
  const locks =
    options.locks === undefined
      ? ((globalThis.navigator as { locks?: Locks } | undefined)?.locks ?? null)
      : options.locks;
  const id = options.id ?? crypto.randomUUID();
  const now = options.now ?? Date.now;
  const staleAfter = options.staleAfter ?? 30 * 60 * 1000;
  const prefix = `${key}:window:`;
  const adopted = new Set<string>();
  let release: (() => void) | undefined;
  /** Settles when this window closes; every lock it holds is held until then. */
  const holding = new Promise<void>((resolve) => {
    release = resolve;
  });
  /** Settles once this window holds its lock (or could not take it). */
  let acquired: Promise<void> | undefined;
  if (locks) {
    acquired = new Promise<void>((resolve) => {
      locks
        .request(`${prefix}${id}`, {}, () => {
          resolve();
          return holding;
        })
        .catch(() => resolve());
    });
  }
  /**
   * Takes a closed window's lock if it is free and keeps it while this window is open, so no
   * other window adopts the same entry. Resolves false when another window holds it, and
   * undefined when the lock could not be requested at all.
   */
  const claim = (owner: string): Promise<boolean | undefined> =>
    new Promise((resolve) => {
      try {
        (locks as Locks)
          .request(`${prefix}${owner}`, { ifAvailable: true }, (lock) => {
            resolve(Boolean(lock));
            return lock ? holding : Promise.resolve();
          })
          .catch(() => resolve(undefined));
      } catch {
        resolve(undefined);
      }
    });
  const read = (): Record<string, Entry> => {
    const raw = storage().getItem(key);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version === VERSION && parsed.windows && typeof parsed.windows === "object") {
        const windows: Record<string, Entry> = {};
        for (const [owner, entry] of Object.entries(parsed.windows as Record<string, Entry>))
          if (typeof entry?.value === "string" && Number.isFinite(entry.at)) windows[owner] = entry;
        return windows;
      }
    } catch {
      /* An unreadable record is offered as a legacy draft; restore reports it. */
    }
    return { [LEGACY]: { at: 0, value: raw } };
  };
  const liveWindows = async (): Promise<Set<string> | undefined> => {
    if (!locks) return undefined;
    await acquired;
    const names = (await locks.query()).held?.map((lock) => lock.name ?? "") ?? [];
    return new Set(
      names.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)),
    );
  };
  return {
    async load() {
      const windows = read();
      let live: Set<string> | undefined;
      try {
        live = await liveWindows();
      } catch {
        live = undefined;
      }
      const values: string[] = [];
      for (const [owner, entry] of Object.entries(windows)) {
        if (owner === id) continue;
        const open = live ? live.has(owner) : now() - entry.at < staleAfter;
        if (open) continue;
        let value = entry.value;
        if (locks && !adopted.has(owner)) {
          if ((await claim(owner)) === false) continue;
          // Another window may have adopted and cleared the entry before the claim.
          const latest = read()[owner];
          if (!latest) continue;
          value = latest.value;
        }
        adopted.add(owner);
        values.push(value);
      }
      return values;
    },
    save(value) {
      const windows = read();
      for (const owner of adopted) delete windows[owner];
      if (hasEntries(value)) windows[id] = { at: now(), value };
      else delete windows[id];
      if (Object.keys(windows).length)
        storage().setItem(key, JSON.stringify({ version: VERSION, windows }));
      else storage().removeItem(key);
    },
    dispose() {
      release?.();
    },
  };
}
