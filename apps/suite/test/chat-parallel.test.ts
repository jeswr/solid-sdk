// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { createConcurrentMapper } from "../src/lib/parallel";

it("shares one limit across maps and preserves input order", async () => {
  const map = createConcurrentMapper(2);
  let active = 0;
  let peak = 0;
  const work = async (value: number) => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return value * 2;
  };
  expect(await Promise.all([map([1, 2, 3], work), map([4, 5, 6], work)])).toEqual([
    [2, 4, 6],
    [8, 10, 12],
  ]);
  expect(peak).toBe(2);
  expect(await map([], work)).toEqual([]);
});

it("stops failed maps' queued work, drains active jobs, and remains usable", async () => {
  const map = createConcurrentMapper(2);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failure = new Error("fatal");
  const work = vi.fn(async (value: number) => {
    if (value === 0) throw failure;
    await held;
    return value;
  });
  const pending = map([0, 1, 2, 3, 4], work);
  const rejected = expect(pending).rejects.toBe(failure);
  await Promise.resolve();
  expect(work.mock.calls.map(([value]) => value)).toEqual([0, 1]);
  release();
  await rejected;
  expect(work).toHaveBeenCalledTimes(2);
  expect(await map([9], async (n) => n)).toEqual([9]);
  expect(() => createConcurrentMapper(0)).toThrow(RangeError);
  expect(() => createConcurrentMapper(1.5)).toThrow(RangeError);
});

it("starts queued priority jobs before queued normal jobs, without preempting running ones", async () => {
  const map = createConcurrentMapper(1);
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = async (value: string) => {
    order.push(value);
    if (value === "a1") await held;
    return value;
  };
  const normal = map(["a1", "a2", "a3"], work);
  await Promise.resolve();
  const urgent = map(["b1", "b2"], work, { priority: true });
  const later = map(["c1"], work);
  await Promise.resolve();
  expect(order).toEqual(["a1"]);
  release();
  expect(await Promise.all([normal, urgent, later])).toEqual([
    ["a1", "a2", "a3"],
    ["b1", "b2"],
    ["c1"],
  ]);
  expect(order).toEqual(["a1", "b1", "b2", "a2", "a3", "c1"]);
});
