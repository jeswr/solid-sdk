// AUTHORED-BY Codex GPT-6.1-Sol
export type NotificationKind =
  | "shared"
  | "access-request"
  | "comment"
  | "task"
  | "sync-conflict"
  | "storage"
  | "system";
/** createdAt for a notification without a usable date: stable, sorts last, never displayed. */
export const UNDATED = -8640000000000000;
export interface SuiteNotification {
  id: string;
  kind: NotificationKind;
  /** Semantic source metadata used by the shared digest engine. */
  app?: string;
  category?: string;
  target?: { id: string; title: string };
  urgent?: boolean;
  blocking?: boolean;
  title: string;
  body?: string;
  href?: string;
  createdAt: Date;
  read: boolean;
  actor?: { name: string; webId?: string; photoUrl?: string };
  request?: {
    id: string;
    resource: string;
    resourceName: string;
    roles: ("viewer" | "commenter" | "editor")[];
    purpose?: string;
  };
  /** A successful decision stays visible after source reconciliation. */
  outcome?: string;
}
export interface NotificationSource {
  id: string;
  list(signal: AbortSignal): Promise<SuiteNotification[]>;
  subscribe?(onChange: () => void): () => void;
  markRead?(ids: string[]): Promise<void>;
}
export type AccessDecision =
  | { approve: true; role: string; duration?: "forever" | "day" | "month" | "year" }
  | { approve: false };
export interface AccessDecider {
  decide(
    request: NonNullable<SuiteNotification["request"]>,
    decision: AccessDecision,
  ): Promise<void>;
}
export interface NotificationOverlay {
  read: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
}

/** Newest copy owns content; a read confirmation from any copy wins. Inputs are never mutated. */
export function mergeNotifications(
  sources: readonly (readonly SuiteNotification[])[],
  overlay: NotificationOverlay,
): SuiteNotification[] {
  const merged = new Map<string, SuiteNotification>();
  for (const source of sources)
    for (const item of source) {
      if (overlay.dismissed.has(item.id)) continue;
      const previous = merged.get(item.id);
      const newest = previous && previous.createdAt > item.createdAt ? previous : item;
      merged.set(item.id, {
        ...newest,
        read: item.read || !!previous?.read || overlay.read.has(item.id),
      });
    }
  return [...merged.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

/** Keep local intent until every source carrying that id confirms it. Missing ids retain intent. */
export function reconcileReadIds(
  ids: ReadonlySet<string>,
  sources: readonly (readonly SuiteNotification[])[],
): Set<string> {
  const all = sources.flat();
  return new Set(
    [...ids].filter((id) => {
      const copies = all.filter((item) => item.id === id);
      return copies.length === 0 || copies.some((item) => !item.read);
    }),
  );
}
export function markNotificationsRead(
  overlay: NotificationOverlay,
  ids: readonly string[],
): NotificationOverlay {
  return { ...overlay, read: new Set([...overlay.read, ...ids]) };
}
export function dismissNotification(overlay: NotificationOverlay, id: string): NotificationOverlay {
  return { ...overlay, dismissed: new Set([...overlay.dismissed, id]) };
}
export function unreadCount(items: readonly SuiteNotification[]): number {
  return items.filter((item) => !item.read).length;
}
export function unreadLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}
export function groupNotifications(
  items: readonly SuiteNotification[],
  now: Date,
): { label: "Today" | "Earlier"; items: SuiteNotification[] }[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const today: SuiteNotification[] = [],
    earlier: SuiteNotification[] = [];
  for (const item of items)
    (item.createdAt.getTime() >= start && item.createdAt.getTime() < next ? today : earlier).push(
      item,
    );
  return [
    { label: "Today", items: today },
    { label: "Earlier", items: earlier },
  ].filter((group) => group.items.length > 0) as {
    label: "Today" | "Earlier";
    items: SuiteNotification[];
  }[];
}
