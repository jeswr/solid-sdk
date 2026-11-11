// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { WalletItemData, WalletRecord, WalletRepository } from "@jeswr/solid-wallet";
export interface WalletSnapshot {
  phase: "loading" | "ready" | "error";
  items: WalletRecord[];
  busy: readonly string[];
  error?: unknown;
  undo?: { item: WalletRecord; token: number } | undefined;
}
/** One state object per mounted account. An item has at most one outstanding mutation. */
export function createWalletState(
  repository: WalletRepository,
  onFailure: (error: unknown) => void,
) {
  let snapshot: WalletSnapshot = { phase: "loading", items: [], busy: [] };
  let active = true;
  let readVersion = 0;
  let undoToken = 0;
  const listeners = new Set<() => void>();
  const deletionTimers = new Set<ReturnType<typeof setTimeout>>();
  const publish = (next: WalletSnapshot) => {
    if (active) {
      snapshot = next;
      for (const listener of listeners) listener();
    }
  };
  function available(url: string) {
    if (!active) throw new Error("This Wallet session has ended");
    if (snapshot.busy.includes(url)) throw new Error("This item is still saving");
  }
  async function refresh() {
    if (!active || snapshot.busy.length) return;
    const version = ++readVersion;
    try {
      const items = await repository.list();
      if (active && version === readVersion && snapshot.busy.length === 0)
        publish({ ...snapshot, phase: "ready", items, error: undefined });
    } catch (error) {
      if (active && version === readVersion)
        publish({ phase: "error", items: [], busy: [], error });
    }
  }
  async function save(
    data: WalletItemData,
    existing?: WalletRecord,
    file?: Blob,
    credentialSource?: string,
  ) {
    const url = existing?.url ?? `pending:${crypto.randomUUID()}`;
    available(url);
    ++readVersion;
    const optimistic = { ...data, url, etag: existing?.etag ?? null };
    publish({
      ...snapshot,
      items: [...snapshot.items.filter((item) => item.url !== url), optimistic],
      busy: [...snapshot.busy, url],
    });
    try {
      const fileUrl = file ? await repository.upload(file) : data.file;
      if (!active) throw new Error("This Wallet session has ended");
      const credential = credentialSource
        ? await repository.storeCredential(credentialSource)
        : data.credential;
      if (!active) throw new Error("This Wallet session has ended");
      const saved = await repository.save({ ...data, file: fileUrl, credential }, existing);
      publish({
        ...snapshot,
        items: snapshot.items.map((item) => (item.url === url ? saved : item)),
        busy: snapshot.busy.filter((id) => id !== url),
      });
      return saved;
    } catch (error) {
      publish({
        ...snapshot,
        items: [
          ...snapshot.items.filter((item) => item.url !== url),
          ...(existing ? [existing] : []),
        ],
        busy: snapshot.busy.filter((id) => id !== url),
      });
      if (active) onFailure(error);
      throw error;
    }
  }
  function remove(item: WalletRecord) {
    available(item.url);
    ++readVersion;
    const token = ++undoToken;
    publish({
      ...snapshot,
      items: snapshot.items.filter((record) => record.url !== item.url),
      busy: [...snapshot.busy, item.url],
      undo: { item, token },
    });
    const timer = setTimeout(() => {
      deletionTimers.delete(timer);
      if (!active) return;
      if (snapshot.undo?.token === token) publish({ ...snapshot, undo: undefined });
      void repository.remove(item).then(
        () => {
          publish({ ...snapshot, busy: snapshot.busy.filter((id) => id !== item.url) });
        },
        (error) => {
          publish({
            ...snapshot,
            items: [...snapshot.items, item],
            busy: snapshot.busy.filter((id) => id !== item.url),
          });
          if (active) onFailure(error);
        },
      );
    }, 8000);
    deletionTimers.add(timer);
    return () => {
      if (!deletionTimers.has(timer) || !active) return;
      clearTimeout(timer);
      deletionTimers.delete(timer);
      publish({
        ...snapshot,
        items: [...snapshot.items, item],
        busy: snapshot.busy.filter((id) => id !== item.url),
        undo: snapshot.undo?.token === token ? undefined : snapshot.undo,
      });
    };
  }
  function dispose() {
    active = false;
    ++readVersion;
    for (const timer of deletionTimers) clearTimeout(timer);
    deletionTimers.clear();
    listeners.clear();
  }
  return {
    repository,
    refresh,
    save,
    remove,
    dispose,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type WalletState = ReturnType<typeof createWalletState>;
