// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reminder } from "../../src/apps/tasks/lib/model/reminders";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import { createMemoryFiredStore } from "../../src/apps/tasks/lib/reminders/fired-store";
import type {
  ReminderEvent,
  ReminderSnapshot,
  ReminderSource,
} from "../../src/apps/tasks/lib/reminders/runner";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast }));

type Module = typeof import("../../src/apps/tasks/state/reminders");
async function load(): Promise<Module> {
  vi.resetModules();
  return import("../../src/apps/tasks/state/reminders");
}
const now = new Date("2026-11-02T09:00:00Z");
const project = "https://pod.test/tasks/inbox.ttl";
const url = "https://pod.test/tasks/a.ttl";
const event: ReminderEvent = {
  taskUrl: url,
  title: "Call mum",
  fireTime: now,
  tag: `${url}@2026-11-02T09:00:00.000Z`,
  body: "Due today 10:00",
};

function snapshot(reminders: Reminder[], status: "loading" | "ready" = "ready"): ReminderSnapshot {
  const view = {
    url,
    title: "Call mum",
    state: "open",
    due: new Date("2026-11-02T10:00:00Z"),
    hasReminders: true,
  } as TaskView;
  const item = { url, task: { reminders } } as unknown as StoredTask;
  return {
    status,
    projects: [{ url: project }],
    tasks: { [project]: { status: "ready", items: [item] } },
    views: [view],
  };
}
class Source implements ReminderSource {
  listeners = new Set<() => void>();
  constructor(public value: ReminderSnapshot) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: ReminderSnapshot) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}
class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}
function action(call = 0) {
  const options = toast.mock.calls[call]?.[1] as { action: { onClick: () => void } } | undefined;
  if (!options) throw new Error(`Missing toast ${call}`);
  return options.action;
}
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  toast.mockClear();
  FakeNotification.permission = "default";
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockClear();
  sessionStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fired reminder store", () => {
  it("is shared per tab and falls back to memory without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { firedReminderStore } = await load();
    const store = firedReminderStore();
    expect(firedReminderStore()).toBe(store);
    expect(await store.claim("a")).toBe(true);
    expect(await store.claim("a")).toBe(false);
  });
  it("uses IndexedDB and reports when it cannot open", async () => {
    const failure = new Error("blocked by policy");
    const open = vi.fn(() => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => {
        Object.defineProperty(request, "error", { value: failure });
        request.onerror?.(new Event("error"));
      });
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    const { firedReminderStore } = await load();
    const store = firedReminderStore();
    expect(await store.claim("a")).toBe(true);
    expect(await store.claim("a")).toBe(false);
    expect(open).toHaveBeenCalledWith("tasks", undefined);
    expect(warn).toHaveBeenCalledWith("Tasks reminders:", failure);
  });
});

function stubServiceWorker(registration?: { showNotification: ReturnType<typeof vi.fn> }) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: {}, getRegistration: vi.fn(async () => registration) },
  });
}
afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
});
const illegal = new TypeError("Illegal constructor");
class ThrowingNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn();
  constructor() {
    throw illegal;
  }
}
const reminderToast = {
  id: event.tag,
  description: "Due today 10:00",
  duration: Number.POSITIVE_INFINITY,
  closeButton: true,
  action: { label: "Open", onClick: expect.any(Function) },
};

