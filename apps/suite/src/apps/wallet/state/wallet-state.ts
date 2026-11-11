// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { WalletItemData, WalletRecord, WalletRepository } from "@jeswr/solid-wallet";
export interface WalletSnapshot {
  phase: "loading" | "ready" | "error";
  items: WalletRecord[];
  busy: readonly string[];
  error?: unknown;
  skippedRecords?: number;
  undo?: { item: WalletRecord; token: number } | undefined;
}
/** Deletes say whether they settled after this account's view ended (e.g. an account switch). */
export interface WalletDeleteFailure {
  action: "delete";
  item: WalletRecord;
  sessionEnded: boolean;
}
/** One state object per mounted account. An item has at most one outstanding mutation. */
export function createWalletState(
  repository: WalletRepository,
  onFailure: (error: unknown, failure?: WalletDeleteFailure) => void,
) {
  let snapshot: WalletSnapshot = { phase: "loading", items: [], busy: [] };
  let active = true;
  let readVersion = 0;
  let undoToken = 0;
  const listeners = new Set<() => void>();
  const deletionTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
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
      let skippedRecords = 0;
      const items = await repository.list(() => {
        ++skippedRecords;
      });
      if (active && version === readVersion && snapshot.busy.length === 0)
        publish({ ...snapshot, phase: "ready", items, skippedRecords, error: undefined });
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
      const credential = credentialSource
        ? await repository.storeCredential(credentialSource)
        : data.credential;
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
      onFailure(error);
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
    const commitDelete = () => {
      if (!deletionTimers.delete(timer)) return;
      clearTimeout(timer);
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
          onFailure(error, { action: "delete", item, sessionEnded: !active });
        },
      );
    };
    const timer = setTimeout(commitDelete, 8000);
    deletionTimers.set(timer, commitDelete);
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
    for (const commitDelete of deletionTimers.values()) commitDelete();
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
