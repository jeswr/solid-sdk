// AUTHORED-BY Codex GPT-6.1-Sol
import {
  classifyUrgency,
  type Digest,
  type DigestNotification,
  type DigestSchedule,
} from "@jeswr/suite-sdk/digest";
import { inQuietHours, kindPreference, shouldNotifyDesktop } from "../lib/notifications-delivery";
import type { SuiteNotification } from "../lib/notifications-model";
import type { Preferences } from "../lib/settings-preferences";

export function digestNotification(item: SuiteNotification): DigestNotification {
  return {
    id: item.id,
    kind: item.kind,
    app:
      item.app ??
      {
        shared: "drive",
        "access-request": "permissions",
        comment: "docs",
        task: "tasks",
        "sync-conflict": "sync",
        storage: "storage",
        system: "system",
      }[item.kind],
    title: item.title,
    time: item.createdAt.getTime(),
    read: item.read,
    ...(item.category ? { category: item.category } : {}),
    ...(item.target ? { target: item.target } : {}),
    ...(item.actor
      ? { actor: { name: item.actor.name, ...(item.actor.webId ? { id: item.actor.webId } : {}) } }
      : {}),
    ...(item.urgent === undefined ? {} : { urgent: item.urgent }),
    ...(item.blocking === undefined ? {} : { blocking: item.blocking }),
  };
}
export function digestSchedule(preferences: Preferences): DigestSchedule {
  const { mode, time, secondTime } = preferences.summary;
  return mode === "daily"
    ? { mode, time, quietHours: preferences.quietHours }
    : mode === "twice-daily"
      ? { mode, times: [time, secondTime], quietHours: preferences.quietHours }
      : { mode, quietHours: preferences.quietHours };
}
/** Summary mode queues ordinary pop-ups; urgent delivery still honours account opt-in. */
export function notifyImmediately(
  item: SuiteNotification,
  preferences: Preferences,
  now: Date,
): boolean {
  if (preferences.summary.mode === "off") return shouldNotifyDesktop(item.kind, preferences, now);
  return (
    preferences.desktop &&
    preferences.summary.urgentImmediately &&
    preferences.notifications[kindPreference[item.kind]] &&
    classifyUrgency(digestNotification(item)) &&
    !inQuietHours(preferences.quietHours, now)
  );
}
export function summaryDesktopNotification(digest: Digest): SuiteNotification {
  return {
    id: `summary-${digest.now}`,
    kind: "system",
    title: "Your summary is ready",
    href: "/notifications",
    createdAt: new Date(digest.now),
    read: false,
  };
}

/** Mention content stays in the tray, rather than appearing on a locked screen. */
export function immediateDesktopNotification(item: SuiteNotification): SuiteNotification {
  if (item.kind !== "comment") return item;
  const { body: _body, ...safe } = item;
  return { ...safe, title: "You were mentioned in a comment" };
}
