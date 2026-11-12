// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { createRefreshCooldowns } from "../src/refresh-cooldowns.js";

test("expires at the boundary and does not renew rejected cooldowns", () => {
  let now = 0;
  const reserve = createRefreshCooldowns(() => now, 2);
  expect(reserve("a")).toBe(true);
  now = 59_999;
  expect(reserve("a")).toBe(false);
  now = 60_000;
  expect(reserve("a")).toBe(true);
});

test("evicts expired entries before the oldest and preserves live cooldowns under URL churn", () => {
  let now = 0;
  const reserve = createRefreshCooldowns(() => now, 2);
  expect(reserve("a")).toBe(true);
  now = 10_000;
  expect(reserve("b")).toBe(true);
  now = 60_000;
  expect(reserve("c")).toBe(true); // a expired: b must survive.
  expect(reserve("b")).toBe(false);
  expect(reserve("d")).toBe(true); // evicts oldest live b, remembers its expiry globally.
  for (const key of ["b", "e", "f", "g"]) expect(reserve(key)).toBe(false);
  now = 70_000;
  expect(reserve("e")).toBe(true);
  // c was evicted at capacity, but its live cooldown still applies.
  expect(reserve("c")).toBe(false);
  now = 120_000;
  expect(reserve("c")).toBe(true);
});
