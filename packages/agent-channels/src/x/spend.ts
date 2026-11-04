// AUTHORED-BY Codex GPT-6.1-Sol
export interface XSpendOptions {
  /** Nonnegative budget in integer accounting units (e.g. microdollars). */
  readonly cap: number;
  /** Positive worst-case charge for one page request in those same units. */
  readonly costPerCall: number;
  /** Fixed UTC accounting periods, in milliseconds since the Unix epoch. */
  readonly periodMs: number;
  readonly now?: () => number;
}
export interface XSpendCounter {
  /** Synchronously reserve before any credentials or I/O; failures are not refunded. */
  reserve(): void;
  snapshot(): { readonly periodStart: number; readonly spent: number };
}
/** Share one counter across readers using the same budget. It has no manual reset. */
export function createXSpendCounter(options: XSpendOptions): XSpendCounter {
  const { cap, costPerCall, periodMs } = options;
  const now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(cap) ||
    cap < 0 ||
    !Number.isSafeInteger(costPerCall) ||
    costPerCall <= 0 ||
    !Number.isSafeInteger(periodMs) ||
    periodMs <= 0
  )
    throw new RangeError("invalid X spend configuration");
  let periodStart = -1;
  let spent = 0;
  function advance() {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) throw new RangeError("invalid X spend clock");
    const start = Math.floor(time / periodMs) * periodMs;
    // A backward clock never replenishes a budget already used in a later period.
    if (start > periodStart) {
      periodStart = start;
      spent = 0;
    }
  }
  return Object.freeze({
    reserve() {
      advance();
      if (costPerCall > cap - spent) throw new RangeError("X spend cap exceeded");
      spent += costPerCall;
    },
    snapshot() {
      advance();
      return Object.freeze({ periodStart, spent });
    },
  });
}
