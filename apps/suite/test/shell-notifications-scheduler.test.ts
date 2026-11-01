// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import type { NotificationSource } from "../src/shell/lib/notifications-model";
import { startNotificationUpdates } from "../src/shell/lib/notifications-scheduler";

class Visibility extends EventTarget {
  visibilityState = "visible";
  set(value: string) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
const source: NotificationSource = {
  id: "poll",
  async list() {
    return [];
  },
};
afterEach(() => vi.useRealTimers());
it("refreshes on start, every 60s while visible, immediately on returning and stops cleanly", () => {
  vi.useFakeTimers();
  const document = new Visibility(),
    refresh = vi.fn();
  const stop = startNotificationUpdates([source], false, document, refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(59_999);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  document.set("hidden");
  vi.advanceTimersByTime(180_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  document.set("visible");
  expect(refresh).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(4);
  stop();
  document.set("visible");
  vi.advanceTimersByTime(120_000);
  expect(refresh).toHaveBeenCalledTimes(4);
});
it("uses subscriptions only with live capability, and still polls sources without subscribe", () => {
  vi.useFakeTimers();
  const document = new Visibility(),
    refresh = vi.fn(),
    unsubscribe = vi.fn();
  let change = () => {};
  const live: NotificationSource = {
    ...source,
    id: "live",
    subscribe(fn) {
      change = fn;
      return unsubscribe;
    },
  };
  const stop = startNotificationUpdates([live], true, document, refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  change();
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(120_000);
  document.set("visible");
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
  refresh.mockClear();
  const stopMixed = startNotificationUpdates([live, source], true, document, refresh);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  stopMixed();
  refresh.mockClear();
  const stopDisabled = startNotificationUpdates([live], false, document, refresh);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  stopDisabled();
});
it("falls back after subscription failure and defers hidden polling until visible", () => {
  vi.useFakeTimers();
  const document = new Visibility();
  document.visibilityState = "hidden";
  const refresh = vi.fn();
  const stop = startNotificationUpdates(
    [
      {
        ...source,
        subscribe() {
          throw new Error("Unavailable");
        },
      },
    ],
    true,
    document,
    refresh,
  );
  vi.advanceTimersByTime(60_000);
  expect(refresh).not.toHaveBeenCalled();
  document.set("visible");
  expect(refresh).toHaveBeenCalledOnce();
  stop();
  const stopEmpty = startNotificationUpdates([], true, document, refresh);
  expect(refresh).toHaveBeenCalledTimes(2);
  stopEmpty();
});
