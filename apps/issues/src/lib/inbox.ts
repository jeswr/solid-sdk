// AUTHORED-BY Codex GPT-6.1-Sol
/** Issues display adaptation over the SDK's bounded LDN reader. */
import { createInboxReader } from "@jeswr/pod-access/notify";
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
): Promise<string | undefined> {
  const inbox = await createInboxReader({ fetch: fetchImpl ?? globalThis.fetch }).inbox(webId);
  return inbox && isOwnPodUrl(inbox, ownStorageUrls) ? inbox : undefined;
}

/** Fetch up to 500 direct children, then display the newest 50 with an explicit limit warning. */
export async function readInbox(
  webId: string,
  ownStorageUrls: readonly string[],
  fetchImpl?: typeof fetch,
  maxFetch = 500,
): Promise<InboxResult> {
  const reader = createInboxReader({ fetch: fetchImpl ?? globalThis.fetch, maxItems: maxFetch });
  const inboxUrl = await resolveOwnInbox(webId, ownStorageUrls, fetchImpl);
  if (!inboxUrl) return { inboxUrl, notifications: [], totalMembers: 0, truncated: false };
  const page = await reader.listPage(inboxUrl);
  return {
    inboxUrl,
    notifications: page.notifications.slice(0, 50).map(({ type, content, name, ...item }) => ({
      ...item,
      types: type.split(", ").map((local) => `https://www.w3.org/ns/activitystreams#${local}`),
      summary: item.summary ?? content ?? name,
    })),
    totalMembers: page.members.length,
    truncated: page.truncated,
  };
}
