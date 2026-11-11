// AUTHORED-BY Claude Opus 5.5
/**
 * Crash-recovery drafts shared by every Slides window of one account. Each window writes only
 * its own entry and keeps the others, so two tabs never overwrite each other's unsaved work.
 * A new window adopts the entries of windows that have closed: with Web Locks, a window is
 * open while it holds its lock; without them, an entry untouched for `staleAfter` counts as
 * closed.
 */
interface Entry {
  at: number;
  value: string;
}
interface Locks {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
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
  /** Settles once this window holds its lock (or could not take it). */
  let acquired: Promise<void> | undefined;
  if (locks) {
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    acquired = new Promise<void>((resolve) => {
      locks
        .request(`${prefix}${id}`, () => {
          resolve();
          return holding;
        })
        .catch(() => resolve());
    });
  }
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
        adopted.add(owner);
        values.push(entry.value);
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
