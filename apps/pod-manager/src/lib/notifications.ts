// AUTHORED-BY Codex GPT-6.1-Sol
import { type Invalidation, watchInvalidations } from "@jeswr/pod-notifications";
import { allowInsecureLoopback } from "./auth-environment";

/** The view needs only an invalidation's verb and changed resource URL. */
export type ResourceChangeNotification = Invalidation;

/** Inject the session's bounded pod fetch; tests may also replace the socket. */
export interface SubscribeOptions {
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  signal?: AbortSignal;
}

/** Watch the active view, falling back to 30-second polling when push is unusable. */
export async function subscribeToResource(
  topicUrl: string,
  onChange: (n: ResourceChangeNotification) => void,
  opts: SubscribeOptions = {},
): Promise<() => void> {
  const WS = opts.webSocketImpl ?? globalThis.WebSocket;
  const watch = watchInvalidations({
    fetch: opts.fetchImpl ?? fetch,
    topics: [topicUrl],
    scope: (url) => new URL(url).origin === new URL(topicUrl).origin,
    onInvalidate: onChange,
    signal: opts.signal,
    pollIntervalMs: 30_000,
    allowInsecureLoopback: allowInsecureLoopback(),
    socketFactory:
      typeof WS === "function" ? (url, protocols) => new WS(url, protocols) : undefined,
  });
  await watch.ready.catch(() => {});
  return () => {
    void watch.close().catch(() => {});
  };
}
