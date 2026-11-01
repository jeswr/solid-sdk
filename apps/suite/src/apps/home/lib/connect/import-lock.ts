// AUTHORED-BY Codex GPT-6
const pending = new Map<string, Promise<void>>();

/** Reserve the whole checkpoint → import → persistence transaction. Browsers
 * without Web Locks still serialize callers within this tab. */
export async function withConnectorLock<T>(
  storage: string,
  id: string,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const name = `suite-connector:${storage}:${id}`;
  const run = () => {
    signal.throwIfAborted();
    return work();
  };
  if (navigator.locks) return navigator.locks.request(name, { signal }, run);
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