describe("reminder delivery", () => {
  it("shows a permitted notification and a persistent toast that both open the task", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    FakeNotification.permission = "granted";
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const open = vi.fn();
    const { deliverReminder } = await load();
    await deliverReminder(event, open);
    const [notification] = FakeNotification.instances;
    expect(notification?.title).toBe("Call mum");
    expect(notification?.options).toEqual({ body: "Due today 10:00", tag: event.tag });
    notification?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(url);
    expect(notification?.close).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledExactlyOnceWith("Reminder: Call mum", reminderToast);
    open.mockClear();
    action().onClick();
    expect(open).toHaveBeenCalledWith(url);
  });
  it("uses the controlling service worker's registration when there is one", async () => {
    vi.stubGlobal("Notification", ThrowingNotification);
    const registration = { showNotification: vi.fn(async () => {}) };
    stubServiceWorker(registration);
    const { deliverReminder } = await load();
    await deliverReminder(event, vi.fn());
    expect(registration.showNotification).toHaveBeenCalledExactlyOnceWith("Call mum", {
      body: "Due today 10:00",
      tag: event.tag,
      data: { taskUrl: url },
    });
    expect(warn).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledExactlyOnceWith("Reminder: Call mum", reminderToast);
    // A controller without a registration falls back to the constructor.
    stubServiceWorker();
    vi.stubGlobal("Notification", FakeNotification);
    FakeNotification.permission = "granted";
    await deliverReminder(event, vi.fn());
    expect(FakeNotification.instances).toHaveLength(1);
  });
  it("falls back to the toast without permission, support, or a working constructor", async () => {
    const { deliverReminder } = await load();
    vi.stubGlobal("Notification", undefined);
    await deliverReminder(event, vi.fn());
    vi.stubGlobal("Notification", FakeNotification);
    FakeNotification.permission = "denied";
    await deliverReminder(event, vi.fn());
    expect(FakeNotification.instances).toEqual([]);
    vi.stubGlobal("Notification", ThrowingNotification);
    await deliverReminder(event, vi.fn());
    expect(warn).toHaveBeenCalledWith("Tasks reminders:", illegal);
    expect(toast).toHaveBeenCalledTimes(3);
  });
});

describe("notification permission offer", () => {
  it("offers once per session only while permission is undecided", async () => {
    const { offerNotificationPermission } = await load();
    vi.stubGlobal("Notification", undefined);
    offerNotificationPermission();
    vi.stubGlobal("Notification", FakeNotification);
    FakeNotification.permission = "denied";
    offerNotificationPermission();
    expect(toast).not.toHaveBeenCalled();
    FakeNotification.permission = "default";
    offerNotificationPermission();
    offerNotificationPermission();
    expect(toast).toHaveBeenCalledExactlyOnceWith("Get a notification when reminders are due?", {
      duration: 10_000,
      action: { label: "Allow notifications", onClick: expect.any(Function) },
    });
    // The feature check's probe notification is closed at once.
    expect(FakeNotification.instances.every((probe) => probe.close.mock.calls.length)).toBe(true);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    action().onClick();
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    // A reload in the same session does not ask again.
    const reloaded = await load();
    reloaded.offerNotificationPermission();
    expect(toast).toHaveBeenCalledOnce();
  });
  it("does not offer when neither a service worker nor the constructor can notify", async () => {
    ThrowingNotification.permission = "default";
    vi.stubGlobal("Notification", ThrowingNotification);
    const { offerNotificationPermission } = await load();
    offerNotificationPermission();
    expect(toast).not.toHaveBeenCalled();
    stubServiceWorker({ showNotification: vi.fn() });
    offerNotificationPermission();
    expect(toast).toHaveBeenCalledOnce();
    ThrowingNotification.permission = "granted";
  });
  it("treats a non-TypeError from the probe as a working constructor", async () => {
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "default";
        constructor() {
          throw new DOMException("denied", "NotAllowedError");
        }
      },
    );
    const { offerNotificationPermission } = await load();
    offerNotificationPermission();
    expect(toast).toHaveBeenCalledOnce();
  });
  it("reports a rejected request and still limits the offer when storage is blocked", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    const failure = new Error("denied by policy");
    FakeNotification.requestPermission.mockRejectedValueOnce(failure);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { offerNotificationPermission } = await load();
    offerNotificationPermission();
    offerNotificationPermission();
    expect(toast).toHaveBeenCalledOnce();
    action().onClick();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("Tasks reminders:", failure));
  });
});

