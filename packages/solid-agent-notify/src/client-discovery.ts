// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import type { NotifyResult } from "./client.js";
import {
  type ClientTransportOptions,
  clientFetch,
  NotifyTargetError,
} from "./security/clientFetch.js";

type Discovery = Pick<NotifyResult, "inbox" | "reason" | "status">;
const INBOX_TTL_MS = 10 * 60 * 1_000;
const LDP_INBOX = DataFactory.namedNode("http://www.w3.org/ns/ldp#inbox");

/** Require an absolute HTTPS destination without credentials; preserve RDF identity lexically. */
export function httpsIri(value: string, devLoopback = false): string {
  const url = new URL(value);
  const localHttp =
    devLoopback &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!localHttp && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    value.trim() !== value
  ) {
    throw new TypeError("Expected an HTTPS IRI without credentials");
  }
  return value;
}

type Discover = (webId: string) => Promise<Discovery>;
// Transport identity is the session boundary. Clock and pinning assertions are also isolated.
const sessions = new WeakMap<
  typeof fetch,
  Map<typeof fetch | undefined, WeakMap<() => number, Map<string, Discover>>>
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
  let policies = clocks.get(clock);
  if (!policies) {
    policies = new Map();
    clocks.set(clock, policies);
  }
  // DNS seam calls do not share discovery with other resolver functions.
  const policyKey = JSON.stringify([options.devLoopback, options.ownStorageRoots]);
  const existing = options.dnsLookup === undefined ? policies.get(policyKey) : undefined;
  if (existing) return existing;
  const fetcher = clientFetch(options);
  const cache = new Map<string, { expires: number; result: Promise<Discovery> }>();
  async function discover(webId: string): Promise<Discovery> {
    let lws = false;
    try {
      let profile: URL;
      try {
        profile = new URL(httpsIri(webId, options.devLoopback));
      } catch {
        return { inbox: null, reason: "invalid-target" };
      }
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
      let inbox: string;
      try {
        inbox = httpsIri(inboxes[0].object.value, options.devLoopback);
      } catch {
        return { inbox: null, reason: "invalid-target" };
      }
      if (new URL(inbox).hash) return { inbox: null, reason: "no-inbox" };
      return { inbox };
    } catch (error) {
      return {
        inbox: null,
        reason: lws
          ? "lws-no-ldn"
          : error instanceof NotifyTargetError ||
              (error instanceof RdfFetchError && error.cause instanceof NotifyTargetError)
            ? "invalid-target"
            : error instanceof RdfFetchError &&
                (error.status !== undefined || error.contentType !== undefined)
              ? "profile-unreadable"
              : "network",
        ...(error instanceof RdfFetchError && error.status !== undefined
          ? { status: error.status }
          : {}),
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
    if (discovery.reason === "network" || discovery.reason === "profile-unreadable") {
      if (cache.get(webId) === entry) cache.delete(webId);
    }
    return discovery;
  };
  if (options.dnsLookup === undefined) policies.set(policyKey, cached);
  return cached;
}
