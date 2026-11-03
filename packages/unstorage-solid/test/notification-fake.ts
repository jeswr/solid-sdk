// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChangeEvent, NotificationsClient, Subscription } from "@jeswr/pod-notifications";
import { vi } from "vitest";

export const BASE = "https://pod.example/kv/";

export function fakeNotifications() {
  const handlers = new Set<(change: ChangeEvent) => void>();
  const close = vi.fn(async () => {});
  const subscription = {
    topics: [BASE],
    state: "live",
    channel: "websocket",
    close,
    on: vi.fn((event: string, handler: (change: ChangeEvent) => void) => {
      if (event === "change") handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }),
    async *[Symbol.asyncIterator]() {},
  } as unknown as Subscription;
  const subscribe = vi.fn(async () => subscription);
  const notifications: NotificationsClient = {
    subscribe,
    plan: () => ({ channel: "websocket", reason: "test" }),
  };
  const emit = (object = `${BASE}a`, type: ChangeEvent["type"] = "Update") => {
    const change: ChangeEvent = {
      object,
      type,
      objectKind: "resource",
      published: new Date(0),
      id: "test",
      via: "websocket",
      raw: null,
    };
    for (const handler of handlers) handler(change);
  };
  return { notifications, subscription, subscribe, close, emit, handlers };
}
