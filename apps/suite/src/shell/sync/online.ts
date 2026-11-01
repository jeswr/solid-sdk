// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The SyncSnapshot behind the shell's OfflinePill and SyncSheet (02-suite-shell §10): the
 * connection state (see offline-provider) plus the active account's outbox.
 */
import type { SyncSnapshot } from "@jeswr/suite-ui/sync";
import { useMemo } from "react";
import { useConnectionState, useOutbox } from "./offline-provider";

export function useSyncSnapshot(): SyncSnapshot {
  const state = useConnectionState();
  const { snapshot } = useOutbox();
  return useMemo(
    () => ({
      online: state !== "offline",
      reconnecting: state === "reconnecting",
      pending: snapshot.pending,
      conflicts: snapshot.conflicts,
      ...(snapshot.lastSyncedAt ? { lastSyncedAt: snapshot.lastSyncedAt } : {}),
    }),
    [state, snapshot],
  );
}
