// AUTHORED-BY Codex GPT-6.1-Sol
import { createNotifications, type ChangeEvent, type Subscription } from "@jeswr/pod-notifications";
import { createPodClient } from "@jeswr/storage-client";
import { allowInsecureLoopback } from "./auth-environment";

/** The view needs only an invalidation's verb and changed resource URL. */
export type ResourceChangeNotification = Pick<ChangeEvent, "type" | "object">;

/** Inject the session's bounded pod fetch; tests may also replace the socket. */
export interface SubscribeOptions {
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  signal?: AbortSignal;
}

/**
 * Watch the active view through the SDK's Solid/LWS push or polling channel.
 * Refresh on first live and resync as well as changes, covering missed events.
 * Failures remain silent; cleanup aborts pending discovery and closes the SDK subscription.
 */
export async function subscribeToResource(
  topicUrl: string,
  onChange: (n: ResourceChangeNotification) => void,
  opts: SubscribeOptions = {},
): Promise<() => void> {
  const abort = new AbortController();
  const signal = opts.signal ? AbortSignal.any([abort.signal, opts.signal]) : abort.signal;
  let subscription: Subscription | undefined;
  const stop = () => {
    abort.abort();
    void subscription?.close().catch(() => {});
  };
  try {
    const origin = new URL(topicUrl).origin;
    const doFetch = opts.fetchImpl ?? fetch;
    // Preserve the application's stricter same-origin policy for discovered services.
    const boundedFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin || url.username || url.password)
        throw new TypeError("Off-pod notification endpoint");
      return doFetch(input, { ...init, redirect: "error" });
    };
    const { storage } = await createPodClient({ fetch: boundedFetch, storage: topicUrl, signal });
    const WS = opts.webSocketImpl ?? globalThis.WebSocket;
    subscription = await createNotifications({
      fetch: boundedFetch,
      storage,
      allowInsecureLoopback: allowInsecureLoopback(),
      socketFactory: (url, protocols) => {
        if (new URL(url).host !== new URL(topicUrl).host)
          throw new TypeError("Off-pod notification socket");
        return new WS(url, protocols);
      },
    }).subscribe([topicUrl], { signal });
    if (signal.aborted) {
      stop();
      return stop;
    }
    const invalidate = (event: ResourceChangeNotification) => {
      if (!signal.aborted) onChange(event);
    };
    const reconcile = () => invalidate({ type: "Update", object: topicUrl });
    subscription.on("change", invalidate);
    subscription.on("resync", reconcile);
    let connected = subscription.state === "live";
    if (connected) reconcile();
    subscription.on("state", (state) => {
      if (state === "live" && !connected) {
        connected = true;
        reconcile();
      }
    });
    return stop;
  } catch {
    stop();
    return stop;
  }
}
