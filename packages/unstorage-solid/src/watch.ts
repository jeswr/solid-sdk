// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// watch(...) — react to pod changes over the Solid Notifications Protocol
// (WebSocketChannel2023). This is an OPTIONAL capability: discover support, never
// assume it. On any discovery / subscribe / socket failure we degrade gracefully
// to a no-op `Unwatch` and NEVER throw out of `watch`.
//
// Flow (see the solid-notifications skill):
//   1. HEAD the base container; read the `Link` rel
//      `http://www.w3.org/ns/solid/terms#storageDescription` (fall back to
//      `describedby`) for the description document.
//   2. Fetch + RDF-parse the description doc; find the WebSocketChannel2023
//      subscription service (notify:subscription of a service whose
//      notify:channelType is the WebSocketChannel2023 IRI).
//   3. POST a JSON-LD channel request for the base container topic; read
//      `receiveFrom` (a wss:// URL carrying its own short-lived auth).
//   4. Open a plain WebSocket to `receiveFrom`; on each ActivityStreams
//      notification map the changed resource URL -> key and fire the callback.
//
// The notification BODY is a protocol message (ActivityStreams JSON-LD), NOT pod
// RDF, so it is parsed with JSON.parse — exempt from the "all RDF via @solid/object"
// rule (per the solid-notifications skill). We DO use @jeswr/fetch-rdf to parse the
// storage DESCRIPTION document (that IS pod RDF).
//
// The WebSocket constructor is injected via an internal seam (`wsFactory`) so the
// path is testable against a mock channel without a real socket, and so the core
// driver import stays browser-safe (no static `ws` dependency — we use the global
// `WebSocket`, available in browsers and Node >= 22).

import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import type { WatchCallback, WatchEvent } from "unstorage";
import { urlToKey } from "./keys.js";

const STORAGE_DESCRIPTION_REL = "http://www.w3.org/ns/solid/terms#storageDescription";
const WEBSOCKET_CHANNEL_2023 = "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023";
const NOTIFY_SUBSCRIPTION = "http://www.w3.org/ns/solid/notifications#subscription";
const NOTIFY_CHANNEL_TYPE = "http://www.w3.org/ns/solid/notifications#channelType";
const NOTIFICATIONS_CONTEXT = "https://www.w3.org/ns/solid/notifications-context/v1";

/** The minimal WebSocket surface this module relies on (browser + ws compatible). */
export interface WatchSocket {
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (ev: unknown) => void): void;
  addEventListener(type: "close", listener: (ev: unknown) => void): void;
  close(): void;
}

/** Factory for a {@link WatchSocket} given a `wss://` URL. Injected for testing. */
export type WatchSocketFactory = (url: string) => WatchSocket;

/** Options for {@link startWatch}. */
export interface StartWatchOptions {
  /** The driver base container URL (already normalised; trailing slash). */
  readonly base: string;
  /** The (possibly authenticated) fetch. */
  readonly fetch: typeof globalThis.fetch;
  /** Callback fired per change. */
  readonly callback: WatchCallback;
  /**
   * Internal seam: build a WebSocket from a `wss://` URL. Defaults to the global
   * `WebSocket`. Tests inject a mock here.
   */
  readonly wsFactory?: WatchSocketFactory;
  /**
   * Internal seam: a logger for the graceful-degradation path. Defaults to a
   * no-op (so a pod without notifications stays quiet).
   */
  readonly onDegrade?: (reason: string) => void;
}

/** A started watch that can be disposed. */
export interface ActiveWatch {
  unwatch: () => void;
}

/** Parse RFC 8288 `Link` header values into {rel -> url} (first wins per rel). */
function parseLinkHeader(value: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!value) {
    return out;
  }
  // Split on commas that separate link-values (commas inside <...> are URLs and
  // do not occur in practice for these rels; a simple split is sufficient and
  // avoids a bespoke parser).
  for (const part of value.split(",")) {
    const match = part.match(/<([^>]*)>\s*;\s*(.*)/);
    if (!match) {
      continue;
    }
    const url = match[1];
    const params = match[2];
    if (!url || !params) {
      continue;
    }
    const relMatch = params.match(/rel\s*=\s*"?([^";]+)"?/i);
    if (!relMatch?.[1]) {
      continue;
    }
    for (const rel of relMatch[1].trim().split(/\s+/)) {
      if (!out.has(rel)) {
        out.set(rel, url);
      }
    }
  }
  return out;
}

/**
 * Discover the WebSocketChannel2023 subscription service URL for `base`.
 * Returns `undefined` (degrade) if no such service is advertised.
 */
