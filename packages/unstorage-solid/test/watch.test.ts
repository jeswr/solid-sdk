// AUTHORED-BY Codex GPT-6.1-Sol
import { createNotifications, type Subscription } from "@jeswr/pod-notifications";
import { FakeTimers } from "@jeswr/pod-notifications/testing";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import solidDriver from "../src/index.js";
import { BASE, fakeNotifications } from "./notification-fake.js";

describe("driver watch lifecycle", () => {
  it("is opt-in", async () => {
    const fake = fakeNotifications();
    const onWatchDegrade = vi.fn();
    const driver = solidDriver({ base: BASE, notifications: fake.notifications, onWatchDegrade });
    const unwatch = await driver.watch?.(vi.fn());
    expect(fake.subscribe).not.toHaveBeenCalled();
    expect(onWatchDegrade).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    unwatch?.();
  });

  it("disposes every watch and refuses further subscriptions", async () => {
    const fake = fakeNotifications();
    const driver = solidDriver({ base: BASE, watch: true, notifications: fake.notifications });
    const unwatch = await driver.watch?.(vi.fn());
    await driver.dispose?.();
    unwatch?.();
    expect(fake.close).toHaveBeenCalledTimes(1);
    await driver.watch?.(vi.fn());
    expect(fake.subscribe).toHaveBeenCalledTimes(1);
  });

  it("closes a subscription that resolves after disposal", async () => {
    const fake = fakeNotifications();
    let resolve!: (subscription: Subscription) => void;
    fake.subscribe.mockImplementationOnce(
      () =>
        new Promise<Subscription>((done) => {
          resolve = done;
        }),
    );
    const driver = solidDriver({ base: BASE, watch: true, notifications: fake.notifications });
    const pending = driver.watch?.(vi.fn());
    await driver.dispose?.();
    resolve(fake.subscription);
    await pending;
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.handlers.size).toBe(0);
  });

  it.each([
    "solid",
    "lws",
  ] as const)("uses pod-notifications polling on %s and releases timers", async (protocol) => {
    const storage = createMemoryStorage({ protocol, root: BASE, pageSize: 1 });
    const timers = new FakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const notifications = createNotifications({ storage, fetch, timers, now: timers.now });
    const callback = vi.fn();
    const driver = solidDriver({ base: BASE, storage, notifications, watch: true });
    const unwatch = await driver.watch?.(callback);
    await timers.advanceBy(0);
    const created = await storage.create(BASE, "one", { name: "a", contentType: "text/plain" });
    await timers.advanceBy(30_000);
    expect(callback).toHaveBeenCalledWith("update", "a");
    await storage.delete(created.url, { ifMatch: created.etag as string });
    await timers.advanceBy(30_000);
    expect(callback).toHaveBeenCalledWith("remove", "a");
    unwatch?.();
    expect(fetch).not.toHaveBeenCalled();
    expect(timers.pending).toBe(0);
  });
});

it.each(["solid", "lws"] as const)("creates the default SDK watcher for %s", async (protocol) => {
  vi.useFakeTimers();
  const storage = createMemoryStorage({ protocol, root: BASE });
  const callback = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const driver = solidDriver({ base: BASE, storage, fetch, watch: true });
  try {
    await driver.watch?.(callback);
    await vi.advanceTimersByTimeAsync(0);
    await storage.create(BASE, "new", { name: "new", contentType: "text/plain" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callback).toHaveBeenCalledWith("update", "new");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await driver.dispose?.();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
