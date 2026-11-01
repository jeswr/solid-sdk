// AUTHORED-BY Codex GPT-6.1-Sol
import type { SuiteNotification } from "../lib/notifications-model";
import {
  defaultPreferences,
  type Preferences,
  parsePreferences,
  preferencesKey,
} from "../lib/settings-preferences";

export function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
/** Call only from a user gesture, such as the Settings permission button. */
export async function requestDesktopPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.requestPermission();
}
/** The account's saved preferences, read fresh so a Settings change applies at once. */
export function accountPreferences(accountId: string): Preferences {
  try {
    return parsePreferences(localStorage.getItem(preferencesKey(accountId)));
  } catch {
    return defaultPreferences;
  }
}
/** Permission is never requested here. The provider separately checks the account's opt-in. */
export async function showDesktopNotification(notification: SuiteNotification): Promise<void> {
  if (desktopPermission() !== "granted") return;
  const options: NotificationOptions = {
    ...(notification.body ? { body: notification.body } : {}),
    tag: notification.id,
    data: { href: notification.href },
  };
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(notification.title, options);
      return;
    }
  }
  new Notification(notification.title, options);
}
