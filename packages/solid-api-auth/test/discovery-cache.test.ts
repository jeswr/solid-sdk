// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, test, vi } from "vitest";
import { createDiscoveryCache } from "../src/discovery-cache.js";

test.each([
  { maxEntries: 0 },
  { maxEntries: 1.5 },
  { maxEntries: NaN },
  { timeoutMs: 0 },
  { timeoutMs: Infinity },
])("rejects invalid cache options %j", (options) => {
  expect(() => createDiscoveryCache(Date.now, options)).toThrow("limits");
});

test("bounds concurrent distinct loads while allowing callers to join an occupied key", async () => {
  const cache = createDiscoveryCache<number>(() => 0, { maxEntries: 1, timeoutMs: 100 });
  const pending = Promise.withResolvers<number>();
  const first = cache("a", () => pending.promise);
  const joined = cache("a", async () => 99, true);
  await expect(cache("b", async () => 2)).rejects.toThrow("capacity");
  pending.resolve(1);
  expect(await Promise.all([first, joined])).toEqual([1, 1]);
  expect(await cache("b", async () => 2)).toBe(2);
});

test("evicts expired entries before live ones and honors custom deadlines", async () => {
  let clock = 0;
  const cache = createDiscoveryCache<number>(() => clock, { maxEntries: 2, timeoutMs: 10 });
  await cache("expired", async () => 1);
  clock = 1;
  await cache("live", async () => 2);
  clock = 600_000;
  await cache("other", async () => 3);
  expect(cache.peek("expired")).toBeUndefined();
  expect(cache.peek("live")).toBe(2);
});

test.each([
  false,
  true,
])("mixes forced and ordinary loads without duplicate I/O (expired=%s)", async (expired) => {
  let clock = 0;
  const cache = createDiscoveryCache<number>(() => clock);
  await cache("a", async () => 1);
  if (expired) clock = 600_000;
  const pending = Promise.withResolvers<number>();
  const load = vi.fn(() => pending.promise);
  const forced = cache("a", load, true);
  const ordinary = cache("a", load);
  if (!expired) expect(await ordinary).toBe(1);
  pending.resolve(2);
  expect(await forced).toBe(2);
  expect(await ordinary).toBe(expired ? 2 : 1);
  expect(load).toHaveBeenCalledTimes(1);
});

test("timeout aborts the transport, preserves the previous expiry and ignores late success", async () => {
  vi.useFakeTimers();
  try {
    const cache = createDiscoveryCache<number>(Date.now, { timeoutMs: 10 });
    await cache("a", async () => 1);
    const pending = Promise.withResolvers<number>();
    let signal: AbortSignal | undefined;
    const result = cache(
      "a",
      async (value) => {
        signal = value;
        return pending.promise;
      },
      true,
    );
    const rejected = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(cache.peek("a")).toBe(1);
    const replacement = Promise.withResolvers<number>();
    const fresh = cache("a", () => replacement.promise, true);
    pending.resolve(99);
    await Promise.resolve();
    expect(cache.pending("a")).toBe(true);
    replacement.resolve(2);
    expect(await fresh).toBe(2);
    // A failed refresh never extends the lifetime of the prior value.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(cache.peek("a")).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("a hung load times out and releases its in-flight slot", async () => {
  vi.useFakeTimers();
  try {
    const cache = createDiscoveryCache<number>(() => Date.now());
    const pending = Promise.withResolvers<number>();
    let state = "pending";
    const result = cache("hung", () => pending.promise).then(
      () => {
        state = "fulfilled";
      },
      () => {
        state = "rejected";
      },
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(state).toBe("rejected");
    await result;
    expect(await cache("hung", async () => 2)).toBe(2);
    pending.resolve(1);
    await Promise.resolve();
    expect(await cache("hung", async () => 3)).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

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
