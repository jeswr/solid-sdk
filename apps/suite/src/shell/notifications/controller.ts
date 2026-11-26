// AUTHORED-BY Codex GPT-6.1-Sol
import type { UndoEntry } from "@jeswr/suite-sdk/undo";
import {
  type AccessDecider,
  type AccessDecision,
  dismissNotification,
  markNotificationsRead,
  mergeNotifications,
  type NotificationOverlay,
  type NotificationSource,
  reconcileReadIds,
  type SuiteNotification,
  unreadCount,
} from "../lib/notifications-model";
import type { NotificationReadState } from "./read-state";

export interface NotificationsSnapshot {
  items: SuiteNotification[];
  unread: number;
  loading: boolean;
  coreReady: boolean;
  error: string | null;
}
/** Tray actions stay undoable from anywhere for a few minutes, not for hours. */
export const NOTIFICATION_UNDO_MS = 5 * 60_000;
/** Persisting an undo failed before any local state changed, so the entry can run again. */
export class RetryableUndoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableUndoError";
  }
}
export const isRetryableUndoError = (error: unknown) => error instanceof RetryableUndoError;
/** Account-scoped async boundary: source results and mutations cannot update another account. */
export function createNotificationsController(
  sources: readonly NotificationSource[],
  decider?: AccessDecider,
  onNew: (notification: SuiteNotification) => void = () => {},
  readState?: NotificationReadState,
) {
  let snapshot: NotificationsSnapshot = {
    items: [],
    unread: 0,
    loading: true,
    coreReady: false,
    error: null,
  };
  let coreReady = false;
  let overlay: NotificationOverlay = { read: readState?.load() ?? new Set(), dismissed: new Set() };
  /** Explicit local unread intent, with the source's own flag when it was set. */
  const readOverrides = new Map<string, { value: boolean; base: boolean }>();
  /** Ids whose latest markRead is still in flight, so an undone write cannot report a stale error. */
  const inflight = new Map<string, number>();
  let writes = 0;
  let lifetime = 0;
  const outcomes = new Map<string, string>();
  const results = new Map<string, SuiteNotification[]>();
  const listeners = new Set<() => void>();
  let request: AbortController | undefined;
  let revision = 0;
  let initialized = false;
  const seen = new Set<string>();
  const publish = (loading: boolean, error: string | null) => {
    const items = mergeNotifications([...results.values()], overlay).map((item) => ({
      ...item,
      read: readOverrides.get(item.id)?.value ?? item.read,
      ...(outcomes.has(item.id) ? { outcome: outcomes.get(item.id) ?? "" } : {}),
    }));
    snapshot = { items, unread: unreadCount(items), loading, coreReady, error };
    for (const listener of listeners) listener();
  };
  /** Returns the completed listing's revision, or false when superseded. */
  const refresh = async (): Promise<number | false> => {
    const current = ++revision;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    coreReady = false;
    publish(true, null);
    const responses = await Promise.allSettled(
      sources.map((source) => source.list(controller.signal)),
    );
    if (controller.signal.aborted || current !== revision) return false;
    let failed = false;
    responses.forEach((response, index) => {
      const source = sources[index];
      if (response.status === "fulfilled" && source) results.set(source.id, response.value);
      else if (source?.optional) results.set(source.id, []);
      else failed = true;
    });
    coreReady = !failed;
    // Drop local unread intent once its item is gone or its source's flag changed since.
    const reported = new Map<string, boolean>();
    for (const items of results.values())
      for (const item of items) reported.set(item.id, item.read);
    for (const [id, { base }] of readOverrides)
      if (reported.get(id) !== base) readOverrides.delete(id);
    overlay = { ...overlay, read: reconcileReadIds(overlay.read, [...results.values()]) };
    publish(false, failed ? "Couldn't load all notifications. Try again." : null);
    for (const item of snapshot.items) {
      if (initialized && !seen.has(item.id) && !item.read) onNew(item);
      seen.add(item.id);
    }
    // A failed initial load must not turn the first successful listing into desktop spam.
    if (!failed) initialized = true;
    return current;
  };
  const markRead = async (ids: string[]) => {
    const currentLifetime = lifetime;
    const write = ++writes;
    for (const id of ids) {
      readOverrides.delete(id);
      inflight.set(id, write);
    }
    overlay = markNotificationsRead(overlay, ids);
    // Save before publishing or awaiting a source: opening an item can navigate immediately.
    // Keep these receipts even after a source confirms the in-memory overlay.
    readState?.save(overlay.read);
    publish(snapshot.loading, snapshot.error);
    const responses = await Promise.allSettled(
      sources.map((source) => {
        const owned = ids.filter((id) => results.get(source.id)?.some((item) => item.id === id));
        return owned.length ? source.markRead?.(owned) : undefined;
      }),
    );
    // An undo during the write retires it: its late rejection is not news.
    const current = ids.some((id) => inflight.get(id) === write);
    for (const id of ids) if (inflight.get(id) === write) inflight.delete(id);
    if (
      current &&
      currentLifetime === lifetime &&
      responses.some((response) => response.status === "rejected")
    )
      publish(
        snapshot.loading,
        "Couldn't save the read status. Your read items are kept on this device. Retry to save them.",
      );
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async () => {
      // A superseded refresh must not retry: its write can announce a change, which starts
      // another refresh that supersedes this one again (a microtask loop that hangs the page).
      const current = await refresh();
      if (current === false || current !== revision) return false;
      // Retry pending read writes too, including sources that previously failed.
      if (overlay.read.size) await markRead([...overlay.read]);
      return current === revision && !request?.signal.aborted;
    },
    markRead: (id: string) => markRead([id]),
    markManyRead: (ids: readonly string[]) => markRead([...ids]),
    markAllRead(pushUndo?: (entry: Omit<UndoEntry, "scope">) => void, only?: readonly string[]) {
      const ids = snapshot.items
        .filter((item) => !item.read && (!only || only.includes(item.id)))
        .map((item) => item.id);
      if (!ids.length) return Promise.resolve();
      const previousRead = new Set(overlay.read);
      const currentLifetime = lifetime;
      const operation = markRead(ids);
      const settled = () => {
        if (currentLifetime !== lifetime) throw new Error("Notification session changed");
      };
      pushUndo?.({
        label: `Marked ${ids.length} ${ids.length === 1 ? "notification" : "notifications"} as read`,
        expiresAt: Date.now() + NOTIFICATION_UNDO_MS,
        async undo(signal) {
          signal.throwIfAborted();
          settled();
          const restored = ids.filter((id) => !previousRead.has(id));
          // Persist first: a failure leaves every local flag as it was, so the entry can retry.
          const responses = await Promise.allSettled(
            sources.map((source) => {
              const owned = restored.filter((id) =>
                results.get(source.id)?.some((item) => item.id === id),
              );
              return owned.length ? source.markUnread?.(owned) : undefined;
            }),
          );
          if (responses.some((response) => response.status === "rejected"))
            throw new RetryableUndoError("Couldn't save the unread status");
          signal.throwIfAborted();
          settled();
          // Sources only support markRead. Explicit local unread intent must survive refreshes.
          const reported = new Map<string, boolean>();
          for (const items of results.values())
            for (const item of items) reported.set(item.id, item.read);
          for (const id of ids) {
            inflight.delete(id);
            readOverrides.set(id, { value: false, base: reported.get(id) ?? false });
          }
          overlay = {
            ...overlay,
            read: new Set(
              [...overlay.read].filter((id) => !ids.includes(id) || previousRead.has(id)),
            ),
          };
          readState?.remove?.(new Set(restored));
          publish(snapshot.loading, snapshot.error);
        },
        async redo(signal) {
          signal.throwIfAborted();
          settled();
          await markRead(ids);
        },
      });
      return operation;
    },
    dismiss(id: string): Omit<UndoEntry, "scope"> | undefined {
      if (!snapshot.items.some((item) => item.id === id)) return;
      const currentLifetime = lifetime;
      const wasDismissed = overlay.dismissed.has(id);
      overlay = dismissNotification(overlay, id);
      publish(snapshot.loading, snapshot.error);
      return {
        label: "Notification dismissed",
        expiresAt: Date.now() + NOTIFICATION_UNDO_MS,
        async undo(signal) {
          signal.throwIfAborted();
          if (currentLifetime !== lifetime) throw new Error("Notification session changed");
          const dismissed = new Set(overlay.dismissed);
          if (!wasDismissed) dismissed.delete(id);
          overlay = { ...overlay, dismissed };
          publish(snapshot.loading, snapshot.error);
        },
        async redo(signal) {
          signal.throwIfAborted();
          if (currentLifetime !== lifetime) throw new Error("Notification session changed");
          overlay = dismissNotification(overlay, id);
          publish(snapshot.loading, snapshot.error);
        },
      };
    },
    async decide(id: string, decision: AccessDecision) {
      const item = snapshot.items.find((item) => item.id === id);
      if (!item?.request || !decider)
        throw new Error("Access decisions aren't available for this request.");
      if (decision.approve && !item.request.roles.some((role) => role === decision.role))
        throw new Error("Choose one of the requested roles.");
      await decider.decide(item.request, decision);
      outcomes.set(
        id,
        decision.approve
          ? `Approved for ${decision.role.charAt(0).toUpperCase() + decision.role.slice(1)}`
          : "Denied",
      );
      await markRead([id]);
      publish(snapshot.loading, snapshot.error);
    },
    stop() {
      ++lifetime;
      ++revision;
      readOverrides.clear();
      inflight.clear();
      request?.abort();
    },
  };
}
export type NotificationsController = ReturnType<typeof createNotificationsController>;
