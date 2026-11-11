// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

import type { ConflictRecord, Outbox, OutboxItem } from "@jeswr/solid-offline/outbox";
import { useMemo, useSyncExternalStore } from "react";

export type { PageCache, PageCacheOptions } from "@jeswr/solid-offline";
export { cacheProvenance, createPageCache, purgeForWebId } from "@jeswr/solid-offline";

export { mergeRdf } from "@jeswr/solid-offline/merge";
export type {
  ConflictRecord,
  Outbox,
  OutboxItem,
  OutboxOperation,
  QueueingStorageClient,
  QueueingWriteResult,
  ReplayOptions,
} from "@jeswr/solid-offline/outbox";
export { createOutbox, withOutbox } from "@jeswr/solid-offline/outbox";
export type { UseOfflineStatusResult } from "@jeswr/solid-offline/react";
export { useOfflineStatus } from "@jeswr/solid-offline/react";

interface Snapshot {
  pending: OutboxItem[];
  conflicts: ConflictRecord[];
}
const EMPTY: Snapshot = { pending: [], conflicts: [] };
const serverSnapshot = () => EMPTY;

export interface UseOutboxResult extends Snapshot {
  retry: Outbox["retry"];
  retryAll(): Promise<void>;
  resolve: Outbox["resolve"];
  replay: Outbox["replay"];
}

/** Subscribe to a caller-owned, WebID-scoped outbox. Null is empty and inert. */
export function useOutbox(outbox: Outbox | null): UseOutboxResult {
  const store = useMemo(() => {
    const read = (): Snapshot =>
      outbox ? { pending: outbox.pending(), conflicts: outbox.conflicts() } : EMPTY;
    let snapshot = read();
    return {
      getSnapshot: () => snapshot,
      subscribe(changed: () => void) {
        if (!outbox) return () => {};
        const refresh = () => {
          snapshot = read();
          changed();
        };
        const change = outbox.on("change", refresh);
        const conflict = outbox.on("conflict", refresh);
        // Cover changes (including hydration) between render and subscription.
        refresh();
        return () => {
          change();
          conflict();
        };
      },
      actions: {
        retry: async (id?: string) => outbox?.retry(id),
        retryAll: async () => outbox?.retry(),
        resolve: async (...args: Parameters<Outbox["resolve"]>) => outbox?.resolve(...args),
        replay: async (...args: Parameters<Outbox["replay"]>) => outbox?.replay(...args),
      },
    };
  }, [outbox]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
  return useMemo(() => ({ ...snapshot, ...store.actions }), [snapshot, store]);
}
