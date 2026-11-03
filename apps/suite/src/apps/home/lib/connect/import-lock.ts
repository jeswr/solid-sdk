// AUTHORED-BY Codex GPT-6
const pending = new Map<string, Promise<void>>();

const busy = Symbol("busy");

/** Reserve the whole checkpoint → import → persistence transaction. Browsers
 * without Web Locks still serialize callers within this tab. onWait runs once, before
 * waiting, when another sync of this connector holds the reservation. */
export async function withConnectorLock<T>(
  storage: string,
  id: string,
  signal: AbortSignal,
  work: () => Promise<T>,
  onWait?: () => void,
): Promise<T> {
  signal.throwIfAborted();
  const name = `suite-connector:${storage}:${id}`;
  const run = () => {
    signal.throwIfAborted();
    return work();
  };
  if (navigator.locks) {
    if (onWait) {
      // ifAvailable cannot be combined with a signal; it never waits, so none is needed.
      const now = await navigator.locks.request(name, { ifAvailable: true }, (lock) =>
        lock ? run() : busy,
      );
      if (now !== busy) return now as T;
      onWait();
    }
    return navigator.locks.request(name, { signal }, run);
  }
  if (pending.has(name)) onWait?.();
  const next = (pending.get(name) ?? Promise.resolve()).then(run);
  // Failures release the queue without poisoning the next import.
  const settled = next.then(
    () => {},
    () => {},
  );
  pending.set(name, settled);
  try {
    return await next;
  } finally {
    if (pending.get(name) === settled) pending.delete(name);
  }
}
