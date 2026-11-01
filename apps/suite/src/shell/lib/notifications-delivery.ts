// AUTHORED-BY Claude Opus 5.5
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

const minutes = (time: string) => {
  const [hours = 0, mins = 0] = time.split(":").map(Number);
  return hours * 60 + mins;
};

/** Quiet hours may cross midnight (22:00–08:00); equal times mean "never quiet". */
export function inQuietHours(quiet: Preferences["quietHours"], now: Date): boolean {
  if (!quiet.enabled) return false;
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
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
    preferences.desktop &&
    preferences.notifications[kindPreference[kind]] &&
    !inQuietHours(preferences.quietHours, now)
  );
}