describe("useReminderScheduler", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  it("ticks after load, every five minutes and when visible, until unmounted", async () => {
    vi.useFakeTimers({ now });
    const { useReminderScheduler } = await load();
    const source = new Source(snapshot([], "loading"));
    const store = createMemoryFiredStore();
    const claim = vi.spyOn(store, "claim");
    const first = vi.fn();
    const latest = vi.fn();
    function Probe({ open }: { open: (url: string) => void }) {
      useReminderScheduler(source, open, store);
      return null;
    }
    await act(async () => root.render(createElement(Probe, { open: first })));
    await flush();
    expect(toast).not.toHaveBeenCalled();
    act(() => source.set(snapshot([{ offset: "-PT1H" }])));
    await flush();
    expect(toast).toHaveBeenCalledOnce();
    expect(toast.mock.calls[0]?.[0]).toBe("Reminder: Call mum");
    // Rows re-render with a fresh navigation callback; the toast action uses the newest one.
    await act(async () => root.render(createElement(Probe, { open: latest })));
    action().onClick();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(url);
    act(() => source.set(snapshot([{ offset: "-PT1H" }, { offset: "-PT55M" }])));
    await flush(5 * 60_000);
    expect(toast).toHaveBeenCalledTimes(2);
    const calls = claim.mock.calls.length;
    setVisibility("hidden");
    await flush();
    expect(claim.mock.calls.length).toBe(calls);
    setVisibility("visible");
    await flush();
    expect(claim.mock.calls.length).toBe(calls + 2);
    expect((window as { tasksReminderTestHook?: unknown }).tasksReminderTestHook).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(host);
    setVisibility("visible");
    await flush(15 * 60_000);
    expect(claim.mock.calls.length).toBe(calls + 2);
    expect(source.listeners.size).toBe(0);
  });
  it("leaves claims to a visible tab unless notifications are granted", async () => {
    vi.useFakeTimers({ now });
    setVisibility("hidden");
    vi.stubGlobal("Notification", FakeNotification);
    const { useReminderScheduler } = await load();
    const source = new Source(snapshot([{ offset: "-PT1H" }]));
    const store = createMemoryFiredStore();
    const claim = vi.spyOn(store, "claim");
    function Probe() {
      useReminderScheduler(source, vi.fn(), store);
      return null;
    }
    await act(async () => root.render(createElement(Probe)));
    await flush(5 * 60_000);
    expect(claim).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    // A system notification is visible from a hidden tab, so a granted tab may claim.
    FakeNotification.permission = "granted";
    await flush(5 * 60_000);
    expect(claim).toHaveBeenCalledOnce();
    expect(FakeNotification.instances).toHaveLength(1);
    expect(toast).toHaveBeenCalledOnce();
    setVisibility("visible");
  });
  it("delivers once across a strict-mode remount using the shared store", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { useReminderScheduler } = await load();
    const source = new Source(snapshot([{ offset: "-PT1H" }]));
    function Probe() {
      useReminderScheduler(source, vi.fn());
      return null;
    }
    vi.useFakeTimers({ now });
    await act(async () => root.render(createElement(Probe)));
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    await flush();
    expect(toast).toHaveBeenCalledOnce();
  });
  it("reports tick errors without delivering", async () => {
    const { useReminderScheduler } = await load();
    const source = new Source(snapshot([{ offset: "P1M" }]));
    function Probe() {
      useReminderScheduler(source, vi.fn(), createMemoryFiredStore());
      return null;
    }
    await act(async () => root.render(createElement(Probe)));
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Tasks reminders:", expect.any(TypeError)),
    );
    expect(toast).not.toHaveBeenCalled();
  });
  it("exposes a clock and tick hook only in dev fixture builds", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
    const { useReminderScheduler } = await load();
    const source = new Source(snapshot([], "loading"));
    function Probe() {
      useReminderScheduler(source, vi.fn(), createMemoryFiredStore());
      return null;
    }
    await act(async () => root.render(createElement(Probe)));
    const hook = (
      window as {
        tasksReminderTestHook?: {
          setNow(value: string | number | null): void;
          tick(): Promise<number>;
        };
      }
    ).tasksReminderTestHook;
    if (!hook) throw new Error("Expected the dev reminder hook");
    expect(await hook.tick()).toBe(-1);
    source.value = snapshot([{ offset: "PT0S" }]);
    hook.setNow("2026-11-02T09:59:00Z");
    expect(await hook.tick()).toBe(0);
    hook.setNow(Date.parse("2026-11-02T10:00:00Z"));
    expect(await hook.tick()).toBe(1);
    hook.setNow(null);
    expect(await hook.tick()).toBe(0);
    act(() => root.unmount());
    root = createRoot(host);
    expect((window as { tasksReminderTestHook?: unknown }).tasksReminderTestHook).toBeUndefined();
  });
});
