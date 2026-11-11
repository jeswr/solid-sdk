// AUTHORED-BY Codex GPT-6
import { expect, test, vi } from "vitest";
import { createDiscoveryCache } from "./cache.js";

test("expires at ten minutes, bounds cached identities and retries failed loads", async () => {
  let now = 0;
  const cache = createDiscoveryCache<number>(() => now);
  const load = vi.fn(async () => 1);
  expect(await cache("key", load)).toBe(1);
  now = 599_999;
  expect(await cache("key", load)).toBe(1);
  expect(load).toHaveBeenCalledTimes(1);
  now = 600_000;
  await cache("key", load);
  expect(load).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 1000; i++) await cache(String(i), load);
  await cache("key", load);
  expect(load).toHaveBeenCalledTimes(1003);
  const broken = vi.fn(async () => {
    throw new Error("unavailable");
  });
  await expect(cache("broken", broken)).rejects.toThrow();
  await expect(cache("broken", broken)).rejects.toThrow();
  expect(broken).toHaveBeenCalledTimes(2);
});

test.each([
  "miss",
  "expired",
  "refresh",
])("shares concurrent %s loads per key and clears the promise after success", async (mode) => {
  let now = 0;
  const cache = createDiscoveryCache<number>(() => now);
  if (mode !== "miss") await cache("key", async () => 1);
  if (mode === "expired") now = 600_000;
  const pending = Promise.withResolvers<number>();
  const load = vi.fn(() => pending.promise);
  const results = Array.from({ length: 20 }, () => cache("key", load, mode === "refresh"));
  // A different key must load independently while this one is still pending.
  expect(await cache("other", async () => 2)).toBe(2);
  pending.resolve(3);
  expect(await Promise.all(results)).toEqual(Array(20).fill(3));
  expect(load).toHaveBeenCalledTimes(1);
  expect(await cache("key", load)).toBe(3);
  expect(await cache("key", async () => 4, true)).toBe(4);
});

test.each([
  false,
  true,
])("shares failed loads, preserves cached values and permits retries (refresh=%s)", async (refresh) => {
  const cache = createDiscoveryCache<number>(() => 0);
  if (refresh) await cache("key", async () => 1);
  const pending = Promise.withResolvers<number>();
  const load = vi.fn(() => pending.promise);
  const results = Promise.allSettled(Array.from({ length: 20 }, () => cache("key", load, refresh)));
  const error = new Error("unavailable");
  pending.reject(error);
  expect(await results).toEqual(Array(20).fill({ status: "rejected", reason: error }));
  expect(load).toHaveBeenCalledTimes(1);
  if (refresh) expect(await cache("key", load)).toBe(1);
  expect(await cache("key", async () => 2, refresh)).toBe(2);
});

test("does not retain a synchronously thrown load failure", async () => {
  const cache = createDiscoveryCache<number>(() => 0);
  await expect(
    cache("key", () => {
      throw new Error("unavailable");
    }),
  ).rejects.toThrow("unavailable");
  expect(await cache("key", async () => 1)).toBe(1);
});
