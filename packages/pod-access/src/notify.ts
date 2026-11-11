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
