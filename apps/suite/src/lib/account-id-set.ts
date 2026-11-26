// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
export interface AccountIdSet {
  load(): Set<string>;
  /** `keep` IDs are evicted last: trimming drops the oldest IDs outside it first. */
  save(ids: ReadonlySet<string>, keep?: ReadonlySet<string>): void;
  /** Forget IDs, e.g. a notification read receipt undone from the tray. */
  remove?(ids: ReadonlySet<string>): void;
}

/** The newest `max` IDs, except that IDs in `keep` outlast the others (oldest others go first). */
export function trimIds(ids: readonly string[], max: number, keep?: ReadonlySet<string>): string[] {
  let excess = ids.length - max;
  if (excess <= 0) return [...ids];
  if (!keep?.size) return ids.slice(-max);
  const kept = ids.filter((id) => {
    if (excess > 0 && !keep.has(id)) {
      excess--;
      return false;
    }
    return true;
  });
  // Still over the bound: only kept IDs remain, so the oldest of those go.
  return kept.slice(-max);
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
    remove(ids) {
      if (!accountId) return;
      try {
        const kept = [...load()].filter((id) => !ids.has(id));
        (storage ?? globalThis.localStorage).setItem(
          key,
          JSON.stringify({ version: 1, accountId, ids: kept }),
        );
      } catch {
        // Callers retain the restored state in memory when storage is denied.
      }
    },
    save(ids, keep) {
      if (!accountId || !ids.size) return;
      try {
        const saved = [...load()].filter((id) => !ids.has(id));
        const merged = trimIds([...saved, ...ids], max, keep);
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
