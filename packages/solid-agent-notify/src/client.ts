// AUTHORED-BY Codex GPT-6.1-Sol
import { httpsIri, inboxDiscovery } from "./client-discovery.js";

export type { InboxNotification } from "./inbox.js";
export type { InboxReader, InboxReaderOptions } from "./inbox-client.js";
export { createInboxReader } from "./inbox-client.js";
export type { ClientTransportOptions } from "./security/clientFetch.js";

import { type ClientTransportOptions, clientFetch } from "./security/clientFetch.js";

/** Activities supported by the suite's notification API. */
export interface NotifyActivity {
  type: "Announce" | "Offer" | "Accept" | "Reject" | "Create";
  object: string;
  target?: string;
  summary?: string;
  actor: string;
}

/** Delivery failures are values, including unreadable profiles and refused destinations. */
export interface NotifyResult {
  delivered: boolean;
  inbox: string | null;
  reason?: "no-inbox" | "forbidden" | "lws-no-ldn" | "network";
}

/** A notifier belongs to one caller/session; do not share its private profile cache across accounts. */
export interface NotifyOptions extends ClientTransportOptions {
  clock?: () => number;
  /** The RECIPIENT's known protocol, independent of the sender's storage protocol. */
  recipientProtocol?: (agentWebId: string) => "solid" | "lws" | Promise<"solid" | "lws">;
}

/** Deliver an activity using a caller-owned authenticated transport. */
export type Notify = (agentWebId: string, activity: NotifyActivity) => Promise<NotifyResult>;

const VERBS = new Set(["Announce", "Offer", "Accept", "Reject", "Create"]);

/**
 * Create a session-scoped LDN sender. Profile RDF is parsed by fetch-rdf over the supplied
 * fetch; exact WebID subjects select one unambiguous inbox. Positive/negative discovery is
 * cached for ten minutes, concurrent discovery is shared, and transient failures are retried.
 * The existing Node/Turtle sender remains a separate API with its DNS-pinned transport.
 */
export function createNotifyClient(options: NotifyOptions): Notify {
  const fetcher = clientFetch(options);
  const discover = inboxDiscovery(options);

  return async (agentWebId, activity) => {
    let inbox: string | null = null;
    try {
      if ((await options.recipientProtocol?.(agentWebId)) === "lws") {
        return { delivered: false, inbox, reason: "lws-no-ldn" };
      }
      // Copy caller data before discovery awaits so a mutation cannot change the sent activity.
      if (!VERBS.has(activity.type)) throw new TypeError("Unsupported activity type");
      const body = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: activity.type,
        actor: httpsIri(activity.actor),
        object: httpsIri(activity.object),
        ...(activity.target === undefined ? {} : { target: httpsIri(activity.target) }),
        ...(activity.summary === undefined ? {} : { summary: activity.summary }),
      });
      const discovery = await discover(agentWebId);
      inbox = discovery.inbox;
      if (inbox === null) return { delivered: false, ...discovery };
      const response = await fetcher(inbox, {
        method: "POST",
        headers: { "content-type": "application/ld+json" },
        body,
      });
      return response.ok
        ? { delivered: true, inbox }
        : {
            delivered: false,
            inbox,
            reason: response.status === 401 || response.status === 403 ? "forbidden" : "network",
          };
    } catch {
      return { delivered: false, inbox, reason: "network" };
    }
  };
}
