// AUTHORED-BY Codex GPT-6.1-Sol
import { buildActivity, serializeTurtle } from "./activity.js";
import { httpsIri, inboxDiscovery } from "./client-discovery.js";

export type { InboxNotification } from "./inbox.js";
export { isDirectChild as isInboxChild, isReadMarker, READ_SUFFIX } from "./inbox.js";
export type { InboxPage, InboxReader, InboxReaderOptions } from "./inbox-client.js";
export { createInboxReader, MAX_INBOX_ITEMS } from "./inbox-client.js";
export type { ClientTransportOptions } from "./security/clientFetch.js";
export { clientFetch as createNotifyFetch } from "./security/clientFetch.js";

import {
  type ClientTransportOptions,
  clientFetch,
  NotifyTargetError,
} from "./security/clientFetch.js";

/** Activities supported by the suite's notification API. */
export interface NotifyActivity {
  type: "Announce" | "Offer" | "Accept" | "Reject" | "Create" | "Invite" | "Update";
  object?: string;
  target?: string;
  summary?: string;
  content?: string;
  actor: string;
  provenance?: boolean;
}

/** Delivery failures are values, including unreadable profiles and refused destinations. */
export interface NotifyResult {
  delivered: boolean;
  inbox: string | null;
  status?: number;
  reason?:
    | "no-inbox"
    | "forbidden"
    | "lws-no-ldn"
    | "network"
    | "invalid-target"
    | "invalid-actor"
    | "profile-unreadable";
}

/** A notifier belongs to one caller/session; do not share its private profile cache across accounts. */
export interface NotifyOptions extends ClientTransportOptions {
  /** Authenticated session identity; activities cannot assert a different actor. */
  webId: string;
  clock?: () => number;
  /** The RECIPIENT's known protocol, independent of the sender's storage protocol. */
  recipientProtocol?: (agentWebId: string) => "solid" | "lws" | Promise<"solid" | "lws">;
}

/** Deliver an activity using a caller-owned authenticated transport. */
export type Notify = (agentWebId: string, activity: NotifyActivity) => Promise<NotifyResult>;

const VERBS = new Set(["Announce", "Offer", "Accept", "Reject", "Create", "Invite", "Update"]);

/**
 * Create a session-scoped LDN sender. Profile RDF is parsed by fetch-rdf over the supplied
 * fetch; exact WebID subjects select one unambiguous inbox. Positive/negative discovery is
 * cached for ten minutes, concurrent discovery is shared, and transient failures are retried.
 * The existing Node/Turtle sender remains a separate API with its DNS-pinned transport.
 */
export function createNotifyClient(options: NotifyOptions): Notify {
  const fetcher = clientFetch(options);
  const discover = inboxDiscovery(options);
  const clock = options.clock ?? Date.now;
  const webId = options.webId;

  return async (agentWebId, activity) => {
    let inbox: string | null = null;
    try {
      // Copy caller data before discovery awaits so a mutation cannot change the sent activity.
      if (!VERBS.has(activity.type)) throw new TypeError("Unsupported activity type");
      if (activity.actor !== webId) return { delivered: false, inbox, reason: "invalid-actor" };
      httpsIri(webId, options.devLoopback);
      const body = await serializeTurtle(
        buildActivity({
          ...activity,
          actor: webId,
          object: optionalHttps(activity.object, options.devLoopback),
          target: optionalHttps(activity.target, options.devLoopback),
          published: new Date(clock()),
        }),
      );
      if ((await options.recipientProtocol?.(agentWebId)) === "lws") {
        return { delivered: false, inbox, reason: "lws-no-ldn" };
      }
      const discovery = await discover(agentWebId);
      inbox = discovery.inbox;
      if (inbox === null) return { delivered: false, ...discovery };
      const response = await fetcher(inbox, {
        method: "POST",
        headers: { "content-type": "text/turtle" },
        body,
      });
      return response.ok
        ? { delivered: true, inbox }
        : {
            delivered: false,
            inbox,
            status: response.status,
            reason: response.status === 401 || response.status === 403 ? "forbidden" : "network",
          };
    } catch (error) {
      return {
        delivered: false,
        inbox,
        reason: error instanceof NotifyTargetError ? "invalid-target" : "network",
      };
    }
  };
}

/** Optional non-HTTPS links are omitted; they are never dereferenced by delivery. */
function optionalHttps(value: string | undefined, devLoopback?: boolean): string | undefined {
  if (value === undefined) return undefined;
  try {
    return httpsIri(value, devLoopback);
  } catch {
    return undefined;
  }
}
