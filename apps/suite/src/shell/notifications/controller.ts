// AUTHORED-BY Codex GPT-6.1-Sol
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
) {
  let snapshot: NotificationsSnapshot = { items: [], unread: 0, loading: true, error: null };
  let overlay: NotificationOverlay = { read: new Set(), dismissed: new Set() };
  const outcomes = new Map<string, string>();
  const results = new Map<string, SuiteNotification[]>();
  const listeners = new Set<() => void>();
  let request: AbortController | undefined;
  let revision = 0;
  let initialized = false;
  const seen = new Set<string>();
  const publish = (loading: boolean, error: string | null) => {
    const items = mergeNotifications([...results.values()], overlay).map((item) =>
      outcomes.has(item.id) ? { ...item, outcome: outcomes.get(item.id) ?? "" } : item,
    );
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
    overlay = markNotificationsRead(overlay, ids);
    publish(snapshot.loading, snapshot.error);
    const responses = await Promise.allSettled(
      sources.map((source) => {
        const owned = ids.filter((id) => results.get(source.id)?.some((item) => item.id === id));
        return owned.length ? source.markRead?.(owned) : undefined;
      }),
    );
    if (responses.some((response) => response.status === "rejected"))
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
    markAllRead: () => markRead(snapshot.items.map((item) => item.id)),
    dismiss(id: string) {
      overlay = dismissNotification(overlay, id);
      publish(snapshot.loading, snapshot.error);
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
      ++revision;
      request?.abort();
    },
  };
}
export type NotificationsController = ReturnType<typeof createNotificationsController>;
