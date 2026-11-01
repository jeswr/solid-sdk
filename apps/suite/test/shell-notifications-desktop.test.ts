// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { demoNotifications } from "../src/shell/notifications/demo-source";
import {
  desktopEnabled,
  desktopPermission,
  requestDesktopPermission,
  showDesktopNotification,
} from "../src/shell/notifications/desktop";

afterEach(() => vi.unstubAllGlobals());
it("defaults off, tolerates storage restrictions and reads either preference key form per account", () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  expect(desktopEnabled("one")).toBe(false);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key.endsWith("one")
        ? '{"notifications.desktop":true}'
        : '{"notifications":{"desktop":false}}',
  });
  expect(desktopEnabled("one")).toBe(true);
  expect(desktopEnabled("two")).toBe(false);
  vi.stubGlobal("localStorage", { getItem: () => '{"notifications":{"desktop":true}}' });
  expect(desktopEnabled("nested")).toBe(true);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Blocked");
    },
  });
  expect(desktopEnabled("one")).toBe(false);
});
it("unsupported and denied environments never prompt or display implicitly", async () => {
  vi.stubGlobal("Notification", undefined);
  expect(desktopPermission()).toBe("unsupported");
  expect(await requestDesktopPermission()).toBe("unsupported");
  await showDesktopNotification(demoNotifications()[0]!);
  const Notification = vi.fn();
  const requestPermission = vi.fn(async () => "denied");
  Object.assign(Notification, {
    permission: "denied",
    requestPermission,
  });
  vi.stubGlobal("Notification", Notification);
  expect(desktopPermission()).toBe("denied");
  await showDesktopNotification(demoNotifications()[0]!);
  expect(Notification).not.toHaveBeenCalled();
  expect(await requestDesktopPermission()).toBe("denied");
  expect(requestPermission).toHaveBeenCalledOnce();
});
it("uses an existing worker's ready registration and otherwise the browser constructor", async () => {
  const Notification = vi.fn(class {});
  Object.assign(Notification, { permission: "granted" });
  vi.stubGlobal("Notification", Notification);
  const showNotification = vi.fn(async () => {});
  const registration = { active: {}, showNotification };
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };
  vi.stubGlobal("navigator", { serviceWorker });
  const item = demoNotifications()[0]!;
  await showDesktopNotification(item);
  expect(showNotification).toHaveBeenCalledWith(
    item.title,
    expect.objectContaining({ tag: item.id, body: item.body, data: { href: item.href } }),
  );
  expect(Notification).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ...serviceWorker,
      getRegistration: async () => undefined,
      ready: new Promise(() => {}),
    },
  });
  await showDesktopNotification(item);
  expect(Notification).toHaveBeenCalledOnce();
  vi.stubGlobal("navigator", {});
  await showDesktopNotification(demoNotifications()[5]!);
  expect(Notification).toHaveBeenCalledTimes(2);
});
