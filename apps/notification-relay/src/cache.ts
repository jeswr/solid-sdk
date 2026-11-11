// AUTHORED-BY Codex GPT-6

/** Bounded ten-minute cache for public discovery data; failed loads are never cached. */
export function createDiscoveryCache<T>(now: () => number) {
  const entries = new Map<string, { value: T; expires: number }>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = entries.get(key);
    if (cached && cached.expires > now()) return cached.value;
    const value = await load();
    if (entries.size >= 1000) entries.delete(entries.keys().next().value as string);
    entries.set(key, { value, expires: now() + 600_000 });
    return value;
  };
}
