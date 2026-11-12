// AUTHORED-BY Codex GPT-6.1-Sol
export interface UndoEntry {
  label: string;
  scope: string;
  undo(signal: AbortSignal): Promise<void>;
  redo?(signal: AbortSignal): Promise<void>;
  expiresAt?: number;
}
export type UndoResult =
  | { status: "done" | "nothing" | "busy" | "expired" }
  | { status: "failed"; error: unknown };
export interface UndoItem {
  id: string;
  label: string;
  scope: string;
  canRedo: boolean;
}
export interface UndoStack {
  push(entry: UndoEntry): string;
  undo(scope: string): Promise<UndoResult>;
  undoById(id: string): Promise<UndoResult>;
  redo(scope: string): Promise<UndoResult>;
  /** Pending undo entries, oldest first. canRedo describes the optional redo callback. */
  entries(scope?: string): ReadonlyArray<UndoItem>;
  subscribe(listener: () => void): () => void;
  clear(): void;
}
export interface UndoStackOptions {
  limit?: number;
  now?: () => number;
  isRetryable?: (error: unknown) => boolean;
}
type RecordEntry = { id: string; entry: UndoEntry; phase: "undo" | "redo" };
let serial = 0;

/** One account's in-memory history. Cancellation-aware callbacks own their underlying writes. */
export function createUndoStack({
  limit = 50,
  now = Date.now,
  isRetryable = () => false,
}: UndoStackOptions = {}): UndoStack {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Undo limit must be positive");
  let records: RecordEntry[] = [];
  let snapshot: ReadonlyArray<UndoItem> = [];
  let operation: AbortController | undefined;
  const listeners = new Set<() => void>();
  const branches = new Map<string, number>();
  const expired = ({ entry }: RecordEntry) =>
    entry.expiresAt !== undefined && entry.expiresAt <= now();
  const update = () => {
    snapshot = Object.freeze(
      records
        .filter((record) => record.phase === "undo")
        .map(({ id, entry }) =>
          Object.freeze({ id, label: entry.label, scope: entry.scope, canRedo: !!entry.redo }),
        ),
    );
  };
  const publish = () => {
    update();
    for (const listener of listeners) listener();
  };
  const prune = () => {
    const live = records.filter((record) => !expired(record));
    if (live.length !== records.length) {
      records = live;
      update();
    }
  };
  const trim = (scope: string) => {
    const scoped = records.filter((record) => record.entry.scope === scope);
    const dropped = new Set(scoped.slice(0, Math.max(0, scoped.length - limit)));
    records = records.filter((record) => !dropped.has(record));
  };
  const run = async (
    phase: RecordEntry["phase"],
    matches: (record: RecordEntry) => boolean,
  ): Promise<UndoResult> => {
    if (operation) return { status: "busy" };
    const candidates = records.filter((record) => record.phase === phase && matches(record));
    const record = candidates.findLast((candidate) => !expired(candidate));
    prune();
    if (!record) publish();
    if (!record) return { status: candidates.length ? "expired" : "nothing" };
    const controller = new AbortController();
    operation = controller;
    const branch = branches.get(record.entry.scope);
    try {
      publish();
      // A synchronous subscriber may retire the session or cross this entry's deadline.
      controller.signal.throwIfAborted();
      if (expired(record)) {
        records = records.filter((candidate) => candidate !== record);
        return { status: "expired" };
      }
      const callback = record.entry[phase] as UndoEntry["undo"];
      await callback(controller.signal);
      if (controller.signal.aborted) return { status: "nothing" };
      // A push may have invalidated this redo entry, or clear may have retired the history.
      if (records.includes(record)) {
        records = records.filter((candidate) => candidate !== record);
        if (record.entry.redo && !expired(record) && branch === branches.get(record.entry.scope)) {
          records.push({ ...record, phase: phase === "undo" ? "redo" : "undo" });
          trim(record.entry.scope);
        }
      }
      return { status: "done" };
    } catch (error) {
      if (controller.signal.aborted) return { status: "nothing" };
      if (!isRetryable(error)) records = records.filter((candidate) => candidate !== record);
      return { status: "failed", error };
    } finally {
      operation = undefined;
      prune();
      publish();
    }
  };
  return {
    push(entry) {
      prune();
      branches.set(entry.scope, (branches.get(entry.scope) ?? 0) + 1);
      // Retire in-flight undo's future redo too: new intent starts a new branch of history.
      records = records.filter(
        (record) => record.entry.scope !== entry.scope || record.phase !== "redo",
      );
      const id = `undo-${++serial}`;
      records.push({ id, entry: { ...entry }, phase: "undo" });
      trim(entry.scope);
      prune();
      publish();
      return id;
    },
    undo: (scope) => run("undo", (record) => record.entry.scope === scope),
    undoById: (id) => run("undo", (record) => record.id === id),
    redo: (scope) => run("redo", (record) => record.entry.scope === scope),
    entries(scope) {
      prune();
      return scope === undefined ? snapshot : snapshot.filter((entry) => entry.scope === scope);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      records = [];
      operation?.abort();
      publish();
    },
  };
}
