// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelayedDeletes } from "../../src/apps/tasks/state/delayed-delete";

afterEach(() => vi.useRealTimers());
describe("delayed delete", () => {
  it("hides immediately, waits eight seconds, and commits exactly once", () => {
    vi.useFakeTimers();
    const queue = new DelayedDeletes();
    const hide = vi.fn();
    const commit = vi.fn();
    expect(queue.schedule("a", hide, commit, vi.fn())).toBe(true);
    expect(queue.schedule("a", hide, commit, vi.fn())).toBe(false);
    expect(hide).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(7999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledOnce();
    queue.finish("a");
    queue.flush();
    expect(commit).toHaveBeenCalledOnce();
    expect(queue.undo("a")).toBe(false);
  });
  it("Undo cancels and restores; dismissal and pagehide flush only pending resources", () => {
    vi.useFakeTimers();
    const queue = new DelayedDeletes();
    const commit = vi.fn();
    const restore = vi.fn();
    queue.schedule("a", vi.fn(), commit, restore);
    expect(queue.undo("a")).toBe(true);
    vi.runAllTimers();
    expect(restore).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    queue.schedule("a", vi.fn(), commit, restore);
    queue.schedule("b", vi.fn(), commit, restore);
    queue.finish("a");
    queue.flush();
    vi.runAllTimers();
    expect(commit).toHaveBeenCalledTimes(2);
  });
});

it("completion visuals finish at 400ms, flush on teardown, and skip waiting for reduced motion", async () => {
  const { completionVisuals } = await import("../../src/apps/tasks/state/completion-visuals");
  const { frameCache } = await import("./tasks-frame-fixtures");
  const { cache } = await frameCache();
  const visuals = completionVisuals(cache);
  expect(completionVisuals(cache)).toBe(visuals);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.useFakeTimers();
  const listener = vi.fn();
  const unsubscribe = visuals.subscribe(listener);
  const settled = vi.fn();
  const waiting = visuals.wait("a").then(settled);
  expect(visuals.getSnapshot().has("a")).toBe(true);
  await vi.advanceTimersByTimeAsync(399);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await waiting;
  expect(settled).toHaveBeenCalledOnce();
  expect(visuals.getSnapshot().size).toBe(0);
  const flushing = visuals.wait("b");
  visuals.flush();
  await flushing;
  expect(visuals.getSnapshot().size).toBe(0);
  expect(listener).toHaveBeenCalledTimes(4);
  unsubscribe();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  await visuals.wait("c");
  expect(visuals.getSnapshot().size).toBe(0);
  vi.unstubAllGlobals();
  await visuals.wait("d");
  expect(visuals.getSnapshot().size).toBe(0);
});
