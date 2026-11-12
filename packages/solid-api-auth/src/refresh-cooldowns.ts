// AUTHORED-BY Codex GPT-6.1-Sol

/** Bounded refresh timestamps. Eviction never makes a live cooldown available again. */
export function createRefreshCooldowns(now: () => number, limit: number) {
  const entries = new Map<string, number>();
  // A single conservative deadline protects evicted entries without retaining their URLs.
  let overflowUntil = -Infinity;
  return (key: string): boolean => {
    const time = now();
    for (const [url, expires] of entries) if (expires <= time) entries.delete(url);
    if (entries.has(key) || time < overflowUntil) return false;
    if (entries.size >= limit) {
      const [oldest, expires] = entries.entries().next().value as [string, number];
      entries.delete(oldest);
      overflowUntil = Math.max(overflowUntil, expires);
    }
    entries.set(key, time + 60_000);
    return true;
  };
}
