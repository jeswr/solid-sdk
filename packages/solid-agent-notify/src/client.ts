// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
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

type Discovery = Pick<NotifyResult, "inbox" | "reason">;
const INBOX_TTL_MS = 10 * 60 * 1_000;
const LDP_INBOX = DataFactory.namedNode("http://www.w3.org/ns/ldp#inbox");
const VERBS = new Set(["Announce", "Offer", "Accept", "Reject", "Create"]);

/** Require an absolute HTTPS destination without credentials; preserve RDF identity lexically. */
function httpsIri(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || value.trim() !== value) {
    throw new TypeError("Expected an HTTPS IRI without credentials");
  }
  return value;
}

/**
 * Create a session-scoped LDN sender. Profile RDF is parsed by fetch-rdf over the supplied
 * fetch; exact WebID subjects select one unambiguous inbox. Positive/negative discovery is
 * cached for ten minutes, concurrent discovery is shared, and transient failures are retried.
 * The existing Node/Turtle sender remains a separate API with its DNS-pinned transport.
 */
export function createNotifyClient(options: NotifyOptions): Notify {
  const fetcher = clientFetch(options);
  const clock = options.clock ?? Date.now;
  const cache = new Map<string, { expires: number; result: Promise<Discovery> }>();

  async function discover(webId: string): Promise<Discovery> {
    const profile = new URL(httpsIri(webId));
    profile.hash = "";
    let lws = false;
    try {
      const { dataset } = await fetchRdf(profile.href, {
        fetch: async (input, init) => {
          const response = await fetcher(input, init);
          lws =
            response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ===
            "application/lws+json";
          return response;
        },
      });
      const inboxes = [...dataset.match(DataFactory.namedNode(webId), LDP_INBOX, null)];
      if (inboxes.length !== 1 || inboxes[0]?.object.termType !== "NamedNode") {
        return { inbox: null, reason: "no-inbox" };
      }
      const inbox = httpsIri(inboxes[0].object.value);
      if (new URL(inbox).hash) return { inbox: null, reason: "no-inbox" };
      return { inbox };
    } catch (error) {
      return {
        inbox: null,
        reason: lws
          ? "lws-no-ldn"
          : error instanceof RdfFetchError && (error.status === 401 || error.status === 403)
            ? "forbidden"
            : "network",
      };
    }
  }

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
      let entry = cache.get(agentWebId);
      if (!entry || entry.expires <= clock()) {
        // Bound session memory even when sending to many different recipients.
        if (cache.size >= 256) cache.delete(cache.keys().next().value as string);
        entry = { expires: clock() + INBOX_TTL_MS, result: discover(agentWebId) };
        cache.set(agentWebId, entry);
      }
      const discovery = await entry.result;
      inbox = discovery.inbox;
      if (discovery.reason === "network" || discovery.reason === "forbidden") {
        cache.delete(agentWebId);
      }
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
