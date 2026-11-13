// AUTHORED-BY Codex GPT-6.1-Sol
/** Validate TTLs before touching storage; omission writes a permanent record. */
export function expiry(ttlSeconds?: number): number | undefined {
  if (ttlSeconds === undefined) return undefined;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0)
    throw new Error("Vault TTL must be a positive integer in seconds");
  return Date.now() + ttlSeconds * 1000;
}
