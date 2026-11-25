// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import type { NotificationSource, SuiteNotification } from "../src/shell/lib/notifications-model";
import { createNotificationsController } from "../src/shell/notifications/controller";
import { demoNotifications } from "../src/shell/notifications/demo-source";

it("merges partial results, preserves local reads and dismissal across stale source listings and retries failures", async () => {
  const items = demoNotifications();
  const markRead = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  let fail = true;
  const controller = createNotificationsController([
    { id: "inbox", list: async () => items, markRead },
    {
      id: "requests",
      list: async () => {
        if (fail) throw new Error("offline");
        return [items[0]!];
      },
    },
  ]);
  const onChange = vi.fn();
  const stop = controller.subscribe(onChange);
  await controller.refresh();
  expect(controller.getSnapshot().items).toHaveLength(6);
  expect(controller.getSnapshot().error).toContain("Couldn't load");
  expect(controller.getSnapshot().coreReady).toBe(false);
  await controller.markRead(items[0]!.id);
  expect(controller.getSnapshot().unread).toBe(3);
  expect(controller.getSnapshot().error).toContain("Couldn't save");
  controller.dismiss(items[1]!.id);
  fail = false;
  await controller.refresh();
  expect(controller.getSnapshot().items).toHaveLength(5);
  expect(controller.getSnapshot().items.find((item) => item.id === items[0]!.id)?.read).toBe(true);
  expect(controller.getSnapshot().error).toBeNull();
  expect(controller.getSnapshot().coreReady).toBe(true);
  await controller.markAllRead();
  expect(controller.getSnapshot().unread).toBe(0);
  expect(markRead).toHaveBeenCalledTimes(3);
  expect(onChange).toHaveBeenCalled();
  stop();
  controller.stop();
});
it("fences overlapping refreshes and account teardown even when sources ignore AbortSignal", async () => {
  const waiting: ((items: SuiteNotification[]) => void)[] = [];
  const source: NotificationSource = {
    id: "slow",
    list: () => new Promise((resolve) => waiting.push(resolve)),
  };
  const old = createNotificationsController([source]);
  const first = old.refresh(),
    second = old.refresh();
  waiting[1]!(demoNotifications());
  expect(await second).toBe(true);
  waiting[0]!([]);
  expect(await first).toBe(false);
  expect(old.getSnapshot().items).toHaveLength(6);
  const third = old.refresh();
  old.stop();
  waiting[2]!([]);
  expect(await third).toBe(false);
  const next = createNotificationsController([]);
  await next.refresh();
  expect(next.getSnapshot().items).toEqual([]);
  expect(old.getSnapshot().items).toHaveLength(6);
});
it("clears failed optional agent results and keeps core readiness independent of read-save errors", async () => {
  const items = demoNotifications();
  const item = items[0];
  if (!item) throw new Error("Expected a core notification");
  const listAgent = vi
    .fn()
    .mockResolvedValueOnce([items[1]])
    .mockRejectedValue(new Error("unavailable"));
  const controller = createNotificationsController([
    {
      id: "inbox",
      list: async () => [item],
      markRead: async () => {
        throw new Error("offline");
      },
    },
    { id: "agent", optional: true, list: listAgent },
  ]);
  expect(controller.getSnapshot().coreReady).toBe(false);
  expect(await controller.refresh()).toBe(true);
  expect(controller.getSnapshot().items).toHaveLength(2);
  await controller.markRead(item.id);
  expect(controller.getSnapshot()).toMatchObject({
    coreReady: true,
    error: expect.stringContaining("Couldn't save"),
  });
  expect(await controller.refresh()).toBe(true);
  expect(controller.getSnapshot().items).toHaveLength(1);
  expect(controller.getSnapshot()).toMatchObject({
    coreReady: true,
    error: expect.stringContaining("Couldn't save"),
  });
});
it("reports a listing superseded by a completion listener as false", async () => {
  const controller = createNotificationsController([{ id: "s", list: async () => [] }]);
  let replacement: Promise<boolean> | undefined;
  const stop = controller.subscribe(() => {
    if (!controller.getSnapshot().loading) {
      stop();
      replacement = controller.refresh();
    }
  });
  expect(await controller.refresh()).toBe(false);
  expect(await replacement).toBe(true);
});
it("decides with the offered role, leaves failures retryable and marks success read", async () => {
  const items = demoNotifications();
  const request = items.find((item) => item.request)!;
  const decide = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const controller = createNotificationsController([{ id: "test", list: async () => items }], {
    decide,
  });
  await controller.refresh();
  await expect(controller.decide(request.id, { approve: true, role: "manager" })).rejects.toThrow(
    "requested roles",
  );
  await expect(
    controller.decide(request.id, { approve: true, role: "editor", duration: "month" }),
  ).rejects.toThrow("offline");
  expect(
    controller.getSnapshot().items.find((item) => item.id === request.id)?.outcome,
  ).toBeUndefined();
  await controller.decide(request.id, { approve: true, role: "editor", duration: "month" });
  expect(decide).toHaveBeenLastCalledWith(request.request, {
    approve: true,
    role: "editor",
    duration: "month",
  });
  await controller.refresh();
  expect(controller.getSnapshot().items.find((item) => item.id === request.id)).toMatchObject({
    read: true,
    outcome: "Approved for Editor",
  });
  await controller.decide(request.id, { approve: false });
  expect(controller.getSnapshot().items.find((item) => item.id === request.id)?.outcome).toBe(
    "Denied",
  );
  await expect(controller.decide("missing", { approve: false })).rejects.toThrow(
    "aren't available",
  );
  const unavailable = createNotificationsController([{ id: "test", list: async () => items }]);
  await unavailable.refresh();
  await expect(unavailable.decide(request.id, { approve: false })).rejects.toThrow(
    "aren't available",
  );
});
it("announces only new unread events after the initial listing", async () => {
  let items = demoNotifications().slice(0, 1);
  const onNew = vi.fn();
  const controller = createNotificationsController(
    [{ id: "test", list: async () => items }],
    undefined,
    onNew,
  );
  await controller.refresh();
  expect(onNew).not.toHaveBeenCalled();
  items = demoNotifications();
  await controller.refresh();
  expect(onNew).toHaveBeenCalledTimes(3);
  await controller.refresh();
  expect(onNew).toHaveBeenCalledTimes(3);
});
it("a superseded refresh does not retry pending reads", async () => {
  const item = { ...demoNotifications()[0]!, read: false };
  const deferred: ((items: SuiteNotification[]) => void)[] = [];
  let slow = false;
  const markRead = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const source: NotificationSource = {
    id: "live",
    list: () => (slow ? new Promise((resolve) => deferred.push(resolve)) : Promise.resolve([item])),
    markRead,
  };
  const controller = createNotificationsController([source]);
  await controller.refresh();
  // A failed write leaves the read pending, so a finished refresh would retry it.
  await controller.markRead(item.id);
  expect(markRead).toHaveBeenCalledTimes(1);
  slow = true;
  const first = controller.refresh();
  const second = controller.refresh();
  // The first listing returns after the second started: superseded, so it must not write
  // (its write could announce a change that starts yet another refresh, endlessly).
  deferred[0]?.([item]);
  await first;
  expect(markRead).toHaveBeenCalledTimes(1);
  deferred[1]?.([item]);
  await second;
  expect(markRead).toHaveBeenCalledTimes(2);
  controller.stop();
});
