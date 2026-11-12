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
  error: string | null;
}
/** Account-scoped async boundary: source results and mutations cannot update another account. */
export function createNotificationsController(
  sources: readonly NotificationSource[],
  decider?: AccessDecider,
  onNew: (notification: SuiteNotification) => void = () => {},
  readState?: NotificationReadState,
) {
  let snapshot: NotificationsSnapshot = { items: [], unread: 0, loading: true, error: null };
  let overlay: NotificationOverlay = { read: readState?.load() ?? new Set(), dismissed: new Set() };
  const readOverrides = new Map<string, boolean>();
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
      read: readOverrides.get(item.id) ?? item.read,
      ...(outcomes.has(item.id) ? { outcome: outcomes.get(item.id) ?? "" } : {}),
    }));
    snapshot = { items, unread: unreadCount(items), loading, error };
    for (const listener of listeners) listener();
  };
  /** Resolves true only when this listing finished and was not superseded. */
  const refresh = async (): Promise<boolean> => {
    const current = ++revision;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    publish(true, null);
    const responses = await Promise.allSettled(
      sources.map((source) => source.list(controller.signal)),
    );
    if (controller.signal.aborted || current !== revision) return false;
    let failed = false;
    responses.forEach((response, index) => {
      const source = sources[index];
      if (response.status === "fulfilled" && source) results.set(source.id, response.value);
      else failed = true;
    });
    overlay = { ...overlay, read: reconcileReadIds(overlay.read, [...results.values()]) };
    publish(false, failed ? "Couldn't load all notifications. Try again." : null);
    for (const item of snapshot.items) {
      if (initialized && !seen.has(item.id) && !item.read) onNew(item);
      seen.add(item.id);
    }
    // A failed initial load must not turn the first successful listing into desktop spam.
    if (!failed) initialized = true;
    return true;
  };
  const markRead = async (ids: string[]) => {
    const currentLifetime = lifetime;
    for (const id of ids) readOverrides.delete(id);
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
    if (
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
      if (!(await refresh())) return;
      // Retry pending read writes too, including sources that previously failed.
      if (overlay.read.size) await markRead([...overlay.read]);
    },
    markRead: (id: string) => markRead([id]),
    markAllRead(pushUndo?: (entry: Omit<UndoEntry, "scope">) => void) {
      const ids = snapshot.items.filter((item) => !item.read).map((item) => item.id);
      if (!ids.length) return Promise.resolve();
      const previousRead = new Set(overlay.read);
      const currentLifetime = lifetime;
      const operation = markRead(ids);
      pushUndo?.({
        label: `Marked ${ids.length} notifications as read`,
        async undo(signal) {
          signal.throwIfAborted();
          if (currentLifetime !== lifetime) throw new Error("Notification session changed");
          // Sources only support markRead. Explicit local unread intent must survive refreshes.
          for (const id of ids) readOverrides.set(id, false);
          overlay = {
            ...overlay,
            read: new Set(
              [...overlay.read].filter((id) => !ids.includes(id) || previousRead.has(id)),
            ),
          };
          readState?.remove?.(new Set(ids.filter((id) => !previousRead.has(id))));
          publish(snapshot.loading, snapshot.error);
        },
        async redo(signal) {
          signal.throwIfAborted();
          if (currentLifetime !== lifetime) throw new Error("Notification session changed");
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
      request?.abort();
    },
  };
}
export type NotificationsController = ReturnType<typeof createNotificationsController>;
