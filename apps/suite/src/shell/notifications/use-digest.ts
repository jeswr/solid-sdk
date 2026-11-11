// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { buildDigest, isDue } from "@jeswr/suite-sdk/digest";
import { useEffect, useState } from "react";
import { inQuietHours } from "../lib/notifications-delivery";
import type { Preferences } from "../lib/settings-preferences";
import type { NotificationsController, NotificationsSnapshot } from "./controller";
import { showDesktopNotification } from "./desktop";
import { digestNotification, digestSchedule, summaryDesktopNotification } from "./digest";
import { readDigest, type StoredDigest, saveDigest } from "./digest-store";

/** Minimum wait before retrying a due digest after a failed listing. */
export const DIGEST_RETRY_MS = 5 * 60_000;

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
    // A failed listing (ours or a poll's) holds off our own refreshes; a successful poll clears it.
    let failedAt = Number.NEGATIVE_INFINITY;
    let wasLoading = controller.getSnapshot().loading;
    const due = (previous: StoredDigest | null, now: Date) =>
      isDue(
        previous ? new Date(previous.now) : null,
        digestSchedule(preferences),
        now,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    /** Builds from a listing that completed just now; never from an older snapshot. */
    const publish = (current: NotificationsSnapshot) => {
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
        void showDesktopNotification(summaryDesktopNotification(next, accountId), {
          renotify: true,
        }).catch(() => {});
    };
    const deliver = async (trigger: "timer" | "wake") => {
      if (disposed || refreshing || controller.getSnapshot().loading) return;
      // Hidden tabs retry only on the timer; every retry waits out the back-off.
      if (trigger === "wake" && document.visibilityState === "hidden") return;
      if (Date.now() - failedAt < DIGEST_RETRY_MS) return;
      if (!due(readDigest(accountId), new Date())) return;
      refreshing = true;
      try {
        // Polling can be paused in hidden tabs. Always reconcile before advancing delivery.
        const completed = await controller.refresh();
        // A superseded refresh is not a failure: the newer listing reports its own outcome.
        if (!completed || disposed) return;
        const current = controller.getSnapshot();
        if (current.loading) return;
        if (!current.coreReady) {
          failedAt = Date.now();
          return;
        }
        failedAt = Number.NEGATIVE_INFINITY;
        publish(current);
      } finally {
        refreshing = false;
      }
    };
    // A listing that completes while subscribed (a poll or live update) is fresh: use it
    // directly instead of starting a second refresh.
    const unsubscribe = controller.subscribe(() => {
      const current = controller.getSnapshot();
      const completed = wasLoading && !current.loading;
      wasLoading = current.loading;
      if (!completed || disposed) return;
      if (!current.coreReady) failedAt = Date.now();
      else if (!refreshing) {
        failedAt = Number.NEGATIVE_INFINITY;
        publish(current);
      }
    });
    const wake = () => void deliver("wake");
    wake();
    const timer = setInterval(() => void deliver("timer"), 30_000);
    addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [accountId, controller, preferences, ready]);
  return preferences.summary.mode === "off" || snapshot.accountId !== accountId
    ? null
    : snapshot.digest;
}
