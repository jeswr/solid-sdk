// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createInboxReader as createClientInboxReader,
  createNotifyClient,
  type InboxNotification,
  type InboxReader,
  type InboxReaderOptions,
  type Notify,
  type NotifyActivity,
  type NotifyOptions,
} from "solid-agent-notify/client";

export type {
  InboxNotification,
  InboxReader,
  InboxReaderOptions,
  Notify,
  NotifyActivity,
  NotifyOptions,
  NotifyResult,
} from "solid-agent-notify/client";

/** A reusable activity template. Supply the authenticated sender's WebID as actor at delivery. */
export type NotificationDraft = Omit<NotifyActivity, "actor">;

/** Create one notifier per authenticated session, with a ten-minute recipient inbox cache. */
export function createNotify(options: NotifyOptions): Notify {
  return createNotifyClient(options);
}

/** Announce a resource share and its application role. This builder does not change grants. */
export function shareNotification(resource: string, role: string): NotificationDraft {
  return { type: "Announce", object: resource, summary: `Shared with you as ${role}` };
}

/** Tasks §5.7: announce the assigned task, tracker and exact human-readable assignment. */
export function assignmentAnnounce(
  task: string,
  tracker: string,
  assignerName: string,
  title: string,
): NotificationDraft {
  return {
    type: "Announce",
    object: task,
    target: tracker,
    summary: `${assignerName} assigned you '${title}'`,
  };
}

/** Announce a newly created mention annotation in a document. */
export function mentionNotification(annotation: string, document: string): NotificationDraft {
  return { type: "Create", object: annotation, target: document };
}

/** Offer a room invitation using the suite's supported activity verbs. */
export function roomInvitation(room: string): NotificationDraft {
  return { type: "Offer", object: room };
}

/** Read an LDN inbox through the same authenticated transport as notification delivery. */
export function createInboxReader(options: InboxReaderOptions): InboxReader {
  return createClientInboxReader(options);
}

/** Preserve request deadlines while fencing a fixed or dynamically selected caller lifetime. */
export function withAbortSignal(
  fetch: typeof globalThis.fetch,
  lifetime: AbortSignal | (() => AbortSignal),
): typeof globalThis.fetch {
  return async (input, init) => {
    const signal = typeof lifetime === "function" ? lifetime() : lifetime;
    const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    combined.throwIfAborted();
    const response = await fetch(input, { ...init, signal: combined });
    combined.throwIfAborted();
    return response;
  };
}

export interface ReadInvitationsOptions<T> {
  reader: InboxReader;
  webId: string;
  signal?: AbortSignal | undefined;
  /** Omit to project all notification kinds, as a mixed inbox tray does. */
  kind?: ReturnType<typeof notificationKind>;
  /** Null or a thrown validation error discards a malformed item. Keys identify the offered resource. */
  normalise(item: InboxNotification): { key: string; value: T } | null;
  exclude?: ReadonlySet<string>;
  /** Non-negative safe integer; defaults to 50. Zero performs no I/O. */
  limit?: number;
}

/** Discover/read once, project one kind, and retain the newest distinct, unaccepted resources. */
export async function readInvitations<T>({
  reader,
  webId,
  signal,
  kind,
  normalise,
  exclude,
  limit = 50,
}: ReadInvitationsOptions<T>): Promise<T[]> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError("Invalid invitation limit");
  if (limit === 0) return [];
  const inbox = await reader.inbox(webId);
  signal?.throwIfAborted();
  if (!inbox) return [];
  const items = await reader.list(inbox, signal ? { signal } : {});
  signal?.throwIfAborted();
  const selected = new Map<string, T>();
  // InboxReader guarantees newest-first order, with deterministic ties and undated items last.
  for (const item of items) {
    signal?.throwIfAborted();
    if (kind !== undefined && notificationKind(item) !== kind) continue;
    let result: { key: string; value: T } | null;
    try {
      result = normalise(item);
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    signal?.throwIfAborted();
    if (!result?.key || exclude?.has(result.key) || selected.has(result.key)) continue;
    selected.set(result.key, result.value);
    if (selected.size === limit) break;
  }
  return [...selected.values()];
}

/** Classify the four suite builder shapes; unfamiliar activities remain other. */
export function notificationKind(
  notification: InboxNotification,
): "share" | "assignment" | "mention" | "invitation" | "other" {
  if (notification.type === "Announce") {
    if (notification.summary?.startsWith("Shared with you as ")) return "share";
    if (notification.target) return "assignment";
  }
  if (notification.type === "Create" && notification.target) return "mention";
  if (notification.type === "Offer") return "invitation";
  return "other";
}
