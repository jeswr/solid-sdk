// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient, type PodClient } from "@jeswr/storage-client";
import { channelUrl, validateChannelUrl } from "./channels/channel-url.js";
import { createPollChannel } from "./channels/poll.js";
import { createPushChannel, discoveryCache } from "./channels/push.js";
import { createNotifications } from "./client.js";
import { isOnline, systemTimers } from "./runtime.js";
import type { ChangeEvent, NotificationsDependencies, Subscription } from "./types.js";

/** A change or a synthetic Update hint covering setup, reconnects or unresolved storage. */
export type Invalidation = Pick<ChangeEvent, "type" | "object">;

/** Scope is caller-owned and receives HTTP(S) equivalents of WS(S) destinations. */
export interface WatchInvalidationsOptions
  extends Omit<NotificationsDependencies, "storage" | "relay"> {
  topics: readonly string[];
  scope: (url: string) => boolean;
  onInvalidate: (event: Invalidation) => void;
  /** Discovery hint; defaults to the first topic. Does not grant destination scope. */
  storage?: string;
  /** Disable push for resources outside the application's trusted storage roots. */
  push?: boolean;
  /** Default 30 seconds; zero disables all polling fallbacks. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/** Own this handle immediately, including while discovery is pending. */
export interface InvalidationWatch {
  /** Resolves after setup, rejects invalid arguments; transport failures fall back to polling. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * Watch scoped resources with one discovery and a shared first-live/resync policy.
 * Unusable push switches permanently to SDK polling. If discovery itself fails,
 * periodic full-refresh hints let already-readable resources continue to update.
 */
export function watchInvalidations(options: WatchInvalidationsOptions): InvalidationWatch {
  const abort = new AbortController();
  const timers = options.timers ?? systemTimers;
  const interval = options.pollIntervalMs ?? 30_000;
  const topics = [...new Set(options.topics)];
  let subscription: Subscription | undefined;
  let refreshTimer: unknown;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      options.signal?.removeEventListener("abort", onAbort);
      abort.abort();
      if (refreshTimer !== undefined) timers.clearTimeout(refreshTimer);
      closing = subscription?.close() ?? Promise.resolve();
    }
    return closing;
  };
  const onAbort = () => {
    void close().catch(() => {});
  };
  const invalidate = (event: Invalidation) => {
    if (abort.signal.aborted) return;
    try {
      if (options.scope(event.object)) options.onInvalidate(event);
    } catch {
      // Consumer failures cannot stop polling or cleanup.
    }
  };
  const reconcile = () => {
    for (const topic of topics) invalidate({ type: "Update", object: topic });
  };
  const observe = (next: Subscription) => {
    subscription = next;
    next.on("change", invalidate);
    next.on("resync", reconcile);
    let live = next.state === "live";
    if (live) reconcile();
    next.on("state", (state) => {
      if (state === "live" && !live) {
        live = true;
        reconcile();
      }
    });
  };
  const refreshWithoutDiscovery = () => {
    if (abort.signal.aborted || interval === 0) return;
    refreshTimer = timers.setTimeout(() => {
      if (abort.signal.aborted) return;
      if (isOnline()) reconcile();
      refreshWithoutDiscovery();
    }, interval);
  };
  const ready = (async () => {
    if (options.signal?.aborted) {
      await close();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (!Number.isSafeInteger(interval) || interval < 0 || interval > 2_147_483_647)
      throw new TypeError("pollIntervalMs must be an integer from 0 to 2147483647");
    if (topics.length === 0) throw new TypeError("Notification topics must be nonempty");
    const root = options.storage ?? (topics[0] as string);
    const scopedUrl = (value: string) => {
      const url = channelUrl(value);
      const http = url.href.replace(/^ws/u, "http");
      if (!options.scope(http)) throw new TypeError("Notification endpoint outside caller scope");
      return url.href;
    };
    for (const url of [root, ...topics]) {
      scopedUrl(
        validateChannelUrl(url, root, undefined, false, options.allowInsecureLoopback === true),
      );
    }
    const boundedFetch: typeof fetch = async (input, init) => {
      const url = scopedUrl(input instanceof Request ? input.url : String(input));
      validateChannelUrl(url, root, undefined, false, options.allowInsecureLoopback === true);
      // Deletion must remain possible after aborting discovery and live transports.
      const deleting = init?.method === "DELETE";
      if (!deleting) abort.signal.throwIfAborted();
      const response = await options.fetch(input, {
        ...init,
        redirect: "error",
        ...(!deleting
          ? { signal: init?.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal }
          : {}),
      });
      if (response.redirected) throw new TypeError("Notification redirect refused");
      // A 403 on a watched topic, a subscription or a poll ends the watch. During discovery,
      // a 403 on an ancestor or description probe (a shared tracker inside an unshared pod)
      // only means discovery failed, so refresh hints keep the readable topics current.
      if (!deleting && response.status === 403 && (!discovering || topicHrefs.has(url)))
        await close();
      return response;
    };
    const topicHrefs = new Set(topics.map((topic) => new URL(topic).href));
    let discovering = true;
    let pod: PodClient;
    try {
      pod = await createPodClient({
        storage: root,
        fetch: boundedFetch,
        capabilities: discoveryCache(),
        signal: abort.signal,
      });
    } catch {
      refreshWithoutDiscovery();
      return;
    } finally {
      discovering = false;
    }
    if (abort.signal.aborted) return;
    // A server's claimed storage boundary never grants access beyond caller scope.
    if (
      !options.scope(pod.storage.root) ||
      topics.some((topic) => !pod.storage.isWithinStorage(topic))
    ) {
      refreshWithoutDiscovery();
      return;
    }
    const deps = { ...options, fetch: boundedFetch, storage: pod.storage };
    const notifications = createNotifications(deps);
    const plan = notifications.plan().channel;
    const poll = async () => {
      await subscription?.close();
      if (abort.signal.aborted || interval === 0) return;
      observe(
        createPollChannel({
          storage: pod.storage,
          topics,
          intervalMs: interval,
          signal: abort.signal,
          timers,
          now: options.now ?? Date.now,
        }),
      );
    };
    if (
      options.push === false ||
      plan === "poll" ||
      ((plan === "websocket" || plan === "legacy-ws") &&
        !options.socketFactory &&
        typeof globalThis.WebSocket !== "function") ||
      (plan === "sse" &&
        pod.storage.protocol === "lws" &&
        !options.eventSourceFactory &&
        typeof globalThis.EventSource !== "function")
    ) {
      await poll();
    } else {
      observe(
        createPushChannel(
          {
            ...deps,
            topics,
            signal: abort.signal,
            initialPod: pod,
            scope: options.scope,
            onUnavailable: () => {
              void poll().catch(() => {
                refreshWithoutDiscovery();
              });
            },
          },
          pod.storage.protocol,
          plan as "websocket" | "sse" | "legacy-ws",
        ),
      );
    }
  })().catch(async (error: unknown) => {
    await close();
    throw error;
  });
  return { ready, close };
}
