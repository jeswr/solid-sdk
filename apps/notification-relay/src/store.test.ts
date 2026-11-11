// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "vitest";
import { InMemoryRelayStore } from "./store.js";

test("atomically reserves keys, isolates keys and expires them at five minutes", async () => {
  let now = 0;
  const store = new InMemoryRelayStore(() => now);
  expect(
    await Promise.all(Array.from({ length: 20 }, () => store.insertIfAbsent("proof", 300_000))),
  ).toEqual([true, ...Array(19).fill(false)]);
  expect(await store.insertIfAbsent("another-proof", 300_000)).toBe(true);
  now = 299_999;
  expect(await store.insertIfAbsent("proof", 300_000)).toBe(false);
  now = 300_000;
  expect(await store.insertIfAbsent("proof", 300_000)).toBe(true);
  for (const ttl of [0, -1, NaN, Infinity])
    await expect(store.insertIfAbsent("bad", ttl)).rejects.toThrow("lifetime");
  expect(await new InMemoryRelayStore().insertIfAbsent("system-clock", 1)).toBe(true);
});

test("fails closed at capacity and frees expired reservations first", async () => {
  let now = 0;
  const store = new InMemoryRelayStore(() => now, 3);
  expect(await store.insertIfAbsent("a", 1_000)).toBe(true);
  expect(await store.insertIfAbsent("b", 5_000)).toBe(true);
  expect(await store.insertIfAbsent("c", 1_000)).toBe(true);
  await expect(store.insertIfAbsent("d", 1_000)).rejects.toThrow("full");
  // A replay is still refused at capacity, before the capacity check.
  expect(await store.insertIfAbsent("a", 1_000)).toBe(false);
  now = 1_000;
  expect(await store.insertIfAbsent("d", 1_000)).toBe(true);
  expect(await store.insertIfAbsent("a", 1_000)).toBe(true);
  // The longer-lived reservation survives the cleanup.
  expect(await store.insertIfAbsent("b", 5_000)).toBe(false);
  for (const capacity of [0, -1, 1.5])
    expect(() => new InMemoryRelayStore(() => 0, capacity)).toThrow("capacity");
});

test("bounds routine cleanup work per insert and keeps unexpired reservations", async () => {
  let now = 0;
  const store = new InMemoryRelayStore(() => now, 1_000);
  for (let index = 0; index < 200; index++) await store.insertIfAbsent(`old-${index}`, 10);
  now = 10;
  await store.insertIfAbsent("new", 10);
  // 64 expired entries went in the bounded sweep. An expired key the sweep has not reached
  // yet is still treated as absent.
  expect(await store.insertIfAbsent("old-199", 10)).toBe(true);
  expect(await store.insertIfAbsent("old-199", 10)).toBe(false);
  expect(await store.insertIfAbsent("new", 10)).toBe(false);
});
