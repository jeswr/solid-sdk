// AUTHORED-BY Claude Opus 4.8
/**
 * Live-sync over the pod (Solid Notifications Protocol — WebSocketChannel2023),
 * with a polling fallback for servers that don't advertise a channel. Notifications
 * are optional: we probe, and degrade gracefully (solid-notifications skill).
 *
 * The subscription endpoint is discovered from the server's **storage
 * description** (F10, pss-76p, `notification-discovery.ts`) — NOT a hard-coded
 * CSS path — so live-sync works against ANY conformant Solid server. A server
 * that advertises no WebSocketChannel2023 falls through to polling.
 *
 * `fetch` here is the @solid/reactive-authentication-patched global, so the
 * subscription POST is authenticated; the `wss://` socket carries its own token.
 *
 * SECURITY (own-pod SSRF guard, load-bearing): the discovered subscription
 * endpoint AND the `receiveFrom` socket URL both come from server-controlled
 * data, so before we POST our auth-patched `fetch` to the endpoint, or open the
 * socket, we confirm each points at one of the user's OWN pod storages
 * (`own-pod.ts`). A foreign URL is rejected fail-closed → we fall back to polling
 * rather than attach the user's token to / open a socket against another origin.
 * Callers without the user's storage roots (e.g. a context that can't supply
 * them) get the same fail-closed behaviour: with no own-pod allow-list, EVERY
 * URL fails the guard, so live-sync degrades to polling rather than connecting
 * to an unvalidated origin.
 */

import { discoverWebSocketSubscriptionEndpoint, WEBSOCKET_CHANNEL_TYPE } from "./notification-discovery";
import { isOwnPodUrl, isOwnPodWebSocketUrl } from "./own-pod";

const CONTEXT = "https://www.w3.org/ns/solid/notifications-context/v1";

/**
 * The JSON-LD body to POST to a WebSocketChannel2023 subscription service.
 * The `type` MUST be the SAME channel-type IRI discovery matched on
 * (`WEBSOCKET_CHANNEL_TYPE`, the plural `notify:` namespace) — a conforming
 * server discovered via its storage description rejects a subscription whose
 * `type` is in the wrong namespace, so we reuse the exported constant rather
 * than a separate string that could drift.
 */
export function subscriptionRequest(topic: string): string {
  return JSON.stringify({ "@context": CONTEXT, type: WEBSOCKET_CHANNEL_TYPE, topic });
}

/** The changed resource URL from a notification ActivityStreams object, if any. */
export function changedResource(notification: unknown): string | undefined {
  const o = (notification as { object?: unknown })?.object;
  if (typeof o === "string") return o;
  if (o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string") {
    return (o as { id: string }).id;
  }
  return undefined;
}

export interface LiveSync {
  close(): void;
}

/** Options for {@link watchContainer}. */
export interface WatchOptions {
  /**
   * The user's own pod storage roots (from their profile's `pim:storage`). The
   * discovered subscription endpoint and socket URL are validated against these
   * before any authenticated request / socket open (own-pod SSRF guard). Empty /
   * omitted ⇒ EVERYTHING fails the guard ⇒ poll-only (fail-closed).
   */
  ownStorageUrls?: readonly string[];
  /** Injected fetch (tests); production uses the auth-patched global. */
  fetch?: typeof fetch;
  /** Injected WebSocket constructor (tests); production uses the global. */
  WebSocketImpl?: typeof WebSocket;
}

const POLL_MS = 25_000;

/**
 * Watch a container for changes, calling `onChange` when it (or a member) changes.
 * Tries a WebSocketChannel2023 subscription against the user's OWN pod; on any
 * failure — including the own-pod SSRF guard rejecting a foreign subscription /
 * socket URL — it falls back to polling. Graceful: a server that advertises no
 * channel polls; a server that advertises a FOREIGN channel polls (never
 * connects). Clean teardown: `close()` clears the poll timer, removes the socket
 * listeners, and closes the socket — no leaked sockets/listeners on unmount.
 */
export function watchContainer(
  containerUrl: string,
  onChange: () => void,
  options: WatchOptions = {},
): LiveSync {
  const doFetch = options.fetch ?? fetch;
  const WS = options.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
  const ownStorageUrls = options.ownStorageUrls ?? [];

  let ws: WebSocket | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  // Named handlers so teardown removes EXACTLY what was added (no leaked listeners).
  let onMessage: (() => void) | undefined;
  let onError: (() => void) | undefined;
  let onClose: (() => void) | undefined;

  const startPolling = () => {
    if (poll || closed) return;
    poll = setInterval(onChange, POLL_MS);
  };

  (async () => {
    try {
      // Server-agnostic: discover the WebSocketChannel2023 subscription endpoint
      // from the server's storage description (F10). No advertised channel ⇒
      // poll. This replaces the old hard-coded CSS `/.notifications/…` path.
      const service = await discoverWebSocketSubscriptionEndpoint(containerUrl, doFetch);
      if (closed) return;
      if (!service || !WS) {
        startPolling();
        return;
      }
      // SSRF guard: the discovered endpoint is server-controlled — only POST our
      // auth-patched fetch to it if it lives within the user's OWN pod.
      if (!isOwnPodUrl(service, ownStorageUrls)) {
        startPolling();
        return;
      }
      const res = await doFetch(service, {
        method: "POST",
        headers: { "content-type": "application/ld+json" },
        body: subscriptionRequest(containerUrl),
      });
      if (!res.ok) throw new Error(`subscribe ${res.status}`);
      const { receiveFrom } = (await res.json()) as { receiveFrom?: string };
      if (closed || !receiveFrom) {
        startPolling();
        return;
      }
      // SSRF guard: the socket URL comes from the subscription response — only
      // open it if its origin is one of the user's own pod storages. A foreign
      // `receiveFrom` falls back to polling (never opens a cross-origin socket).
      if (!isOwnPodWebSocketUrl(receiveFrom, ownStorageUrls)) {
        startPolling();
        return;
      }
      // Re-check `closed` once more: `close()` may have run while the POST / JSON
      // parse was in flight. Without this a socket would be opened (and leak)
      // AFTER the watcher was torn down, since `close()` only knows about a `ws`
      // that already exists.
      if (closed) return;
      ws = new WS(receiveFrom);
      onMessage = () => onChange();
      onError = startPolling;
      onClose = () => {
        if (!closed) startPolling();
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
    } catch {
      startPolling();
    }
  })();

  return {
    close() {
      closed = true;
      if (ws) {
        if (onMessage) ws.removeEventListener("message", onMessage);
        if (onError) ws.removeEventListener("error", onError);
        if (onClose) ws.removeEventListener("close", onClose);
        ws.close();
      }
      if (poll) clearInterval(poll);
    },
  };
}
