// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { buildDigest, type Digest, isDue } from "@jeswr/suite-sdk/digest";
import { useEffect, useState } from "react";
import { inQuietHours } from "../lib/notifications-delivery";
import type { Preferences } from "../lib/settings-preferences";
import type { NotificationsController } from "./controller";
import { showDesktopNotification } from "./desktop";
import { digestNotification, digestSchedule, summaryDesktopNotification } from "./digest";
import { readDigest, saveDigest } from "./digest-store";

/** Runs only in a committed account session. Browser wake/focus catches up missed slots. */
export function useDigest(
  accountId: string,
  controller: NotificationsController,
  preferences: Preferences,
) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; digest: Digest | null }>({
    accountId,
    digest: null,
  });
  useEffect(() => {
    if (!accountId || preferences.summary.mode === "off") return;
    const setDigest = (digest: Digest | null) => setSnapshot({ accountId, digest });
    setDigest(readDigest(accountId));
    const deliver = () => {
      const current = controller.getSnapshot();
      if (current.loading || current.error) return;
      const now = new Date();
      const previous = readDigest(accountId);
      if (
        !isDue(
          previous ? new Date(previous.now) : null,
          digestSchedule(preferences),
          now,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        )
      )
        return;
      const next = buildDigest(current.items.map(digestNotification), {
        since: previous?.now ?? 0,
        now: now.getTime(),
      });
      // Advance the watermark even for empty intervals, avoiding repeated catch-up attempts.
      saveDigest(accountId, next);
      setDigest(next);
      if (next.count && preferences.desktop && !inQuietHours(preferences.quietHours, now))
        void showDesktopNotification(summaryDesktopNotification(next)).catch(() => {});
    };
    deliver();
    const unsubscribe = controller.subscribe(deliver);
    const timer = setInterval(deliver, 30_000);
    addEventListener("focus", deliver);
    document.addEventListener("visibilitychange", deliver);
    return () => {
      unsubscribe();
      clearInterval(timer);
      removeEventListener("focus", deliver);
      document.removeEventListener("visibilitychange", deliver);
    };
  }, [accountId, controller, preferences]);
  return preferences.summary.mode === "off" || snapshot.accountId !== accountId
    ? null
    : snapshot.digest;
}
