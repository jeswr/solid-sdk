// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Browser connectivity for the shell's OfflinePill (02-suite-shell §10). The
 * outbox (pending changes, conflicts) joins this when SDK-APP-08 lands; until
 * then the snapshot reports connectivity only.
 */
import type { SyncSnapshot } from "@jeswr/suite-ui/sync";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  addEventListener("online", onChange);
  addEventListener("offline", onChange);
  return () => {
    removeEventListener("online", onChange);
    removeEventListener("offline", onChange);
  };
}

const online: SyncSnapshot = { online: true, reconnecting: false, pending: [], conflicts: [] };
const offline: SyncSnapshot = { online: false, reconnecting: false, pending: [], conflicts: [] };

export function useSyncSnapshot(): SyncSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => (navigator.onLine ? online : offline),
    () => online,
  );
}
