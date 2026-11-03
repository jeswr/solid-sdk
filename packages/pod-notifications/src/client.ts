// AUTHORED-BY Codex GPT-6.1-Sol

import { createLegacyWebSocketChannel } from "./channels/legacy-ws.js";
import { createLwsSseChannel } from "./channels/lws-sse.js";
import { createLwsWebSocketChannel } from "./channels/lws-websocket.js";
import { createPollChannel } from "./channels/poll.js";
import { createStreamingHttpChannel } from "./channels/streaming-http.js";
import { createWebhookRelayChannel } from "./channels/webhook-relay.js";
import { createWebSocket2023Channel } from "./channels/websocket2023.js";
import { systemTimers } from "./runtime.js";
import { SubscriptionController } from "./subscription.js";
import type { NotificationPlan, NotificationsClient, NotificationsDependencies } from "./types.js";

/**
 * Create the ADR-005 client. plan() reports advertised transport preference without I/O.
 * Push channels rediscover services, including registered webhook relay inboxes.
 */
export function createNotifications(deps: NotificationsDependencies): NotificationsClient {
  const client: NotificationsClient = {
    plan(): NotificationPlan {
      const live = deps.storage.features.liveUpdates;
      if (live.state === "available") {
        for (const channel of ["websocket", "sse", "webhook", "legacy-ws"] as const) {
          if (!live.detail.channels.includes(channel)) continue;
          if (channel === "webhook") {
            if (deps.storage.protocol !== "lws" || !deps.relay) continue;
            return {
              channel: "webhook-relay",
              reason: "LWS webhook service with configured relay",
            };
          }
          return { channel, reason: `Storage advertises ${channel}` };
        }
      }
      return {
        channel: "poll",
        reason: "No usable push channel; polling every 30000 ms by default",
      };
    },
    async subscribe(topics, options = {}) {
      options.signal?.throwIfAborted();
      const intervalMs = options.pollIntervalMs ?? 30_000;
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 2_147_483_647) {
        throw new TypeError("pollIntervalMs must be an integer from 0 to 2147483647");
      }
      const all = [...new Set([...topics, ...(options.hot ?? [])])];
      if (all.length === 0 || all.some((topic) => !deps.storage.isWithinStorage(topic))) {
        throw new TypeError("Notification topics must be nonempty and within the storage");
      }
      if (
        options.depth !== undefined &&
        !["resource", "members", "recursive"].includes(options.depth)
      ) {
        throw new TypeError("Unsupported notification depth");
      }
      if (client.plan().channel === "websocket") {
        const create =
          deps.storage.protocol === "lws" ? createLwsWebSocketChannel : createWebSocket2023Channel;
        return create({ ...deps, topics: all, signal: options.signal });
      }
      if (client.plan().channel === "sse") {
        const create =
          deps.storage.protocol === "lws" ? createLwsSseChannel : createStreamingHttpChannel;
        return create({ ...deps, topics: all, signal: options.signal });
      }
      if (client.plan().channel === "webhook-relay") {
        return createWebhookRelayChannel({ ...deps, topics: all, signal: options.signal });
      }
      if (client.plan().channel === "legacy-ws") {
        return createLegacyWebSocketChannel({ ...deps, topics: all, signal: options.signal });
      }
      if (intervalMs === 0) {
        const subscription = new SubscriptionController(all);
        subscription.transition("degraded", "polling-disabled");
        const abort = () => {
          void subscription.close();
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        subscription.cleanup = () => options.signal?.removeEventListener("abort", abort);
        return subscription;
      }
      return createPollChannel({
        storage: deps.storage,
        topics: all,
        intervalMs,
        timers: deps.timers ?? systemTimers,
        now: deps.now ?? Date.now,
        signal: options.signal,
      });
    },
  };
  return client;
}
