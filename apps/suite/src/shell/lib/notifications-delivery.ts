// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { inQuietHours as digestQuietHours } from "@jeswr/suite-sdk/digest";
import type { NotificationKind } from "./notifications-model";
import type { Preferences } from "./settings-preferences";

/** Settings › Notifications toggle that governs each kind. */
export const kindPreference = {
  shared: "shared",
  "access-request": "requests",
  comment: "comments",
  task: "tasks",
  "sync-conflict": "conflicts",
  storage: "storage",
  system: "system",
} as const satisfies Record<NotificationKind, keyof Preferences["notifications"]>;

/** 02-§7: only these kinds may pop up on the desktop (comment text never reaches a lock screen). */
export const desktopKinds: ReadonlySet<NotificationKind> = new Set([
  "shared",
  "access-request",
  "task",
]);

/** Quiet hours may cross midnight (22:00–08:00); equal times mean "never quiet". */
export function inQuietHours(quiet: Preferences["quietHours"], now: Date): boolean {
  return digestQuietHours(quiet, now, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Whether a new notification may pop up on the desktop. The tray always lists every
 * notification (access requests must stay actionable); these settings govern only the
 * interruption: the account's opt-in, the kind's toggle, and quiet hours.
 */
export function shouldNotifyDesktop(
  kind: NotificationKind,
  preferences: Preferences,
  now: Date,
): boolean {
  return (
    desktopKinds.has(kind) &&
    preferences.desktop &&
    preferences.notifications[kindPreference[kind]] &&
    !inQuietHours(preferences.quietHours, now)
  );
}
