// AUTHORED-BY Codex
import { setTimeout as deadline } from "node:timers/promises";
import { expect, it } from "vitest";
import { exclusiveLocks } from "./drive-locks";

it("Web Locks keep acquired callbacks pending beyond the acquisition deadline", async () => {
  const locks = exclusiveLocks(10);
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const outcomes: unknown[] = [];
  const work = locks.request("source", { ifAvailable: true }, async (lock) => {
    expect(lock?.name).toBe("source");
    started.resolve();
    await gate.promise;
    return "committed";
  });
  const settled = work.then(
    (value) => outcomes.push(value),
    (error: unknown) => outcomes.push(error),
  );
  try {
    await started.promise;
    // Model slow durable IO without relying on machine load or busy waiting.
    await deadline(30);
    expect(outcomes).toEqual([]);
    expect(await locks.request("source", { ifAvailable: true }, (lock) => lock)).toBeNull();
  } finally {
    gate.resolve();
    await settled;
  }
  expect(outcomes).toEqual(["committed"]);
  expect(await locks.request("source", (lock) => lock?.name)).toBe("source");
});

it("Web Locks still expire queued acquisitions without running or releasing held work", async () => {
  const locks = exclusiveLocks(10);
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const held = locks.request("source", async () => {
    started.resolve();
    await gate.promise;
  });
  const heldResult = held.catch((error: unknown) => error);
  let ran = false;
  try {
    await started.promise;
    await expect(
      locks.request("source", () => {
        ran = true;
      }),
    ).rejects.toThrow("Web Lock timed out: source");
    expect(await locks.request("source", { ifAvailable: true }, (lock) => lock)).toBeNull();
    expect(ran).toBe(false);
  } finally {
    gate.resolve();
    expect(await heldResult).toBeUndefined();
  }
  await locks.request("source", () => undefined);
  expect(ran).toBe(false);
});

it("Web Locks reject callback errors asynchronously when an unavailable lock is refused", async () => {
  const locks = exclusiveLocks();
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const held = locks.request("source", async () => {
    started.resolve();
    await gate.promise;
  });
  try {
    await started.promise;
    await expect(
      locks.request("source", { ifAvailable: true }, (lock) => {
        expect(lock).toBeNull();
        throw new Error("refused callback");
      }),
    ).rejects.toThrow("refused callback");
  } finally {
    gate.resolve();
    await held;
  }
});
