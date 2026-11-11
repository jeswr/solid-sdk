// AUTHORED-BY Codex GPT-6.1-Sol
/** Issues display adaptation over the SDK's bounded LDN reader. */
import { createInboxReader, type InboxReaderOptions } from "@jeswr/pod-access/notify";
import { isOwnPodUrl } from "./own-pod";

export interface InboxNotification {
  url: string;
  types: string[];
  actor?: string;
  object?: string;
  target?: string;
  summary?: string;
  published?: string;
}
export interface InboxResult {
  inboxUrl: string | undefined;
  notifications: InboxNotification[];
  totalMembers: number;
  truncated: boolean;
}

export async function resolveOwnInbox(
  webId: string,
  ownStorageUrls: readonly string[],
  fetchImpl?: typeof fetch,
  devLoopback = false,
): Promise<string | undefined> {
  const inbox = await createInboxReader({
    fetch: fetchImpl ?? globalThis.fetch,
    ownStorageRoots: ownStorageUrls,
    devLoopback,
  }).inbox(webId);
  return inbox && isOwnPodUrl(inbox, ownStorageUrls) ? inbox : undefined;
}

/** Fetch up to 500 direct children, then display the newest 50 with an explicit limit warning. */
export async function readInbox(
  webId: string,
  ownStorageUrls: readonly string[],
  fetchImpl?: typeof fetch,
  maxFetch = 500,
  devLoopback = false,
): Promise<InboxResult> {
  const options: InboxReaderOptions = {
    fetch: fetchImpl ?? globalThis.fetch,
    maxItems: maxFetch,
    includeUnknownActivities: true,
    ownStorageRoots: ownStorageUrls,
    devLoopback,
  };
  const reader = createInboxReader(options);
  const inboxUrl = await resolveOwnInbox(webId, ownStorageUrls, fetchImpl, devLoopback);
  if (!inboxUrl) return { inboxUrl, notifications: [], totalMembers: 0, truncated: false };
  const page = await reader.listPage(inboxUrl);
  return {
    inboxUrl,
    notifications: page.notifications.slice(0, 50).map(({ type, content, name, ...item }) => ({
      ...item,
      types:
        type === "Notification"
          ? []
          : type.split(", ").map((local) => `https://www.w3.org/ns/activitystreams#${local}`),
      summary: item.summary ?? content ?? name,
    })),
    totalMembers: page.members.length,
    truncated: page.truncated,
  };
}
