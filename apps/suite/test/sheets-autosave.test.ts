// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, type SaveStatus } from "../src/apps/sheets/lib/autosave";

function deferred() {
  let resolve = () => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(online = true, delay?: number) {
  const save = vi
    .fn<(value: number, force: boolean) => Promise<void>>()
    .mockResolvedValue(undefined);
  const statuses: SaveStatus[] = [];
  const queue = createAutosave({
    save,
    online,
    onStatus: (status) => statuses.push(status),
    isConflict: (error) => error === "conflict",
    ...(delay === undefined ? {} : { delay }),
  });
  return { queue, save, statuses };
}

describe("spreadsheet autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces for one second, resetting the deadline and saving only the latest edit", async () => {
    const { queue, save } = setup();
    expect(queue.status).toBe("saved");
    queue.schedule(() => 1);
    expect(queue.status).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    queue.schedule(() => 2);
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(2, false);
    expect(queue.status).toBe("saved");
  });

  it("accepts a configured debounce and reports saving until the write resolves", async () => {
    const { queue, save, statuses } = setup(true, 10);
    const write = deferred();
    save.mockReturnValueOnce(write.promise);
    queue.schedule(() => 4);
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.status).toBe("saving");
    write.resolve();
    await queue.flush();
    expect(statuses).toEqual(["unsaved", "saving", "saved"]);
  });

  it("single-flights concurrent flushes and queues just the latest snapshot", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const a = queue.flush();
    await Promise.resolve();
    queue.schedule(() => 2);
    queue.schedule(() => 3);
    const b = queue.flush();
    const c = queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all([a, b, c]);
    expect(save.mock.calls).toEqual([
      [1, false],
      [3, false],
    ]);
    expect(queue.status).toBe("saved");
  });

  it("retains the second edit's debounce when the first write finishes early", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const flushing = queue.flush();
    await Promise.resolve();
    queue.schedule(() => 2);
    first.resolve();
    await flushing;
    expect(queue.status).toBe("unsaved");
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save.mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("captures a queued getter synchronously before an engine is disposed", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const a = queue.flush();
    let alive = true;
    queue.schedule(() => {
      if (!alive) throw new Error("disposed");
      return 2;
    });
    const b = queue.flush();
    alive = false;
    first.resolve();
    await Promise.all([a, b]);
    expect(save.mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("holds offline edits, ignores offline flushes, and saves the latest on reconnection", async () => {
    const { queue, save } = setup(false);
    queue.schedule(() => 1);
    queue.schedule(() => 2);
    await queue.flush();
    await vi.runAllTimersAsync();
    expect(queue.status).toBe("offline");
    expect(save).not.toHaveBeenCalled();
    queue.setOnline(true);
    await queue.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(2, false);
  });

  it("cancels the debounce on disconnect, including when there are no edits", async () => {
    const { queue, save } = setup();
    queue.setOnline(false);
    expect(queue.status).toBe("offline");
    queue.setOnline(true);
    expect(queue.status).toBe("saved");
    queue.schedule(() => 5);
    queue.setOnline(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    queue.setOnline(true);
    await queue.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(5, false);
  });

  it("stays offline after an in-flight save succeeds and holds later edits", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const flushing = queue.flush();
    queue.schedule(() => 2);
    queue.setOnline(false);
    first.resolve();
    await flushing;
    expect(queue.status).toBe("offline");
    queue.setOnline(true);
    await queue.flush();
    expect(save.mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("reports saving when the browser reconnects during an active write", async () => {
    const { queue, save } = setup();
    const write = deferred();
    save.mockReturnValueOnce(write.promise);
    queue.schedule(() => 1);
    const flushing = queue.flush();
    queue.setOnline(false);
    queue.setOnline(true);
    expect(queue.status).toBe("saving");
    write.resolve();
    await flushing;
    expect(queue.status).toBe("saved");
  });

  it("stops the queue on conflict and never overwrites automatically on online", async () => {
    const { queue, save } = setup();
    save.mockRejectedValueOnce("conflict");
    queue.schedule(() => 1);
    await queue.flush();
    expect(queue.status).toBe("conflict");
    queue.schedule(() => 2);
    expect(queue.status).toBe("conflict");
    queue.setOnline(false);
    queue.setOnline(true);
    await queue.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queue.status).toBe("conflict");
    expect(save).toHaveBeenCalledTimes(1);
    await queue.retry(true);
    expect(save.mock.calls).toEqual([
      [1, false],
      [2, true],
    ]);
    queue.schedule(() => 3);
    await queue.flush();
    expect(save).toHaveBeenLastCalledWith(3, false);
  });

  it("retains a newer edit when an older write fails, and retries it", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const flushing = queue.flush();
    queue.schedule(() => 2);
    first.reject(new Error("network"));
    await flushing;
    expect(queue.status).toBe("error");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    queue.schedule(() => 3);
    expect(queue.status).toBe("error");
    await queue.retry();
    expect(save.mock.calls).toEqual([
      [1, false],
      [3, false],
    ]);
  });

  it("holds a failed write offline and retries on online", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 8);
    const flushing = queue.flush();
    queue.setOnline(false);
    first.reject("network");
    await flushing;
    expect(queue.status).toBe("offline");
    queue.setOnline(true);
    await queue.flush();
    expect(save.mock.calls).toEqual([
      [8, false],
      [8, false],
    ]);
  });

  it("also retries a transient error on an online event without an offline event", async () => {
    const { queue, save } = setup();
    save.mockRejectedValueOnce("failure");
    queue.schedule(() => 9);
    await queue.flush();
    queue.setOnline(true);
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(queue.status).toBe("saved");
  });

  it("turns snapshot exceptions into a retriable error without writing", async () => {
    const { queue, save } = setup();
    let broken = true;
    queue.schedule(() => {
      if (broken) throw new Error("snapshot");
      return 10;
    });
    await queue.flush();
    expect(queue.status).toBe("error");
    expect(save).not.toHaveBeenCalled();
    broken = false;
    await queue.retry();
    expect(save).toHaveBeenCalledExactlyOnceWith(10, false);
  });

  it("reports snapshot errors while offline and can discard them", async () => {
    const { queue, save } = setup(false);
    queue.schedule(() => {
      throw "conflict";
    });
    await queue.flush();
    expect(queue.status).toBe("offline");
    queue.reset();
    expect(queue.status).toBe("offline");
    queue.setOnline(true);
    expect(queue.status).toBe("saved");
    await queue.retry();
    expect(save).not.toHaveBeenCalled();
  });

  it("reset discards blocked edits and timers after choosing another version", async () => {
    const { queue, save } = setup();
    save.mockRejectedValueOnce("conflict");
    queue.schedule(() => 1);
    await queue.flush();
    queue.reset();
    expect(queue.status).toBe("saved");
    queue.schedule(() => 2);
    queue.reset();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    await queue.flush();
  });

  it("settles an active successful save while offline with no pending edits", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const flushing = queue.flush();
    queue.setOnline(false);
    first.resolve();
    await flushing;
    expect(queue.status).toBe("offline");
    queue.setOnline(true);
    expect(queue.status).toBe("saved");
  });

  it("keeps a snapshot failure visible when an earlier write succeeds", async () => {
    const { queue, save } = setup();
    const first = deferred();
    save.mockReturnValueOnce(first.promise);
    queue.schedule(() => 1);
    const flushing = queue.flush();
    queue.schedule(() => {
      throw new Error("snapshot");
    });
    await queue.flush();
    first.resolve();
    await flushing;
    expect(queue.status).toBe("error");
    queue.schedule(() => 2);
    await queue.retry();
    expect(save.mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("does not force an unrelated edit after an empty retry", async () => {
    const { queue, save } = setup();
    await queue.retry(true);
    queue.schedule(() => 1);
    await queue.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(1, false);
  });
});
