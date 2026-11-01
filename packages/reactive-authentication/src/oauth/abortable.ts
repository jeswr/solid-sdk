/**
 * Settles with `promise`, or rejects as soon as `signal` aborts; the promise keeps running for other waiters.
 * A rejection handler is attached before anything can throw, so a promise abandoned on abort never surfaces
 * as an unhandled rejection. Callers must still re-check the signal after awaiting: the promise may win the
 * race and an abort happen before the continuation runs.
 */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => undefined);
  signal.throwIfAborted();
  const { promise: aborted, reject } = Promise.withResolvers<never>();
  const onAbort = () => reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
