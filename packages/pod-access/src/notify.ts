// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  createInboxReader as createClientInboxReader,
  createNotifyClient,
  createNotifyFetch,
  type InboxNotification,
  type InboxReader,
  type InboxReaderOptions,
  isInboxChild,
  isReadMarker,
  MAX_INBOX_ITEMS,
  type Notify,
  type NotifyActivity,
  type NotifyOptions,
  READ_SUFFIX,
} from "solid-agent-notify/client";

export type {
  ClientTransportOptions,
  InboxNotification,
  InboxPage,
  InboxReader,
  InboxReaderOptions,
  Notify,
  NotifyActivity,
  NotifyOptions,
  NotifyResult,
} from "solid-agent-notify/client";

export { createNotifyFetch, isLoopbackHostname, MAX_INBOX_ITEMS } from "solid-agent-notify/client";

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

/** Announce an issue event to its recipient, preserving the app's human summary. */
export function issueAnnounce(
  issue: string,
  recipient: string,
  summary: string,
): NotificationDraft {
  return { type: "Announce", object: issue, target: recipient, summary, provenance: true };
}

/** Offer a room invitation using the suite's supported activity verbs. */
export function roomInvitation(room: string): NotificationDraft {
  return { type: "Offer", object: room };
}

/** Read an LDN inbox through the same authenticated transport as notification delivery. */
export function createInboxReader(options: InboxReaderOptions): InboxReader {
  return createClientInboxReader(options);
}

/** Classify suite activity shapes; unfamiliar activities remain other. */
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

/** A notification with the owner's sidecar-derived read state. */
export interface ReadableNotification extends InboxNotification {
  read: boolean;
}

export interface ManagedInbox {
  readonly inboxUrl: string;
  list(): Promise<ReadableNotification[]>;
  listPage(): Promise<{ notifications: ReadableNotification[]; truncated: boolean }>;
  markRead(notificationUrl: string): Promise<void>;
  dismiss(notificationUrl: string): Promise<void>;
}

/** Trusted storage roots come from the active owner's session, never notification RDF. */
export interface InboxManagerOptions extends InboxReaderOptions {
  webId: string;
  storageRoots: readonly string[];
}

const AS = "https://www.w3.org/ns/activitystreams#";

class ReadMarker extends TermWrapper {
  get read(): boolean | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}read`, LiteralAs.boolean);
  }
  get notification(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}object`, NamedNodeAs.string);
  }
  get creator(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${AS}actor`, NamedNodeAs.string);
  }
  mark(notificationUrl: string, webId: string): void {
    OptionalAs.object(this, `${AS}actor`, webId, NamedNodeFrom.string);
    OptionalAs.object(this, `${AS}read`, true, LiteralFrom.boolean);
    OptionalAs.object(this, `${AS}object`, notificationUrl, NamedNodeFrom.string);
  }
}

function requireOk(response: Response): void {
  if (!response.ok) throw new Error(`Inbox request failed (HTTP ${response.status})`);
}

/**
 * Discover the owner's inbox and pin every mutation to its direct children within
 * the supplied active storage. The transport retains the client's public-HTTPS,
 * DNS-pinning, redirect, response-byte and deadline guards.
 */
export async function createInboxManager(
  options: InboxManagerOptions,
): Promise<ManagedInbox | null> {
  const { webId, storageRoots, ...transport } = options;
  const maxItems = options.maxItems ?? MAX_INBOX_ITEMS;
  if (!Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > MAX_INBOX_ITEMS) {
    throw new TypeError("maxItems must be an integer from 0 to 500");
  }
  const roots = [...storageRoots];
  const reader = createInboxReader({
    ...transport,
    ownStorageRoots: roots,
    maxItems: MAX_INBOX_ITEMS,
  });
  const discovered = await reader.inbox(webId);
  if (
    discovered === null ||
    new URL(discovered).search !== "" ||
    !roots.some((root) => isWithinPodScope(root, discovered, { allowRoot: false })) ||
    roots.some((root) => isWithinPodScope(discovered, root))
  ) {
    return null;
  }
  const inboxUrl = discovered;
  const fetcher = createNotifyFetch({
    ...transport,
    ownStorageRoots: roots,
    ownInboxUrl: inboxUrl,
  });
  function child(url: string): void {
    if (!isInboxChild(url, inboxUrl)) {
      throw new Error("Refusing a resource outside the owner's inbox");
    }
  }
  function notification(url: string): void {
    child(url);
    if (isReadMarker(url)) throw new Error("A read marker is not a notification");
  }
  async function remove(url: string): Promise<void> {
    child(url);
    const response = await fetcher(url, { method: "DELETE" });
    if (response.status !== 404) requireOk(response);
  }
  async function listPage() {
    const page = await reader.listPage(inboxUrl);
    const members = new Set(page.members);
    const notifications = page.notifications
      .slice(0, maxItems)
      .map((item) => ({ ...item, read: false }));
    const remaining = notifications.values();
    await Promise.all(
      Array.from({ length: Math.min(6, notifications.length) }, async () => {
        for (const item of remaining) {
          const marker = `${item.url}${READ_SUFFIX}`;
          if (!members.has(marker)) continue;
          try {
            const { dataset } = await fetchRdf(marker, { fetch: fetcher });
            const doc = new ReadMarker(`${marker}#it`, dataset, DataFactory);
            item.read = doc.read === true && doc.notification === item.url && doc.creator === webId;
          } catch {
            // Unreadable, malformed or sender-authored markers cannot establish read state.
          }
        }
      }),
    );
    return {
      notifications,
      truncated: page.truncated || page.notifications.length > maxItems,
    };
  }
  return {
    inboxUrl,
    list: async () => (await listPage()).notifications,
    listPage,
    async markRead(url) {
      notification(url);
      const marker = `${url}${READ_SUFFIX}`;
      child(marker);
      const headers = new Headers({ "content-type": "text/turtle" });
      const dataset = new Store();
      new ReadMarker(`${marker}#it`, dataset, DataFactory).mark(url, webId);
      const body = await serialize([...dataset], { prefixes: { as: AS } });
      requireOk(await fetcher(marker, { method: "PUT", headers, body }));
    },
    async dismiss(url) {
      notification(url);
      await remove(url);
      try {
        await remove(`${url}${READ_SUFFIX}`);
      } catch {
        // Sidecar cleanup is best effort after the notification was dismissed.
      }
    },
  };
}
