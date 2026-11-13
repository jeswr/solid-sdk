// AUTHORED-BY Codex GPT-6.1-Sol
import { type FetchedRdf, fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Parser, Store } from "n3";
import { httpsIri, inboxDiscovery } from "./client-discovery.js";
import {
  containerMembers,
  type InboxNotification,
  isInboxContainer,
  isReadMarker,
  parseInboxNotification,
  sortInboxNotifications,
} from "./inbox.js";
import {
  type ClientTransportOptions,
  clientFetch,
  type ListingBudget,
} from "./security/clientFetch.js";

export const MAX_INBOX_ITEMS = 500;

/** One authenticated session's bounded reader. Recreate transports on session changes. */
export interface InboxReaderOptions extends ClientTransportOptions {
  clock?: () => number;
  /** Maximum direct children to read, in listing order (default 50). */
  maxItems?: number;
  /** Preserve readable documents with no identifiable activity subject. */
  includeUnknownActivities?: boolean;
}

/** Listing metadata remains available even when unreadable children are skipped. */
export interface InboxPage {
  notifications: InboxNotification[];
  /** All eligible direct children, before the fetch ceiling is applied. */
  members: string[];
  truncated: boolean;
}

export interface InboxReader {
  inbox(webId: string): Promise<string | null>;
  list(inboxUrl: string, options?: { signal?: AbortSignal }): Promise<InboxNotification[]>;
  listPage(inboxUrl: string, options?: { signal?: AbortSignal }): Promise<InboxPage>;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

/** Read LDN inboxes with the caller's authenticated, bounded, redirect-refusing fetch. */
export function createInboxReader(options: InboxReaderOptions): InboxReader {
  const maxItems = options.maxItems ?? 50;
  if (!Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > MAX_INBOX_ITEMS) {
    throw new TypeError("maxItems must be a non-negative safe integer at most 500");
  }
  const fetcher = clientFetch(options);
  const discover = inboxDiscovery(options);
  async function listPage(
    inboxUrl: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<InboxPage> {
    checkAbort(signal);
    httpsIri(inboxUrl, options.devLoopback);
    if (new URL(inboxUrl).hash) throw new TypeError("Inbox URLs cannot have fragments");
    let container: FetchedRdf<import("@rdfjs/types").DatasetCore>;
    const budget: ListingBudget = { truncated: false };
    try {
      container = await fetchRdf(inboxUrl, {
        fetch: clientFetch(options, budget),
        signal,
        // fetch-rdf owns negotiation, byte budgets and remote-context refusal. Its
        // parser seam preserves complete Turtle statements from a capped listing.
        engine: {
          async parse(input, mediaType, parserOptions) {
            if (!budget.truncated) return parseRdf(input, mediaType, { baseIRI: inboxUrl, signal });
            const dataset = new Store();
            if (mediaType !== "text/turtle" && mediaType !== "application/n-triples")
              return dataset;
            await new Promise<void>((resolve) => {
              new Parser({ format: mediaType, baseIRI: parserOptions?.baseIri }).parse(
                input,
                (error, quad) => {
                  if (error || !quad) resolve();
                  else dataset.addQuad(quad);
                },
              );
            });
            return dataset;
          },
        },
      });
    } catch (error) {
      checkAbort(signal);
      if (
        error instanceof RdfFetchError &&
        ((error.status === undefined && error.contentType !== undefined) || error.status === 404)
      ) {
        return { notifications: [], members: [], truncated: budget.truncated };
      }
      throw error;
    }
    checkAbort(signal);
    const allMembers = containerMembers(inboxUrl, container.dataset);
    const eligible = allMembers.filter((member) => !isReadMarker(member));
    const members = eligible.slice(0, maxItems);
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
            else if (options.includeUnknownActivities && !isInboxContainer(member, dataset))
              items.push({ url: member, type: "Notification" });
          } catch {
            checkAbort(signal);
            // An unreadable member must not hide other notifications.
          }
        }
      }),
    );
    checkAbort(signal);
    return {
      notifications: sortInboxNotifications(items),
      members: allMembers,
      truncated: budget.truncated || eligible.length > maxItems,
    };
  }
  return {
    inbox: async (webId) => (await discover(webId)).inbox,
    async list(inboxUrl, options) {
      return (await listPage(inboxUrl, options)).notifications;
    },
    listPage,
  };
}
