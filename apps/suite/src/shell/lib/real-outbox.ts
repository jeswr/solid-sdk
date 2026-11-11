// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";
import type { Outbox as DurableOutbox } from "@jeswr/suite-sdk/offline";
import type { Outbox, OutboxSnapshot } from "./outbox";

function resourceName(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.split("/").filter(Boolean).pop() ?? parsed.host;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
const containerPath = (url: string, container?: string) =>
  container ? new URL(container).pathname : new URL(".", url).pathname;

/** Presentation only: all bytes, durability, retries and conflict writes belong to the SDK. */
export function createRealOutbox({
  outbox,
  storage,
  signal,
  now = () => new Date(),
}: {
  outbox: DurableOutbox;
  storage: () => StorageClient | null;
  signal: AbortSignal;
  now?: () => Date;
}): Outbox & { dispose(): void } {
  const listeners = new Set<() => void>();
  let snapshot: OutboxSnapshot = { pending: [], conflicts: [] };
  let previous = new Set<string>();
  const refresh = () => {
    const items = outbox.pending();
    const ids = new Set(items.map((item) => item.id));
    const synced = [...previous].some((id) => !ids.has(id));
    previous = ids;
    snapshot = {
      ...snapshot,
      ...(synced ? { lastSyncedAt: now() } : {}),
      pending: items
        .filter((item) => item.status !== "conflict")
        .map((item) => ({
          id: item.id,
          label: item.label ?? resourceName(item.url),
          where: containerPath(item.url, item.container),
          queuedAt: new Date(item.createdAt),
          state: item.status === "failed" ? "failed" : "pending",
          ...(item.error ? { error: item.error } : {}),
        })),
      conflicts: outbox.conflicts().map((conflict) => {
        const item = items.find((item) => item.id === conflict.itemId);
        return {
          id: conflict.id,
          name: item?.label ?? resourceName(conflict.url),
          where: containerPath(conflict.url, item?.container),
          summary: "Your saved change and the version in your storage differ.",
          changedAt: item ? new Date(item.createdAt) : now(),
        };
      }),
    };
    for (const listener of listeners) listener();
  };
  const stopChange = outbox.on("change", refresh);
  const stopConflict = outbox.on("conflict", refresh);
  refresh();
  // The real implementation emits change on hydration; also support already-ready stores.
  void outbox.ready
    .then(() => {
      if (!signal.aborted) refresh();
    })
    .catch(() => {});
  const client = () => {
    signal.throwIfAborted();
    const client = storage();
    if (!client) throw new Error("Your storage is still opening. Please try again.");
    return client;
  };
  const replay = () => outbox.replay(client(), { signal });
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enqueue() {
      throw new Error("Queue document contents through withOutbox, rather than a description.");
    },
    async retry(id) {
      client();
      await outbox.retry(id);
    },
    async retryAll() {
      client();
      await outbox.retry();
    },
    async resolve(id, choice) {
      client();
      await outbox.resolve(id, choice);
      await replay();
    },
    async reconnected() {
      if (!signal.aborted && storage()) await replay();
    },
    reload: refresh,
    dispose() {
      stopChange();
      stopConflict();
      listeners.clear();
    },
  };
}

/** Fence the shell's existing authenticated fetch to one committed account session. */
export function outboxTransport(
  fetch: typeof globalThis.fetch,
  active: () => boolean,
  signal: AbortSignal,
): typeof globalThis.fetch {
  return async (input, init) => {
    const check = () => {
      signal.throwIfAborted();
      if (!active()) throw new Error("The outbox account is no longer active");
    };
    check();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const response = await fetch(input, {
      ...init,
      signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,
    });
    check();
    return response;
  };
}
