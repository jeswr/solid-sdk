// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Timers } from "./types.js";

/** Platform adapter shared by polling and future push channels. */
export const systemTimers: Timers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Browser globals are optional on Node and are read at use time. */
export const platform = globalThis as unknown as {
  navigator?: { onLine?: boolean };
  addEventListener?: (type: string, handler: () => void) => void;
  removeEventListener?: (type: string, handler: () => void) => void;
};

/** Missing navigator/onLine means online. */
export function isOnline(): boolean {
  return platform.navigator?.onLine !== false;
}

/** Run every synchronous teardown step, then surface the first failure. */
export function runCleanups(cleanups: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}
