// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { startWatch } from "../src/watch.js";
import { BASE, fakeNotifications } from "./notification-fake.js";

describe("SDK notification mapping", () => {
  it.each([
    "Create",
    "Update",
    "Add",
    "Move",
    "Delete",
    "Remove",
  ] as const)("maps %s", async (type) => {
    const fake = fakeNotifications();
    const callback = vi.fn();
    const active = await startWatch({ base: BASE, notifications: fake.notifications, callback });
    fake.emit(`${BASE}a/b%3Ac`, type);
    expect(callback).toHaveBeenCalledWith(
      type === "Delete" || type === "Remove" ? "remove" : "update",
      "a:b%3Ac",
    );
    expect(fake.subscribe).toHaveBeenCalledWith([BASE], { depth: "recursive" });
    active.unwatch();
    active.unwatch();
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.handlers.size).toBe(0);
    fake.emit();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each([
    BASE,
    `${BASE}?self`,
    `${BASE}#self`,
    "https://evil.example/x",
    "https://pod.example/other/x",
    `${BASE}bad%2Fkey`,
    `${BASE}bad%5Ckey`,
    `${BASE}bad%ZZ`,
    `${BASE}../x`,
  ])("ignores unsafe hint %s", async (object) => {
    const fake = fakeNotifications();
    const callback = vi.fn();
    const active = await startWatch({ base: BASE, notifications: fake.notifications, callback });
    fake.emit(object);
    expect(callback).not.toHaveBeenCalled();
    active.unwatch();
  });

  it("isolates synchronous and asynchronous consumer failures", async () => {
    const fake = fakeNotifications();
    const callback = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("consumer");
      })
      .mockRejectedValueOnce(new Error("async consumer"));
    const active = await startWatch({ base: BASE, notifications: fake.notifications, callback });
    expect(() => {
      fake.emit();
      fake.emit();
    }).not.toThrow();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(2);
    fake.close.mockRejectedValueOnce(new Error("close failed"));
    active.unwatch();
    await Promise.resolve();
  });

  it("degrades without exposing transport error contents", async () => {
    const fake = fakeNotifications();
    fake.subscribe.mockRejectedValueOnce(new Error("private transport data"));
    const onDegrade = vi.fn();
    const active = await startWatch({
      base: BASE,
      notifications: fake.notifications,
      callback: vi.fn(),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith("notification subscription failed");
    active.unwatch();
  });
});

it("closes the subscription if listener registration fails", async () => {
  const fake = fakeNotifications();
  vi.spyOn(fake.subscription, "on").mockImplementationOnce(() => {
    throw new Error("listener failed");
  });
  const active = await startWatch({
    base: BASE,
    notifications: fake.notifications,
    callback: vi.fn(),
  });
  expect(fake.close).toHaveBeenCalledTimes(1);
  active.unwatch();
});

it("closes even if listener removal throws", async () => {
  const fake = fakeNotifications();
  vi.spyOn(fake.subscription, "on").mockImplementationOnce(() => () => {
    throw new Error("off failed");
  });
  const active = await startWatch({
    base: BASE,
    notifications: fake.notifications,
    callback: vi.fn(),
  });
  expect(() => active.unwatch()).not.toThrow();
  expect(fake.close).toHaveBeenCalledTimes(1);
});
