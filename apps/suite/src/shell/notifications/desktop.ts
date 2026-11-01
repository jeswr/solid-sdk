// AUTHORED-BY Codex GPT-6.1-Sol
import type { SuiteNotification } from "../lib/notifications-model";

export function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
/** Call only from a user gesture, such as the Settings permission button. */
export async function requestDesktopPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.requestPermission();
}
export function desktopEnabled(accountId: string): boolean {
  try {
    const preferences = JSON.parse(localStorage.getItem(`suite.prefs.v1.${accountId}`) ?? "null");
    return (
      preferences?.["notifications.desktop"] === true ||
      preferences?.notifications?.desktop === true
    );
  } catch {
    return false;
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
