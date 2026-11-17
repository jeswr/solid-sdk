// AUTHORED-BY Codex GPT-6.1-Sol

export interface DiscoveryCacheOptions {
  maxEntries?: number;
  timeoutMs?: number;
}

/** Internal bounded cache. A deadline spans loading and body consumption, even if abort is ignored. */
export function createDiscoveryCache<T>(now: () => number, options: DiscoveryCacheOptions = {}) {
  const limit = options.maxEntries ?? 1000;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid discovery cache limits");
  const entries = new Map<string, { value: T; expires: number }>();
  const inFlight = new Map<string, Promise<T>>();
  const peek = (key: string): T | undefined => {
    const entry = entries.get(key);
    if (entry && entry.expires > now()) return entry.value;
    entries.delete(key);
    return undefined;
  };
  const get = async (
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    refresh = false,
  ): Promise<T> => {
    const cached = peek(key);
    if (!refresh && cached !== undefined) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
    if (inFlight.size >= limit) throw new Error("Discovery load capacity exceeded");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Discovery load timed out"));
        controller.abort();
      }, timeoutMs);
    });
    const loading = Promise.race([Promise.resolve().then(() => load(controller.signal)), deadline])
      .then((value) => {
        // Remove expired entries before evicting the oldest cached value.
        for (const [name, entry] of entries) if (entry.expires <= now()) entries.delete(name);
        entries.delete(key);
        if (entries.size >= limit) entries.delete(entries.keys().next().value as string);
        entries.set(key, { value, expires: now() + 600_000 });
        return value;
      })
      .finally(() => {
        clearTimeout(timer);
        inFlight.delete(key);
      });
    inFlight.set(key, loading);
    return loading;
  };
  return Object.assign(get, { peek, pending: (key: string) => inFlight.has(key) });
}
