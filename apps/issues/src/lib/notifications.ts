// AUTHORED-BY Codex GPT-6.1-Sol
import { createNotifications, type Subscription } from "@jeswr/pod-notifications";
import { createPollChannel } from "@jeswr/pod-notifications/channels/poll";
import { createPodClient } from "@jeswr/storage-client";
import { isOwnPodServiceUrl, isOwnPodUrl, isOwnPodWebSocketUrl } from "./own-pod";

/** Synchronous React cleanup; the SDK aborts pending setup and releases transports. */
export interface LiveSync {
  close(): void;
}

/** Own-pod policy and optional test transports for {@link watchContainer}. */
export interface WatchOptions {
  /** Missing roots disable push; read-only SDK polling can still refresh the view. */
  ownStorageUrls?: readonly string[];
  fetch?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Invalidate the board for scoped changes, first connection and missed-event resync.
 * The SDK owns discovery, protocol messages, reconnection, polling and cleanup.
 * Containers observe membership; use a separate watcher for each loaded issue's edits.
 */
export function watchContainer(
  containerUrl: string,
  onChange: () => void,
  options: WatchOptions = {},
): LiveSync {
  const abort = new AbortController();
  let subscription: Subscription | undefined;
  const own = options.ownStorageUrls ?? [];
  const ownRoot = own.find((root) => isOwnPodUrl(containerUrl, [root]));
  const doFetch = options.fetch ?? fetch;
  const WS = options.WebSocketImpl ?? globalThis.WebSocket;
  // Discovery services may sit outside the pod path, but never on a foreign origin.
  const boundedFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isOwnPodServiceUrl(url, own.length ? own : [containerUrl])) {
      throw new TypeError("Notification endpoint is outside the own-pod boundary");
    }
    return doFetch(input, { ...init, redirect: "error" });
  };
  void (async () => {
    const { storage } = await createPodClient({
      fetch: boundedFetch,
      storage: ownRoot ?? containerUrl,
      signal: abort.signal,
    });
    if (abort.signal.aborted) return;
    const notifications = createNotifications({
      fetch: boundedFetch,
      storage,
      // SDK still requires literal loopback at both storage and destination.
      allowInsecureLoopback: true,
      socketFactory: (url, protocols) => {
        if (!isOwnPodWebSocketUrl(url, own))
          throw new TypeError("Socket is outside the own-pod boundary");
        return new WS(url, protocols);
      },
    });
    // Without a trusted root, keep the old fail-closed, poll-only policy. The
    // SDK polling adapter uses only scoped reads and owns all timers/diffs.
    subscription =
      !ownRoot ||
      !isOwnPodUrl(storage.root, own) ||
      (!WS && notifications.plan().channel === "websocket")
        ? createPollChannel({
            storage,
            topics: [containerUrl],
            intervalMs: 25_000,
            signal: abort.signal,
            now: Date.now,
            timers: {
              setTimeout: (callback, delay) => setTimeout(callback, delay),
              clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
            },
          })
        : await notifications.subscribe([containerUrl], {
            pollIntervalMs: 25_000,
            signal: abort.signal,
          });
    if (abort.signal.aborted) {
      await subscription.close();
      return;
    }
    const invalidate = () => {
      if (!abort.signal.aborted) onChange();
    };
    subscription.on("change", invalidate);
    subscription.on("resync", invalidate);
    let connected = subscription.state === "live";
    if (connected) invalidate();
    subscription.on("state", (state) => {
      // Subsequent connections emit resync; only the first live needs this hint.
      if (state === "live" && !connected) {
        connected = true;
        invalidate();
      }
    });
  })().catch(() => {
    // Best effort: existing mount/manual reads continue if discovery is unavailable.
  });
  return {
    close() {
      abort.abort();
      void subscription?.close().catch(() => {});
    },
  };
}
