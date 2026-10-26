/**
 * The dashboard's settings store: ONE owner-private JSON document in its own directory.
 *
 *  - directory 0700, file 0600; written atomically (temp file + rename);
 *  - every change names the revision it was based on; a stale revision is a conflict (409),
 *    so two browser tabs, or the browser and a CLI import, cannot silently overwrite each other;
 *  - a short write lock (O_EXCL lock file, recovered only if its process is dead) serialises
 *    writers across processes; readers never lock;
 *  - a bounded change history (actor, source, time, summary) travels in the same document.
 *
 * This store is separate from every agent's runtime state: it never opens `state.json`, holds,
 * ledgers or keys of any agent. Agents consume the dashboard's calendar choices only through the
 * explicit `availability.json` file (see `pilot/availability.ts`).
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  emptySettings,
  type HistoryEntry,
  MAX_HISTORY,
  type Settings,
  settingsSchema,
} from "./model.js";

export const SETTINGS_FILE = "settings.json";
const LOCK_FILE = "settings.lock";

export class RevisionConflictError extends Error {
  constructor(readonly current: number) {
    super(`settings changed since you loaded them (now revision ${current}); reload and retry`);
    this.name = "RevisionConflictError";
  }
}

export class SettingsStore {
  readonly path: string;

  constructor(
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(dir, SETTINGS_FILE);
  }

  /** Create the private directory and an empty document if absent (never overwrites). */
  init(): Settings {
    ensurePrivateDir(this.dir);
    if (!existsSync(this.path)) {
      this.withLock(() => {
        if (!existsSync(this.path)) writeAtomic(this.path, emptySettings(this.now().toISOString()));
      });
    }
    return this.read();
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  /** Read and validate (a malformed document is an error, never silently replaced). */
  read(): Settings {
    return settingsSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
  }

  /**
   * Apply `change` to the document at `baseRevision`, validate the result, bump the revision,
   * append a history entry and write atomically. Throws RevisionConflictError on a stale base.
   */
  update(
    baseRevision: number,
    actor: HistoryEntry["actor"],
    action: string,
    /** A string, or a function evaluated after `change` (for summaries of what it did). */
    summary: string | (() => string),
    change: (draft: Settings) => void,
  ): Settings {
    return this.withLock(() => {
      const current = this.read();
      if (current.revision !== baseRevision) throw new RevisionConflictError(current.revision);
      const draft = structuredClone(current);
      change(draft);
      const text = typeof summary === "function" ? summary() : summary;
      const at = this.now().toISOString();
      draft.revision = current.revision + 1;
      draft.updatedAt = at;
      draft.history = [
        ...current.history,
        {
          revision: draft.revision,
          at,
          actor,
          action: action.slice(0, 80),
          summary: text.slice(0, 300),
        },
      ].slice(-MAX_HISTORY);
      const next = settingsSchema.parse(draft);
      writeAtomic(this.path, next);
      return next;
    });
  }

  /**
   * Explicit, recorded migration: label history entries and record times that lie AFTER the real
   * current time. These can only have come from a synthetic demo clock (before the clocks were
   * separated). Times are kept exactly as written and only labelled; the migration adds its own
   * history entry. Returns what was labelled (0/0 means nothing changed and nothing is written).
   */
  labelSyntheticClockTimes(): { history: number; records: number; revision: number } {
    return this.withLock(() => {
      const current = this.read();
      const realNow = this.now().getTime();
      const future = (at: string) => Date.parse(at) > realNow;
      const draft = structuredClone(current);
      let history = 0;
      let records = 0;
      for (const e of draft.history)
        if (!e.clock && future(e.at)) {
          e.clock = "synthetic-demo";
          history++;
        }
      for (const c of draft.connections)
        if (!c.updatedAtClock && future(c.updatedAt)) {
          c.updatedAtClock = "synthetic-demo";
          records++;
        }
      if (history === 0 && records === 0) return { history, records, revision: current.revision };
      const at = this.now().toISOString();
      draft.revision = current.revision + 1;
      draft.updatedAt = at;
      draft.history = [
        ...draft.history,
        {
          revision: draft.revision,
          at,
          actor: "migration (CLI)" as const,
          action: "Labelled demo-clock times",
          summary: `${history} history entries and ${records} account records carried times from the synthetic demo clock (later than the real time). The times are kept and labelled; new entries use the real clock.`,
        },
      ].slice(-MAX_HISTORY);
      writeAtomic(this.path, settingsSchema.parse(draft));
      return { history, records, revision: draft.revision };
    });
  }

  private withLock<T>(fn: () => T): T {
    const lock = join(this.dir, LOCK_FILE);
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch {
      if (lockIsStale(lock)) {
        unlinkSync(lock);
        fd = openSync(lock, "wx", 0o600);
      } else throw new Error("settings are being written by another process; retry");
    }
    try {
      writeFileSync(fd, String(process.pid));
      return fn();
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }
}

function lockIsStale(path: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8"), 10);
    if (!Number.isInteger(pid) || pid <= 0) return statSync(path).mtimeMs < Date.now() - 60_000;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Create `dir` (and parents) and force it to 0700. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Atomic JSON write, 0600. */
export function writeAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
