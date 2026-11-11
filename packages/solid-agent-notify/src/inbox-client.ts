// AUTHORED-BY Codex GPT-6.1-Sol
import { type FetchedRdf, fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { httpsIri, inboxDiscovery } from "./client-discovery.js";
import {
  containerMembers,
  type InboxNotification,
  parseInboxNotification,
  sortInboxNotifications,
} from "./inbox.js";
import { type ClientTransportOptions, clientFetch } from "./security/clientFetch.js";

/** One authenticated session's bounded reader. Recreate transports on session changes. */
export interface InboxReaderOptions extends ClientTransportOptions {
  clock?: () => number;
  /** Maximum direct children to read, in listing order (default 50). */
  maxItems?: number;
}

export interface InboxReader {
  inbox(webId: string): Promise<string | null>;
  list(inboxUrl: string, options?: { signal?: AbortSignal }): Promise<InboxNotification[]>;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

/** Read LDN inboxes with the caller's authenticated, bounded, redirect-refusing fetch. */
export function createInboxReader(options: InboxReaderOptions): InboxReader {
  const maxItems = options.maxItems ?? 50;
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) {
    throw new TypeError("maxItems must be a non-negative safe integer");
  }
  const fetcher = clientFetch(options);
  const discover = inboxDiscovery(options);
  return {
    inbox: async (webId) => (await discover(webId)).inbox,
    async list(inboxUrl, { signal } = {}) {
      checkAbort(signal);
      httpsIri(inboxUrl);
      if (new URL(inboxUrl).hash) throw new TypeError("Inbox URLs cannot have fragments");
      let container: FetchedRdf;
      try {
        container = await fetchRdf(inboxUrl, { fetch: fetcher, signal });
      } catch (error) {
        checkAbort(signal);
        if (
          error instanceof RdfFetchError &&
          ((error.status === undefined && error.contentType !== undefined) ||
            error.status === 401 ||
            error.status === 403 ||
            error.status === 404)
        ) {
          return [];
        }
        throw error;
      }
      checkAbort(signal);
      const members = containerMembers(inboxUrl, container.dataset).slice(0, maxItems);
      const items: InboxNotification[] = [];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(6, members.length) }, async () => {
          while (next < members.length) {
            checkAbort(signal);
            const member = members[next++];
            try {
              const { dataset } = await fetchRdf(member, { fetch: fetcher, signal });
              checkAbort(signal);
              const item = parseInboxNotification(member, dataset);
              if (item) items.push(item);
            } catch {
              checkAbort(signal);
              // An unreadable member must not hide other notifications.
            }
          }
        }),
      );
      checkAbort(signal);
      return sortInboxNotifications(items);
    },
  };
}
