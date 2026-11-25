// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The Permissions History binding: answered requests from the owner's access records, and
 * revoking an approval that is still active. Reads and writes use Home's own pod session, as the
 * Permissions page and the Requests inbox do.
 */

import { useCallback, useEffect, useState } from "react";
import { useHomeSession } from "../components/home-app";
import {
  type ActiveHistoryEntry,
  type HistoryEntry,
  readAccessHistory,
  revokeHistoryGrant,
} from "../lib/permissions/history";

export interface HistoryBinding {
  status: "loading" | "ready" | "error";
  entries: readonly HistoryEntry[];
  refresh(): Promise<void>;
  /** Revoke one active approval; the history is read again whatever the outcome. */
  revoke(entry: ActiveHistoryEntry): Promise<void>;
}

export function useAccessHistory(): HistoryBinding {
  const session = useHomeSession();
  const [state, setState] = useState<{
    session: typeof session;
    status: HistoryBinding["status"];
    entries: readonly HistoryEntry[];
  }>();
  const refresh = useCallback(async () => {
    try {
      const entries = await readAccessHistory(session.fetch, session.storageUrl);
      setState({ session, status: "ready", entries });
    } catch {
      // A failed refresh keeps the history already shown.
      setState((current) =>
        current?.session === session && current.status === "ready"
          ? current
          : { session, status: "error", entries: [] },
      );
    }
  }, [session]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const revoke = useCallback(
    async (entry: ActiveHistoryEntry) => {
      try {
        await revokeHistoryGrant(entry, {
          fetch: session.fetch,
          webId: session.webId,
          storage: session.storageUrl,
        });
      } finally {
        await refresh();
      }
    },
    [session, refresh],
  );
  // Another account's history is never shown while this one's loads.
  const current = state?.session === session ? state : undefined;
  return {
    status: current?.status ?? "loading",
    entries: current?.entries ?? [],
    refresh,
    revoke,
  };
}
