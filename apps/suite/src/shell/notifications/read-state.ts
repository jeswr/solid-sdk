// AUTHORED-BY Codex GPT-6.1-Sol
export interface NotificationReadState {
  load(): Set<string>;
  save(ids: ReadonlySet<string>): void;
}

/** Read receipts are account preferences, separate from the source's notification content. */
export function createNotificationReadState(
  accountId: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
): NotificationReadState {
  const key = `suite:notification-reads:${accountId}`;
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
        return new Set(saved.ids);
    } catch {
      // Unavailable storage and invalid receipts must not block notification delivery.
    }
    return new Set();
  };
  return {
    load,
    save(ids) {
      if (!accountId || !ids.size) return;
      try {
        // Merge saved receipts so a recreated controller cannot discard earlier reads.
        const merged = new Set([...load(), ...ids]);
        (storage ?? globalThis.localStorage).setItem(
          key,
          JSON.stringify({ version: 1, accountId, ids: [...merged] }),
        );
      } catch {
        // The controller still retains read intent in memory when browser storage is denied.
      }
    },
  };
}
