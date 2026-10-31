// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { SubscriptionController } from "./subscription.js";
import type { ChangeEvent, SubscriptionState } from "./types.js";

const event: ChangeEvent = {
  type: "Update",
  object: "https://pod.example/a",
  objectKind: "unknown",
  published: new Date(0),
  id: "one",
  via: "poll",
  raw: null,
};
const states: SubscriptionState[] = ["connecting", "live", "degraded", "closed"];
const allowed = {
  connecting: ["live", "degraded", "closed"],
  live: ["degraded", "closed"],
  degraded: ["live", "closed"],
  closed: [],
};

test.each(
  states.flatMap((from) => states.map((to) => [from, to] as const)),
)("state transition %s -> %s", (from, to) => {
  const sub = new SubscriptionController(["a"]);
  sub.transition(from);
  const state = vi.fn();
  sub.on("state", state);
  sub.transition(to, "reason");
  const legal = (allowed[from] as string[]).includes(to);
  expect(sub.state).toBe(legal ? to : from);
  expect(state).toHaveBeenCalledTimes(legal ? 1 : 0);
  if (legal) expect(state).toHaveBeenCalledWith(to, "reason");
});

test("snapshots topics, unsubscribes handlers, closes once and suppresses events after close", async () => {
  const topics = ["a"];
  const sub = new SubscriptionController(topics);
  topics.push("b");
  expect(sub.topics).toEqual(["a"]);
  expect(Object.isFrozen(sub.topics)).toBe(true);
  expect(sub.channel).toBeNull();
  const change = vi.fn();
  const resync = vi.fn();
  const off = sub.on("change", change);
  const offResync = sub.on("resync", resync);
  sub.change(event);
  sub.resync(new Date(1));
  expect(change).toHaveBeenCalledWith(event);
  expect(resync).toHaveBeenCalledWith(new Date(1));
  off();
  offResync();
  sub.change(event);
  sub.resync(new Date(2));
  expect(change).toHaveBeenCalledTimes(1);
  expect(resync).toHaveBeenCalledTimes(1);
  sub.cleanup = vi.fn();
  const first = sub.close();
  expect(sub.close()).toBe(first);
  await first;
  sub.change(event);
  sub.resync(new Date(3));
  expect(sub.cleanup).toHaveBeenCalledTimes(1);
  sub.on("change", change)();
  expect(sub.state).toBe("closed");
});

test("async iterators support queued events, simultaneous waiters and independent consumers", async () => {
  const sub = new SubscriptionController([]);
  const a = sub[Symbol.asyncIterator]();
  const b = sub[Symbol.asyncIterator]();
  const first = a.next();
  sub.change(event);
  expect(await first).toEqual({ value: event, done: false });
  expect(await b.next()).toEqual({ value: event, done: false });
  sub.change(event);
  expect(await a.next()).toEqual({ value: event, done: false });
  const pending = [a.next(), a.next()];
  await sub.close();
  expect(await Promise.all(pending)).toEqual([
    { value: undefined, done: true },
    { value: undefined, done: true },
  ]);
  expect(await b.next()).toEqual({ value: undefined, done: true });
  expect(await sub[Symbol.asyncIterator]().next()).toEqual({ value: undefined, done: true });
});

test("iterator return detaches its consumer without closing the subscription", async () => {
  const sub = new SubscriptionController([]);
  const iterator = sub[Symbol.asyncIterator]();
  const next = iterator.next();
  expect(await iterator.return?.()).toEqual({ value: undefined, done: true });
  expect(await next).toEqual({ value: undefined, done: true });
  sub.change(event);
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
  expect(sub.state).toBe("connecting");
  await sub.close();
});
