// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { buildDigest, isDue } from "@jeswr/suite-sdk/digest";
import { useEffect, useState } from "react";
import { inQuietHours } from "../lib/notifications-delivery";
import type { Preferences } from "../lib/settings-preferences";
import type { NotificationsController } from "./controller";
import { showDesktopNotification } from "./desktop";
import { digestNotification, digestSchedule, summaryDesktopNotification } from "./digest";
import { readDigest, type StoredDigest, saveDigest } from "./digest-store";

/** Runs only in a committed account session. Browser wake/focus catches up missed slots. */
export function useDigest(
  accountId: string,
  controller: NotificationsController,
  preferences: Preferences,
  ready = true,
) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; digest: StoredDigest | null }>({
    accountId,
    digest: null,
  });
  useEffect(() => {
    if (!accountId || preferences.summary.mode === "off") return;
    const setDigest = (digest: StoredDigest | null) => setSnapshot({ accountId, digest });
    setDigest(readDigest(accountId));
    if (!ready) return;
    let disposed = false;
    let refreshing = false;
    const due = (previous: StoredDigest | null, now: Date) =>
      isDue(
        previous ? new Date(previous.now) : null,
        digestSchedule(preferences),
        now,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    const deliver = async () => {
      if (disposed || refreshing || controller.getSnapshot().loading) return;
      if (!due(readDigest(accountId), new Date())) return;
      refreshing = true;
      try {
        // Polling can be paused in hidden tabs. Always reconcile before advancing delivery.
        if (!(await controller.refresh()) || disposed) return;
        const current = controller.getSnapshot();
        if (current.loading || !current.coreReady) return;
        const now = new Date();
        const previous = readDigest(accountId);
        if (!due(previous, now)) return;
        const next = buildDigest(current.items.map(digestNotification), {
          since: previous && previous.now <= now.getTime() ? previous.now : 0,
          now: now.getTime(),
          digestedIds: previous?.digestedIds ?? [],
        });
        // Even empty deliveries advance the schedule, while receipts admit late arrivals.
        setDigest(saveDigest(accountId, next));
        if (next.unread && preferences.desktop && !inQuietHours(preferences.quietHours, now))
          void showDesktopNotification(summaryDesktopNotification(next, accountId)).catch(() => {});
      } finally {
        refreshing = false;
      }
    };
    deliver();
    const unsubscribe = controller.subscribe(deliver);
    const timer = setInterval(deliver, 30_000);
    addEventListener("focus", deliver);
    document.addEventListener("visibilitychange", deliver);
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      removeEventListener("focus", deliver);
      document.removeEventListener("visibilitychange", deliver);
    };
  }, [accountId, controller, preferences, ready]);
  return preferences.summary.mode === "off" || snapshot.accountId !== accountId
    ? null
    : snapshot.digest;
}
