// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Connectivity banner over `@jeswr/solid-offline`'s status surface. When offline,
 * it reassures the user their logs are safe on-device and will sync (UX invariant
 * #2/#3); when there are un-synced writes it shows the pending count.
 */
import { useOfflineStatus } from "solid-offline/react";

export function OfflineBanner({ pendingWrites }: { pendingWrites: number }) {
  const { online } = useOfflineStatus();
  if (online && pendingWrites === 0) return null;
  return (
    <div className={`offline-banner ${online ? "offline-banner--syncing" : ""}`} role="status" aria-live="polite">
      {!online
        ? "You're offline — your logs are saved on this device and will sync when you reconnect."
        : `Syncing ${pendingWrites} change${pendingWrites === 1 ? "" : "s"}…`}
    </div>
  );
}
