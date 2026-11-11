// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createInboxReader,
  type InboxNotification,
  notificationKind,
  readInvitations,
  withAbortSignal,
} from "@jeswr/pod-access/notify";
import { invitationRoom } from "../../apps/chat/lib/model/paths";
import { encodeRef } from "../../lib/refs";
import {
  type NotificationSource,
  type SuiteNotification,
  UNDATED,
} from "../lib/notifications-model";

const presentation = {
  share: { kind: "shared", title: "A resource was shared with you" },
  assignment: { kind: "task", title: "A task was assigned to you" },
  mention: { kind: "comment", title: "You were mentioned in a comment" },
  invitation: { kind: "shared", title: "You were invited to a room" },
  other: { kind: "system", title: "New inbox notification" },
} as const;

function actorLabel(webId: string): string {
  try {
    return new URL(webId).hostname || "Unknown sender";
  } catch {
    return "Unknown sender";
  }
}

function notificationHref(
  notification: InboxNotification,
  storageUrl?: string,
): string | undefined {
  const kind = notificationKind(notification);
  const object = kind === "mention" ? notification.target : notification.object;
  if (!object) return undefined;
  try {
    if (kind === "assignment") return `/tasks/inbox?task=${encodeRef(object)}`;
    if (kind === "invitation") return `/chat/r/${encodeRef(invitationRoom(object, storageUrl))}`;
    const document = new URL(object);
    document.hash = "";
    // The same references used by Drive and shell search; encodeRef permits only http(s).
    return `/drive/${document.pathname.endsWith("/") ? "f" : "p"}/${encodeRef(document.href)}`;
  } catch {
    return undefined;
  }
}

function suiteNotification(
  notification: InboxNotification,
  storageUrl?: string,
): SuiteNotification {
  const { kind, title } = presentation[notificationKind(notification)];
  const published = Date.parse(notification.published ?? "");
  const body = notification.content?.trim();
  const href = notificationHref(notification, storageUrl);
  return {
    id: notification.url,
    kind,
    title: notification.summary?.trim() || title,
    ...(body ? { body } : {}),
    ...(href ? { href } : {}),
    // Undated items are stable across refreshes, sort last, and show no time in the tray.
    createdAt: new Date(Number.isFinite(published) ? published : UNDATED),
    read: false,
    // Inbox actors are sender assertions, not verified identities. Never read their profiles
    // or project inbox content into the separate, actionable access-request source.
    ...(notification.actor
      ? { actor: { name: actorLabel(notification.actor), webId: notification.actor } }
      : {}),
  };
}

/** One reader/discovery cache per authenticated session; disposal fences late responses. */
export function createPodNotificationSource({
  webId,
  storageUrl,
  fetch: authenticatedFetch,
  clock,
}: {
  webId: string;
  storageUrl?: string;
  fetch: typeof globalThis.fetch;
  clock?: () => number;
}): NotificationSource & { dispose(): void } {
  const lifetime = new AbortController();
  const fetch = withAbortSignal(authenticatedFetch, lifetime.signal);
  const reader = createInboxReader({ fetch, ...(clock ? { clock } : {}) });
  return {
    id: "pod-inbox",
    async list(requestSignal) {
      const signal = AbortSignal.any([lifetime.signal, requestSignal]);
      signal.throwIfAborted();
      return readInvitations({
        reader,
        webId,
        signal,
        normalise(notification) {
          let key = notification.url;
          if (notificationKind(notification) === "invitation" && notification.object) {
            try {
              key = invitationRoom(notification.object, storageUrl);
            } catch {
              // Keep malformed notifications in the tray without an actionable room link.
            }
          }
          return { key, value: suiteNotification(notification, storageUrl) };
        },
      });
    },
    dispose() {
      lifetime.abort();
    },
  };
}
