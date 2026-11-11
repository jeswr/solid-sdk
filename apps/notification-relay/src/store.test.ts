// AUTHORED-BY Codex GPT-6
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