async function discoverSubscriptionService(
  base: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | undefined> {
  const head = await fetchImpl(base, { method: "HEAD" });
  const links = parseLinkHeader(head.headers.get("link"));
  const descUrlRaw = links.get(STORAGE_DESCRIPTION_REL) ?? links.get("describedby");
  if (!descUrlRaw) {
    return undefined;
  }
  const descUrl = new URL(descUrlRaw, base).toString();

  const descRes = await fetchImpl(descUrl, {
    method: "GET",
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  if (!descRes.ok) {
    return undefined;
  }
  const body = await descRes.text();
  const dataset = await parseRdf(body, descRes.headers.get("content-type"), {
    baseIRI: descUrl,
  });

  // Find a notify:subscription whose channelType is WebSocketChannel2023.
  // Subscription services are subjects with notify:channelType WebSocketChannel2023;
  // they are linked from the storage via notify:subscription. We accept either:
  //   * any subject that has channelType = WebSocketChannel2023, OR
  //   * the object of a notify:subscription whose subject declares that channelType.
  // Walking these two specific predicates on the parsed dataset (NOT hand-parsing
  // text) keeps us within the typed-RDF discipline while staying tolerant of the
  // exact shape a given server emits.
  const channelTypeQuads = [
    ...dataset.match(null, DataFactory.namedNode(NOTIFY_CHANNEL_TYPE), null),
  ];
  for (const q of channelTypeQuads) {
    if (q.object.value === WEBSOCKET_CHANNEL_2023 && q.subject.termType === "NamedNode") {
      return q.subject.value;
    }
  }
  // Fall back: any object of notify:subscription (server advertises one service).
  const subscriptionQuads = [
    ...dataset.match(null, DataFactory.namedNode(NOTIFY_SUBSCRIPTION), null),
  ];
  for (const q of subscriptionQuads) {
    if (q.object.termType === "NamedNode") {
      return q.object.value;
    }
  }
  return undefined;
}

/**
 * Start watching `base` for changes. Resolves to an {@link ActiveWatch} whose
 * `unwatch` closes the socket. NEVER rejects — on any failure it degrades to a
 * no-op watch (logging via `onDegrade`).
 */
export async function startWatch(options: StartWatchOptions): Promise<ActiveWatch> {
  const { base, fetch: fetchImpl, callback, wsFactory, onDegrade } = options;
  const degrade = (reason: string): ActiveWatch => {
    onDegrade?.(reason);
    return { unwatch: () => {} };
  };

  const makeSocket: WatchSocketFactory | undefined =
    wsFactory ??
    (typeof globalThis.WebSocket !== "undefined"
      ? (url: string) => new globalThis.WebSocket(url) as unknown as WatchSocket
      : undefined);
  if (!makeSocket) {
    return degrade("no WebSocket implementation available (pass wsFactory or run on Node >= 22)");
  }

  let serviceUrl: string | undefined;
  try {
    serviceUrl = await discoverSubscriptionService(base, fetchImpl);
  } catch (err) {
    return degrade(`notification discovery failed: ${String(err)}`);
  }
  if (!serviceUrl) {
    return degrade("server advertises no WebSocketChannel2023 subscription service");
  }

  let receiveFrom: string | undefined;
  try {
    const subRes = await fetchImpl(serviceUrl, {
      method: "POST",
      headers: { "content-type": "application/ld+json" },
      body: JSON.stringify({
        "@context": NOTIFICATIONS_CONTEXT,
        type: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
        topic: base,
      }),
    });
    if (!subRes.ok) {
      return degrade(`subscribe failed: ${subRes.status} ${subRes.statusText}`);
    }
    const channel = (await subRes.json()) as { receiveFrom?: unknown };
    if (typeof channel.receiveFrom !== "string") {
      return degrade("subscription response had no `receiveFrom` URL");
    }
    receiveFrom = channel.receiveFrom;
  } catch (err) {
    return degrade(`subscribe request failed: ${String(err)}`);
  }

  let socket: WatchSocket;
  try {
    socket = makeSocket(receiveFrom);
  } catch (err) {
    return degrade(`opening notification socket failed: ${String(err)}`);
  }

  socket.addEventListener("message", (ev) => {
    handleNotification(ev.data, base, callback, onDegrade);
  });
  // A socket error/close just stops live updates; do not throw. (Reconnection is
  // out of scope for this thin driver — a consumer wanting resilient live-sync
  // re-creates the watch; documented in the README.)
  socket.addEventListener("error", () => {});
  socket.addEventListener("close", () => {});

  return {
    unwatch: () => {
      try {
        socket.close();
      } catch {
        // best-effort close.
      }
    },
  };
}

/**
 * Map an ActivityStreams notification to a `(event, key)` callback. ActivityType
 * Delete/Remove -> "remove"; everything else (Add/Update/Create) -> "update".
 */
function handleNotification(
  data: unknown,
  base: string,
  callback: WatchCallback,
  onDegrade?: (reason: string) => void,
): void {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof Uint8Array) {
    text = new TextDecoder().decode(data);
  } else {
    onDegrade?.("notification payload was neither string nor bytes; ignored");
    return;
  }
  let activity: { type?: unknown; object?: unknown };
  try {
    activity = JSON.parse(text);
  } catch {
    onDegrade?.("notification payload was not valid JSON; ignored");
    return;
  }
  const objectUrl = extractObjectUrl(activity.object);
  if (!objectUrl) {
    return;
  }
  const key = urlToKey(base, objectUrl);
  if (!key) {
    return; // a change outside our key space (e.g. the base container itself).
  }
  const event: WatchEvent = isRemoval(activity.type) ? "remove" : "update";
  try {
    callback(event, key);
  } catch {
    // a throwing consumer callback must not crash the socket handler.
  }
}

/** ActivityStreams `object` may be a string IRI or an object with `id`/`@id`. */
function extractObjectUrl(object: unknown): string | undefined {
  if (typeof object === "string") {
    return object;
  }
  if (object && typeof object === "object") {
    const o = object as { id?: unknown; "@id"?: unknown };
    if (typeof o.id === "string") {
      return o.id;
    }
    if (typeof o["@id"] === "string") {
      return o["@id"];
    }
  }
  return undefined;
}

/** True iff the AS `type` denotes a removal (string or array of strings/IRIs). */
function isRemoval(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    if (typeof t !== "string") {
      return false;
    }
    return /(?:^|[#/])(Delete|Remove)$/.test(t);
  });
}
