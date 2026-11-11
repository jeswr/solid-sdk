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
