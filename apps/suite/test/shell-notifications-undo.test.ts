// AUTHORED-BY Codex GPT-6.1-Sol
import { createUndoStack, type UndoEntry } from "@jeswr/suite-sdk/undo";
import { expect, it, vi } from "vitest";
import { createNotificationsController } from "../src/shell/notifications/controller";
import {
  createDemoNotificationSource,
  demoNotifications,
} from "../src/shell/notifications/demo-source";
import { createNotificationReadState } from "../src/shell/notifications/read-state";

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected notification fixture value");
  return value;
}

it("undoes and redoes dismissal by ID without disturbing another dismissal or read state", async () => {
  const controller = createNotificationsController([createDemoNotificationSource()]);
  await controller.refresh();
  const stack = createUndoStack();
  const push = (entry: Omit<UndoEntry, "scope"> | undefined) =>
    entry && stack.push({ ...entry, scope: "home" });
  const original = controller.getSnapshot();
  const first = present(original.items[0]);
  const second = present(original.items[1]);
  const id = push(controller.dismiss(first.id));
  push(controller.dismiss(second.id));
  expect(controller.getSnapshot().items).toHaveLength(4);
  expect(stack.entries()[0]?.label).toBe("Notification dismissed");
  await stack.undoById(present(id));
  expect(controller.getSnapshot().items.find((item) => item.id === first.id)).toEqual(first);
  expect(controller.getSnapshot().items.some((item) => item.id === second.id)).toBe(false);
  await stack.redo("home");
  expect(controller.getSnapshot().items).toHaveLength(4);
  expect(controller.dismiss("missing")).toBeUndefined();
});
it("restores mixed read flags, receipts and dismissal exactly after a source acknowledgement and refresh", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const receipts = createNotificationReadState("alice", storage);
  const controller = createNotificationsController(
    [createDemoNotificationSource()],
    undefined,
    undefined,
    receipts,
  );
  await controller.refresh();
  const items = controller.getSnapshot().items;
  await controller.markRead(present(items[0]).id);
  controller.dismiss(present(items[1]).id);
  const original = controller.getSnapshot();
  const previousReceipts = receipts.load();
  const stack = createUndoStack();
  await controller.markAllRead((entry) => stack.push({ ...entry, scope: "search" }));
  expect(stack.entries()[0]?.label).toBe("Marked 2 notifications as read");
  expect(controller.getSnapshot().unread).toBe(0);
  await controller.refresh();
  await stack.undo("search");
  await controller.refresh();
  expect(controller.getSnapshot()).toEqual(original);
  expect(receipts.load()).toEqual(previousReceipts);
  await stack.redo("search");
  await controller.refresh();
  expect(controller.getSnapshot().unread).toBe(0);
  const noop = vi.fn();
  await controller.markAllRead(noop);
  expect(noop).not.toHaveBeenCalled();
});
it("does not restore entries into a retired controller and respects cancellation", async () => {
  const controller = createNotificationsController([createDemoNotificationSource()]);
  await controller.refresh();
  const entry = present(controller.dismiss(present(controller.getSnapshot().items[0]).id));
  const abort = new AbortController();
  abort.abort();
  await expect(entry.undo(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  controller.stop();
  await expect(entry.undo(new AbortController().signal)).rejects.toThrow("session changed");
});

it("retains unrelated receipts when reverting bulk reads and supports denied storage", async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const state = createNotificationReadState("alice", storage);
  state.save(new Set(["one", "two"]));
  state.remove?.(new Set(["one"]));
  expect(state.load()).toEqual(new Set(["two"]));
  state.remove?.(new Set(["two"]));
  expect(state.load()).toEqual(new Set());
  createNotificationReadState("", storage).remove?.(new Set(["one"]));
  const denied = createNotificationReadState("alice", {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  });
  expect(() => denied.remove?.(new Set(["one"]))).not.toThrow();
});
it("fences every inverse on stop and abort, including bulk read redo", async () => {
  const controller = createNotificationsController([createDemoNotificationSource()]);
  await controller.refresh();
  const entry = present(controller.dismiss(present(controller.getSnapshot().items[0]).id));
  let bulk!: Omit<UndoEntry, "scope">;
  await controller.markAllRead((change) => {
    bulk = change;
  });
  const abort = new AbortController();
  abort.abort();
  await expect(present(entry.redo)(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  await expect(bulk.undo(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  await expect(present(bulk.redo)(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  controller.stop();
  await expect(present(entry.redo)(new AbortController().signal)).rejects.toThrow(
    "session changed",
  );
  await expect(bulk.undo(new AbortController().signal)).rejects.toThrow("session changed");
  await expect(present(bulk.redo)(new AbortController().signal)).rejects.toThrow("session changed");
});

// AUTHORED-BY Claude Opus 5.5
it("persists restored unread state in sources that store read flags", async () => {
  const store = new Map([
    ["n1", { id: "n1", read: false }],
    ["n2", { id: "n2", read: true }],
  ]);
  const notification = (id: string, read: boolean) => ({
    ...present(demoNotifications()[0]),
    id,
    read,
  });
  const source = {
    id: "local:alice",
    list: async () => [...store.values()].map(({ id, read }) => notification(id, read)),
    markRead: vi.fn(async (ids: string[]) => {
      for (const id of ids) store.set(id, { id, read: true });
    }),
    markUnread: vi.fn(async (ids: string[]) => {
      for (const id of ids) store.set(id, { id, read: false });
    }),
  };
  const controller = createNotificationsController([source]);
  await controller.refresh();
  const stack = createUndoStack();
  await controller.markAllRead((entry) => stack.push({ ...entry, scope: "home" }));
  expect(stack.entries()[0]?.label).toBe("Marked 1 notification as read");
  expect(store.get("n1")?.read).toBe(true);
  expect(await stack.undo("home")).toEqual({ status: "done" });
  // Only the item this action marked is restored; the one read before stays read.
  expect(source.markUnread).toHaveBeenCalledWith(["n1"]);
  expect(store.get("n1")?.read).toBe(false);
  expect(store.get("n2")?.read).toBe(true);
  // A fresh controller (a reload) sees the restored state.
  const reloaded = createNotificationsController([source]);
  await reloaded.refresh();
  expect(reloaded.getSnapshot().unread).toBe(1);
});
