// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
export interface AccountIdSet {
  load(): Set<string>;
  save(ids: ReadonlySet<string>): void;
}

/** Bounded, identity-checked account preferences; newest IDs win across separate controllers. */
export function createAccountIdSet(
  key: string,
  accountId: string,
  max: number,
  storage?: Pick<Storage, "getItem" | "setItem">,
): AccountIdSet {
  // slice(-0) keeps everything: only a positive bound caps storage.
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("Invalid account ID set bound");
  const load = (): Set<string> => {
    if (!accountId) return new Set();
    try {
      const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(key) ?? "null");
      if (
        saved?.version === 1 &&
        saved.accountId === accountId &&
        Array.isArray(saved.ids) &&
        saved.ids.every((id: unknown) => typeof id === "string")
      )
        return new Set(saved.ids.slice(-max));
    } catch {
      // Unavailable storage and invalid preferences are cache misses.
    }
    return new Set();
  };
  return {
    load,
    save(ids) {
      if (!accountId || !ids.size) return;
      try {
        const saved = [...load()].filter((id) => !ids.has(id));
        const merged = [...saved, ...ids].slice(-max);
        (storage ?? globalThis.localStorage).setItem(
          key,
          JSON.stringify({ version: 1, accountId, ids: merged }),
        );
      } catch {
        // Callers retain intent in memory when storage is denied.
      }
    },
  };
}
