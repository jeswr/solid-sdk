// AUTHORED-BY Codex GPT-6.1-Sol
import { watchInvalidations } from "@jeswr/pod-notifications";
import { isOwnPodUrl } from "./own-pod";

/** Synchronous React cleanup; the SDK aborts pending setup and releases transports. */
export interface LiveSync {
  close(): void;
}

/** Own-pod policy and optional test transports for {@link watchContainer}. */
export interface WatchOptions {
  /** Unknown/collaborator roots disable push and retain periodic refreshes. */
  ownStorageUrls?: readonly string[];
  fetch?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
}

/** Refresh membership and watched edits, including setup and reconnect gaps. */
export function watchContainer(
  containerUrl: string,
  onChange: () => void,
  options: WatchOptions = {},
): LiveSync {
  const ownRoot = options.ownStorageUrls?.find((root) => isOwnPodUrl(containerUrl, [root]));
  const Ws = options.WebSocketImpl ?? globalThis.WebSocket;
  const watch = watchInvalidations({
    fetch: options.fetch ?? fetch,
    storage: ownRoot ?? containerUrl,
    topics: [containerUrl],
    scope: (url) => new URL(url).origin === new URL(containerUrl).origin,
    push: Boolean(ownRoot),
    onInvalidate: onChange,
    pollIntervalMs: 25_000,
    allowInsecureLoopback: process.env.NODE_ENV === "development",
    socketFactory:
      typeof Ws === "function" ? (url, protocols) => new Ws(url, protocols) : undefined,
  });
  void watch.ready.catch(() => {});
  return {
    close: () => {
      void watch.close().catch(() => {});
    },
  };
}
