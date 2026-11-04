// AUTHORED-BY Claude Opus 5.5
/**
 * The app-level outbox seam the SyncSheet reads (02-suite-shell §10). The SDK's `useOutbox`
 * (SDK-APP-08) replaces the local implementation below; the interface is what the shell needs:
 * pending changes (what, where, when), retry, conflicts with a mine/theirs/both choice and the
 * last sync time.
 *
 * `createLocalOutbox` is the demo implementation: it keeps change *descriptions* (labels and
 * locations, never document contents) in this browser's storage, per account, and treats a retry
 * or a reconnect as a successful sync.
 */
import type { OutboxItem, SyncConflict } from "@jeswr/suite-ui/sync";
import { z } from "zod";

export type ConflictChoice = "mine" | "theirs" | "both";

export interface OutboxSnapshot {
  pending: readonly OutboxItem[];
  conflicts: readonly SyncConflict[];
  lastSyncedAt?: Date;
}

export interface Outbox {
  getSnapshot(): OutboxSnapshot;
  subscribe(listener: () => void): () => void;
  /** Record a change made while it could not be sent; returns its id. */
  enqueue(change: { label: string; where: string }): string;
  retry(id: string): Promise<void>;
  retryAll(): Promise<void>;
  resolve(conflictId: string, choice: ConflictChoice): Promise<void>;
  /** The connection came back: send the changes that are waiting (failed ones wait for Retry). */
  reconnected(): Promise<void>;
  /** Re-read persisted state, e.g. after another tab changed it. */
  reload(): void;
}

export const EMPTY_OUTBOX: OutboxSnapshot = { pending: [], conflicts: [] };
export const outboxKey = (accountId: string) => `suite.outbox.v1.${accountId}`;

const text = z.string().trim().min(1).max(200);
const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const itemSchema = z.object({
  id: text,
  label: text,
  where: z.string().max(200),
  queuedAt: date,
  state: z.enum(["pending", "failed"]),
  error: text.optional(),
});
const conflictSchema = z.object({
  id: text,
  name: text,
  where: z.string().max(200),
  summary: z.string().max(500),
  changedAt: date,
});
const listOf = <T extends z.ZodType>(schema: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((values) =>
      values.flatMap((value) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );
const storedSchema = z.object({
  pending: listOf(itemSchema),
  conflicts: listOf(conflictSchema),
  lastSyncedAt: date.optional().catch(undefined),
});

/** Malformed entries are dropped one by one; anything unreadable is an empty outbox. */
export function parseOutbox(raw: string | null): OutboxSnapshot {
  try {
    const parsed = storedSchema.parse(JSON.parse(raw ?? "{}"));
    const pending: OutboxItem[] = parsed.pending.map(({ error, ...item }) =>
      error ? { ...item, error } : item,
    );
    return {
      pending,
      conflicts: parsed.conflicts,
      ...(parsed.lastSyncedAt ? { lastSyncedAt: parsed.lastSyncedAt } : {}),
    };
  } catch {
    return EMPTY_OUTBOX;
  }
}

export function serializeOutbox(snapshot: OutboxSnapshot): string {
  return JSON.stringify(snapshot);
}

export interface LocalOutboxOptions {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  key: string;
  now: () => Date;
  newId: () => string;
}

export function createLocalOutbox({ storage, key, now, newId }: LocalOutboxOptions): Outbox {
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      return parseOutbox(storage?.getItem(key) ?? null);
    } catch {
      return EMPTY_OUTBOX;
    }
  };
  let snapshot = read();
  const commit = (next: OutboxSnapshot) => {
    snapshot = next;
    try {
      storage?.setItem(key, serializeOutbox(next));
    } catch {
      /* Kept in memory for this visit. */
    }
    for (const listener of [...listeners]) listener();
  };
  const synced = (keep: (item: OutboxItem) => boolean) => {
    const pending = snapshot.pending.filter(keep);
    if (pending.length === snapshot.pending.length) return;
    commit({ ...snapshot, pending, lastSyncedAt: now() });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enqueue({ label, where }) {
      const id = newId();
      commit({
        ...snapshot,
        pending: [...snapshot.pending, { id, label, where, queuedAt: now(), state: "pending" }],
      });
      return id;
    },
    async retry(id) {
      synced((item) => item.id !== id);
    },
    async retryAll() {
      synced(() => false);
    },
    async reconnected() {
      synced((item) => item.state === "failed");
    },
    async resolve(conflictId) {
      const conflicts = snapshot.conflicts.filter((conflict) => conflict.id !== conflictId);
      if (conflicts.length === snapshot.conflicts.length) return;
      commit({ ...snapshot, conflicts, lastSyncedAt: now() });
    },
    reload() {
      snapshot = read();
      for (const listener of [...listeners]) listener();
    },
  };
}
