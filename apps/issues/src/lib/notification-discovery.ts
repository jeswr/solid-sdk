/**
 * AUTHORED-BY Claude Opus 4.8
 *
 * Server-agnostic discovery of a Solid Notifications Protocol subscription
 * service (F10, pss-76p). Instead of assuming a CSS-shaped fixed path
 * (`/.notifications/WebSocketChannel2023/`), we discover the subscription
 * endpoint from the server's **storage description** doc, so live-sync works
 * against ANY conformant Solid server (CSS / ESS / NSS-via-modern / …).
 *
 * The flow, per the Solid Notifications Protocol §discovery
 * (https://solidproject.org/TR/notifications-protocol) and the
 * `solid-notifications` skill:
 *
 *   1. Resolve the storage-description doc from a pod resource's `Link` header
 *      (`rel="http://www.w3.org/ns/solid/terms#storageDescription"`, or
 *      `rel="describedby"`), falling back to `/.well-known/solid`.
 *   2. Parse it (RDF — via @jeswr/fetch-rdf + @rdfjs/wrapper, never bespoke)
 *      and read off the `notify:subscription` service whose
 *      `notify:channelType` is `WebSocketChannel2023`.
 *   3. Return that subscription endpoint URL (or `undefined` → caller falls
 *      back to polling). Discovery never throws for an absent channel — a
 *      server that advertises none degrades gracefully, it does not crash.
 *
 * Discovery is the only piece that needs the network; it is written as small
 * pure-ish functions (HTTP injected via `doFetch`) so the parse logic is unit
 * tested without a live server.
 */

import { DatasetWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { NOTIFY, RDF } from "./vocab";

/** The WebSocketChannel2023 channel-type IRI in the `notify:` namespace. */
export const WEBSOCKET_CHANNEL_TYPE = `${NOTIFY}WebSocketChannel2023`;

/**
 * Link relation that carries the storage-description URL on any resource in a
 * storage (Solid Protocol §4.3). `describedby` is the more generic per-resource
 * description relation; we accept either.
 */
const STORAGE_DESCRIPTION_REL = "http://www.w3.org/ns/solid/terms#storageDescription";
const DESCRIBEDBY_REL = "describedby";

/**
 * Parse an RFC 8288 `Link` header and return the target URL for the first link
 * whose `rel` set contains `rel` (case-insensitive). Targets are resolved
 * against `base`. Returns `undefined` if no matching link is present.
 *
 * Pure + exported for unit testing — `Link` parsing is fiddly (quoted params,
 * multiple rels per value, multiple links per header) and worth pinning down.
 */
export function linkHeaderTarget(header: string | null, rel: string, base: string): string | undefined {
  if (!header) return undefined;
  const wanted = rel.toLowerCase();
  // Split on commas that separate links, not commas inside <...> or "...".
  for (const part of splitLinks(header)) {
    const match = /^\s*<([^>]*)>\s*(.*)$/.exec(part);
    if (!match) continue;
    const [, target, paramStr] = match;
    const rels = relValues(paramStr);
    if (rels.includes(wanted)) {
      try {
        return new URL(target, base).toString();
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Split a Link header into its individual link-values (commas at top level only). */
function splitLinks(header: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = "";
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") depth++;
    else if (!inQuotes && ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0 && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/** Extract the (possibly space-separated) `rel` values from a link's params, lowercased. */
function relValues(paramStr: string): string[] {
  const m = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]+))/i.exec(paramStr);
  const value = m?.[1] ?? m?.[2];
  if (!value) return [];
  return value.trim().toLowerCase().split(/\s+/);
}

/**
 * A storage-description / notification-service description doc, wrapped so the
 * subscription services can be read off without hand-walking quads.
 */
class NotificationDescription extends DatasetWrapper {
  /**
   * The subscription-service URL for the given channel-type IRI, if the doc
   * advertises one. We match a `notify:subscription` object that is itself
   * typed (`notify:channelType`) as the requested channel — the shape CSS and
   * the protocol describe — and fall back to a directly-typed subject so a
   * server that advertises the channel without the `notify:subscription`
   * back-link still resolves.
   */
  subscriptionFor(channelType: string): string | undefined {
    const channel = DataFactory.namedNode(channelType);
    const channelTypePred = DataFactory.namedNode(`${NOTIFY}channelType`);
    const subscriptionPred = DataFactory.namedNode(`${NOTIFY}subscription`);
    const typePred = DataFactory.namedNode(`${RDF}type`);

    // Preferred: a `notify:subscription` object declared to be this channel type.
    for (const q of this.match(undefined, subscriptionPred)) {
      const service = q.object;
      if (service.termType !== "NamedNode") continue;
      const typed =
        this.match(service, channelTypePred, channel).size > 0 ||
        this.match(service, typePred, channel).size > 0;
      if (typed) return service.value;
    }

    // Fallback: any subject directly typed as the channel (some servers put
    // `notify:channelType <X>` straight on the service resource).
    for (const pred of [channelTypePred, typePred]) {
      for (const q of this.match(undefined, pred, channel)) {
        if (q.subject.termType === "NamedNode") return q.subject.value;
      }
    }
    return undefined;
  }
}

/**
 * Find the WebSocketChannel2023 subscription endpoint advertised by the parsed
 * storage-description dataset. `undefined` ⇒ no such channel advertised
 * (caller degrades to polling). Pure — unit tested against fixture datasets.
 */
export function webSocketSubscriptionEndpoint(dataset: DatasetCore): string | undefined {
  return new NotificationDescription(dataset, DataFactory).subscriptionFor(WEBSOCKET_CHANNEL_TYPE);
}

/**
 * Locate the storage-description doc for `resourceUrl`. Tries the resource's
 * `Link` header rels first (a cheap `HEAD`), then `/.well-known/solid` at the
 * origin. Returns `undefined` if neither resolves — never throws.
 */
export async function resolveStorageDescriptionUrl(
  resourceUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const head = await doFetch(resourceUrl, { method: "HEAD" });
    const link = head.headers.get("link");
    const fromLink =
      linkHeaderTarget(link, STORAGE_DESCRIPTION_REL, resourceUrl) ??
      linkHeaderTarget(link, DESCRIBEDBY_REL, resourceUrl);
    if (fromLink) return fromLink;
  } catch {
    // fall through to the well-known probe
  }
  try {
    return new URL("/.well-known/solid", new URL(resourceUrl).origin).toString();
  } catch {
    return undefined;
  }
}

/**
 * Discover the WebSocketChannel2023 subscription endpoint for `resourceUrl` on
 * whatever Solid server hosts it, via its storage description. Returns
 * `undefined` when the server advertises no such channel (or discovery fails) —
 * the caller then degrades to polling. Never throws.
 */
export async function discoverWebSocketSubscriptionEndpoint(
  resourceUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<string | undefined> {
  const descriptionUrl = await resolveStorageDescriptionUrl(resourceUrl, doFetch);
  if (!descriptionUrl) return undefined;
  let dataset: DatasetCore;
  try {
    const res = await doFetch(descriptionUrl, {
      headers: { accept: "text/turtle, application/ld+json;q=0.9", "cache-control": "no-cache" },
    });
    if (!res.ok) return undefined;
    const body = await res.text();
    dataset = await parseRdf(body, res.headers.get("content-type"), { baseIRI: descriptionUrl });
  } catch {
    return undefined;
  }
  return webSocketSubscriptionEndpoint(dataset);
}
