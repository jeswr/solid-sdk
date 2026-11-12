// AUTHORED-BY Codex GPT-6.1-Sol
/** Abortable timer; no listeners or live timers survive cancellation. */
export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
/** Runs sequentially; transient failures delay retries, successes restore the chosen interval. */
export async function watchImports(options: {
  run: () => Promise<void>;
  minutes: number;
  signal?: AbortSignal;
  onError: () => void;
  retry: (error: unknown) => boolean;
  sleep?: typeof delay;
  random?: () => number;
}): Promise<void> {
  if (!Number.isFinite(options.minutes) || options.minutes < 5 || options.minutes > 1440)
    throw new RangeError("Watch minutes must be between 5 and 1440.");
  let failures = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      await options.run();
      failures = 0;
    } catch (error) {
      if (options.signal?.aborted || !options.retry(error)) throw error;
      failures = Math.min(failures + 1, 8);
      options.onError();
    }
    const minutes = failures
      ? Math.min(60, options.minutes * 2 ** (failures - 1)) *
        (0.75 + (options.random ?? Math.random)() * 0.5)
      : options.minutes;
    await (options.sleep ?? delay)(Math.max(5, minutes) * 60000, options.signal);
  }
}
