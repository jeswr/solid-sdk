/**
 * Live-sync over the pod (Solid Notifications Protocol — WebSocketChannel2023),
 * with a polling fallback for servers that don't advertise a channel. Notifications
 * are optional: we probe, and degrade gracefully (solid-notifications skill).
 *
 * `fetch` here is the @solid/reactive-authentication-patched global, so the
 * subscription POST is authenticated; the `wss://` socket carries its own token.
 */

const CHANNEL_TYPE = "http://www.w3.org/ns/solid/notification#WebSocketChannel2023";
const CONTEXT = "https://www.w3.org/ns/solid/notifications-context/v1";

/** The JSON-LD body to POST to a WebSocketChannel2023 subscription service. */
export function subscriptionRequest(topic: string): string {
  return JSON.stringify({ "@context": CONTEXT, type: CHANNEL_TYPE, topic });
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

const POLL_MS = 25_000;

/**
 * Watch a container for changes, calling `onChange` when it (or a member) changes.
 * Tries a WebSocketChannel2023 subscription; on any failure, falls back to polling.
 */
export function watchContainer(containerUrl: string, onChange: () => void, doFetch: typeof fetch = fetch): LiveSync {
  let ws: WebSocket | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const startPolling = () => {
    if (poll || closed) return;
    poll = setInterval(onChange, POLL_MS);
  };

  (async () => {
    try {
      const origin = new URL(containerUrl).origin;
      // CSS exposes the WebSocketChannel2023 service at a fixed path; other servers
      // would need Link/storageDescription discovery (falls through to polling).
      const service = new URL("/.notifications/WebSocketChannel2023/", origin).toString();
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
      ws = new WebSocket(receiveFrom);
      ws.addEventListener("message", () => onChange());
      ws.addEventListener("error", startPolling);
      ws.addEventListener("close", () => {
        if (!closed) startPolling();
      });
    } catch {
      startPolling();
    }
  })();

  return {
    close() {
      closed = true;
      ws?.close();
      if (poll) clearInterval(poll);
    },
  };
}
