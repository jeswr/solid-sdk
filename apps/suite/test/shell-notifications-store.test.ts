// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import {
  createDemoNotificationSource,
  demoNotifications,
} from "../src/shell/notifications/demo-source";
import {
  addLocalNotification,
  createLocalNotificationStore,
  localNotificationSource,
} from "../src/shell/notifications/local-store";

it("falls back to isolated memory with dates, dedupe, subscriptions, read writes and cancellation", async () => {
  const store = createLocalNotificationStore("one", undefined);
  const other = createLocalNotificationStore("two", undefined);
  const item = demoNotifications()[0]!;
  const changed = vi.fn();
  const stop = store.subscribe!(changed);
  await Promise.all([store.add(item), store.add({ ...item, title: "Updated" })]);
  const signal = new AbortController().signal;
  expect(await store.list(signal)).toEqual([{ ...item, title: "Updated" }]);
  await store.markRead!([item.id, "absent"]);
  const items = await store.list(signal);
  expect(items[0]?.read).toBe(true);
  expect(items[0]?.createdAt).toBeInstanceOf(Date);
  items[0]!.title = "Mutated copy";
  expect((await store.list(signal))[0]?.title).toBe("Updated");
  expect(await other.list(signal)).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(3);
  stop();
  await store.add(item);
  expect(changed).toHaveBeenCalledTimes(3);
  const abort = new AbortController();
  abort.abort();
  await expect(store.list(abort.signal)).rejects.toThrow();
});
it("recovers from an IndexedDB open error and shares the app-local entry point", async () => {
  const factory = {
    open() {
      throw new Error("Storage blocked");
    },
  } as unknown as IDBFactory;
  const store = createLocalNotificationStore("blocked", factory);
  const item = demoNotifications()[0]!;
  await store.add(item);
  expect(await store.list(new AbortController().signal)).toEqual([item]);
  const source = localNotificationSource("entry-point");
  expect(localNotificationSource("entry-point")).toBe(source);
  await addLocalNotification("entry-point", item);
  expect(await source.list(new AbortController().signal)).toEqual([item]);
});
it("demo has six fictional events, four unread, and confirms decisions in memory", async () => {
  const demo = createDemoNotificationSource();
  const signal = new AbortController().signal;
  const items = await demo.list(signal);
  expect(items).toHaveLength(6);
  expect(items.filter((item) => !item.read)).toHaveLength(4);
  const item = items.find((item) => item.request)!;
  await demo.decide(item.request!, { approve: true, role: "editor", duration: "day" });
  expect((await demo.list(signal)).find((n) => n.id === item.id)?.outcome).toBe(
    "Approved for Editor",
  );
  await demo.decide(item.request!, { approve: false });
  expect((await demo.list(signal)).find((n) => n.id === item.id)?.outcome).toBe("Denied");
});

it("persists events and read status in the account's IndexedDB events store", async () => {
  const { createRequire } = await import("node:module");
  const { IDBFactory } = createRequire(
    new URL("../../../packages/solid-offline/package.json", import.meta.url),
  )("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
  const factory = new IDBFactory();
  const open = vi.spyOn(factory, "open");
  const store = createLocalNotificationStore("durable", factory);
  const item = demoNotifications()[0]!;
  await store.add(item);
  await store.markRead!([item.id]);
  const reopened = createLocalNotificationStore("durable", factory);
  expect(await reopened.list(new AbortController().signal)).toEqual([{ ...item, read: true }]);
  expect(open).toHaveBeenCalledWith("suite-notifications-durable", 1);
  const anotherAccount = createLocalNotificationStore("unrelated", factory);
  expect(await anotherAccount.list(new AbortController().signal)).toEqual([]);
});

it("closes its connection on versionchange so saved copies can be cleared", async () => {
  const { createRequire } = await import("node:module");
  const { IDBFactory } = createRequire(
    new URL("../../../packages/solid-offline/package.json", import.meta.url),
  )("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
  const factory = new IDBFactory();
  const store = createLocalNotificationStore("clearable", factory);
  const item = demoNotifications()[0]!;
  await store.add(item);
  const blocked = vi.fn();
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase("suite-notifications-clearable");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = blocked;
  });
  expect(blocked).not.toHaveBeenCalled();
  // The store reopens lazily on the next write.
  await expect(store.markRead!([item.id])).resolves.toBeUndefined();
});
