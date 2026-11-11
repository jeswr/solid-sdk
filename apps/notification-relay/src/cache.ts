// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

/** Bounded ten-minute cache with per-key in-flight deduplication; failed loads are never cached. */
export function createDiscoveryCache<T>(now: () => number) {
  const entries = new Map<string, { value: T; expires: number }>();
  const inFlight = new Map<string, Promise<T>>();
  /** `refresh` bypasses a cached value (the caller throttles it), but joins an in-flight load. */
  return async (key: string, load: () => Promise<T>, refresh = false): Promise<T> => {
    const cached = entries.get(key);
    if (!refresh && cached && cached.expires > now()) return cached.value;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const loading = Promise.resolve()
      .then(load)
      .then((value) => {
        entries.delete(key);
        if (entries.size >= 1000) entries.delete(entries.keys().next().value as string);
        entries.set(key, { value, expires: now() + 600_000 });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, loading);
    return loading;
  };
}
