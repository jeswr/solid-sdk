// AUTHORED-BY Codex GPT-6.1-Sol
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
