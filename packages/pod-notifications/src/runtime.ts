// AUTHORED-BY Codex GPT-6.1-Sol
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
