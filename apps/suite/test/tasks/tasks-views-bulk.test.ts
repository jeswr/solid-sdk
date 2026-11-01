// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { bulkSummary, runBulk } from "../../src/apps/tasks/lib/views/bulk";

describe("bulk writes", () => {
  it.each([
    4, 10,
  ])("never exceeds four in flight (requested: %s), and preserves input order", async (concurrency) => {
    let active = 0;
    let peak = 0;
    const pending = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();
    const operation = runBulk(
      [0, 1, 2, 3, 4, 5],
      async (item) => {
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise<void>((resolve, reject) => pending.set(item, { resolve, reject }));
        } finally {
          active--;
        }
      },
      { concurrency },
    );
    expect(pending.size).toBe(4);
    const error3 = new Error("three failed");
    pending.get(3)?.reject(error3);
    await vi.waitFor(() => expect(pending.has(4)).toBe(true));
    pending.get(2)?.resolve();
    await vi.waitFor(() => expect(pending.has(5)).toBe(true));
    pending.get(5)?.resolve();
    pending.get(4)?.resolve();
    pending.get(1)?.reject(undefined);
    pending.get(0)?.resolve();
    expect(await operation).toEqual({
      done: [0, 2, 4, 5],
      failed: [
        { item: 1, error: undefined },
        { item: 3, error: error3 },
      ],
    });
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });

  it("handles defaults, sync throws, undefined items and empty input", async () => {
    const error = new Error("sync failure");
    expect(await runBulk([undefined, undefined], () => undefined)).toEqual({
      done: [undefined, undefined],
      failed: [],
    });
    expect(
      await runBulk([1, 1], () => {
        throw error;
      }),
    ).toEqual({
      done: [],
      failed: [
        { item: 1, error },
        { item: 1, error },
      ],
    });
    const fn = vi.fn();
    expect(await runBulk([], fn, {})).toEqual({ done: [], failed: [] });
    expect(fn).not.toHaveBeenCalled();
    for (const concurrency of [0, -1, 1.5, Number.NaN])
      await expect(runBulk([1], fn, { concurrency })).rejects.toThrow(TypeError);
  });

  it("honours a lower concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const visited: number[] = [];
    const result = await runBulk(
      [1, 2, 3],
      async (item) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        visited.push(item);
        active--;
      },
      { concurrency: 1 },
    );
    expect(peak).toBe(1);
    expect(visited).toEqual([1, 2, 3]);
    expect(result.done).toEqual([1, 2, 3]);
  });

  it("produces summary copy with successes and partial failures", () => {
    expect(bulkSummary("Rescheduled", 3, 0)).toBe("Rescheduled 3 tasks");
    expect(bulkSummary("Completed", 2, 1)).toBe("Completed 2 tasks · 1 failed");
    expect(bulkSummary("Moved", 1, 0)).toBe("Moved 1 task");
    expect(bulkSummary("Deleted", 0, 2)).toBe("Deleted 0 tasks · 2 failed");
  });
});
