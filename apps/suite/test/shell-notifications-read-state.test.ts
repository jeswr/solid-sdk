// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import type { NotificationSource } from "../src/shell/lib/notifications-model";
import { createNotificationsController } from "../src/shell/notifications/controller";
import {
  createDemoNotificationSource,
  demoNotifications,
} from "../src/shell/notifications/demo-source";
import { createNotificationReadState } from "../src/shell/notifications/read-state";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

it.each([
  "demo",
  "pod-inbox",
])("restores individual and all reads for a recreated %s source and still delivers new events", async (kind) => {
  const storage = memoryStorage();
  let live = demoNotifications();
  const source = (): NotificationSource =>
    kind === "demo"
      ? createDemoNotificationSource()
      : { id: "pod-inbox", list: async () => structuredClone(live) };
  const onNew = vi.fn();
  const open = () =>
    createNotificationsController(
      [source()],
      undefined,
      onNew,
      createNotificationReadState("alice", storage),
    );
  const first = open();
  await first.refresh();
  const item = first.getSnapshot().items[0];
  if (!item) throw new Error("Expected a notification");
  const id = item.id;
  await first.markRead(id);
  // A demo acknowledgement removes the pending overlay, but must retain the receipt.
  await first.refresh();
  first.stop();
  const second = open();
  await second.refresh();
  expect(second.getSnapshot().items.find((item) => item.id === id)?.read).toBe(true);
  expect(second.getSnapshot().unread).toBe(3);
  await second.markAllRead();
  await second.refresh();
  second.stop();
  const third = open();
  await third.refresh();
  expect(third.getSnapshot().unread).toBe(0);
  expect(third.getSnapshot().items.every((item) => item.read)).toBe(true);
  expect(onNew).not.toHaveBeenCalled();
  if (kind === "pod-inbox") {
    const incoming = { ...item, id: "new-live-notification", read: false };
    live = [...live, incoming];
    await third.refresh();
    expect(third.getSnapshot().unread).toBe(1);
    expect(onNew).toHaveBeenCalledExactlyOnceWith(incoming);
  }
  third.stop();
  expect(createNotificationReadState("bob", storage).load()).toEqual(new Set());
  expect(createNotificationReadState("", storage).load()).toEqual(new Set());
});

it("saves synchronously and retains a failed source write for retry after reload", async () => {
  const storage = memoryStorage();
  const item = demoNotifications()[0];
  if (!item) throw new Error("Expected a notification");
  const markRead = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const source = { id: "remote", list: async () => [item], markRead };
  const state = () => createNotificationReadState("alice", storage);
  const first = createNotificationsController([source], undefined, undefined, state());
  await first.refresh();
  const pending = first.markRead(item.id);
  // No await: a notification link may unload the page right after invoking markRead.
  expect(state().load()).toEqual(new Set([item.id]));
  await pending;
  expect(first.getSnapshot().error).toContain("Couldn't save");
  first.stop();
  const second = createNotificationsController([source], undefined, undefined, state());
  await second.refresh();
  expect(second.getSnapshot().unread).toBe(0);
  expect(second.getSnapshot().error).toBeNull();
  expect(markRead).toHaveBeenCalledTimes(2);
  second.stop();
});

it("merges receipts from separate controllers instead of replacing earlier reads", () => {
  const storage = memoryStorage();
  const first = createNotificationReadState("alice", storage);
  const second = createNotificationReadState("alice", storage);
  first.save(new Set(["one"]));
  second.save(new Set(["two"]));
  expect(first.load()).toEqual(new Set(["one", "two"]));
});

it.each([
  "invalid JSON",
  "null",
  JSON.stringify({ version: 2, accountId: "alice", ids: ["one"] }),
  JSON.stringify({ version: 1, accountId: "bob", ids: ["one"] }),
  JSON.stringify({ version: 1, accountId: "alice", ids: [42] }),
  JSON.stringify({ version: 1, accountId: "alice", ids: "one" }),
])("ignores malformed or mismatched saved receipts: %s", (raw) => {
  const state = createNotificationReadState("alice", { getItem: () => raw, setItem: () => {} });
  expect(state.load()).toEqual(new Set());
});

it("keeps notifications usable when browser storage is blocked", async () => {
  const denied = () => {
    throw new Error("Storage denied");
  };
  const state = createNotificationReadState("alice", { getItem: denied, setItem: denied });
  const controller = createNotificationsController(
    [createDemoNotificationSource()],
    undefined,
    undefined,
    state,
  );
  await controller.refresh();
  await controller.markAllRead();
  expect(controller.getSnapshot().unread).toBe(0);
  controller.stop();
});
