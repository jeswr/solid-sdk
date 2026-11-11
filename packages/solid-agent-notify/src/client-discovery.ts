// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import type { NotifyResult } from "./client.js";
import { type ClientTransportOptions, clientFetch } from "./security/clientFetch.js";

type Discovery = Pick<NotifyResult, "inbox" | "reason">;
const INBOX_TTL_MS = 10 * 60 * 1_000;
const LDP_INBOX = DataFactory.namedNode("http://www.w3.org/ns/ldp#inbox");

/** Require an absolute HTTPS destination without credentials; preserve RDF identity lexically. */
export function httpsIri(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || value.trim() !== value) {
    throw new TypeError("Expected an HTTPS IRI without credentials");
  }
  return value;
}

type Discover = (webId: string) => Promise<Discovery>;
// Transport identity is the session boundary. Clock and pinning assertions are also isolated.
const sessions = new WeakMap<
  typeof fetch,
  Map<typeof fetch | undefined, WeakMap<() => number, Discover>>
>();

export function inboxDiscovery(
  options: ClientTransportOptions & { clock?: () => number },
): Discover {
  const clock = options.clock ?? Date.now;
  let transports = sessions.get(options.fetch);
  if (!transports) {
    transports = new Map();
    sessions.set(options.fetch, transports);
  }
  let clocks = transports.get(options.pinningFetch);
  if (!clocks) {
    clocks = new WeakMap();
    transports.set(options.pinningFetch, clocks);
  }
  const existing = clocks.get(clock);
  if (existing) return existing;
  const fetcher = clientFetch(options);
  const cache = new Map<string, { expires: number; result: Promise<Discovery> }>();
  async function discover(webId: string): Promise<Discovery> {
    let lws = false;
    try {
      const profile = new URL(httpsIri(webId));
      profile.hash = "";
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

  const cached: Discover = async (webId) => {
    let entry = cache.get(webId);
    if (!entry || entry.expires <= clock()) {
      // Bound session memory even when sending to many different recipients.
      if (cache.size >= 256) cache.delete(cache.keys().next().value as string);
      entry = { expires: clock() + INBOX_TTL_MS, result: discover(webId) };
      cache.set(webId, entry);
    }
    const discovery = await entry.result;
    if (discovery.reason === "network" || discovery.reason === "forbidden") {
      if (cache.get(webId) === entry) cache.delete(webId);
    }
    return discovery;
  };
  clocks.set(clock, cached);
  return cached;
}
