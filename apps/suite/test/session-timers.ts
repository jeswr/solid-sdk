import { vi } from "vitest";

/** Capture browser timers without replacing React's or IndexedDB's task scheduling. */
export function captureTimers(win: Pick<Window, "setTimeout" | "clearTimeout"> = window) {
  let sequence = 0;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  vi.spyOn(win, "setTimeout").mockImplementation(((callback: () => void, ms: number) => {
    const id = ++sequence;
    pending.set(id, { callback, ms });
    return id;
  }) as typeof win.setTimeout);
  vi.spyOn(win, "clearTimeout").mockImplementation((id) => {
    if (id !== undefined) pending.delete(id);
  });
  return {
    count: (ms?: number) =>
      [...pending.values()].filter((timer) => ms === undefined || timer.ms === ms).length,
    fire(ms: number) {
      const entry = [...pending].find(([, timer]) => timer.ms === ms);
      if (!entry) throw new Error(`No pending ${ms}ms timer`);
      pending.delete(entry[0]);
      entry[1].callback();
    },
  };
}
