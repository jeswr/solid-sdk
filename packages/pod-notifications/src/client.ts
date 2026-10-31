// AUTHORED-BY Codex GPT-6.1-Sol
import { createPollChannel } from "./channels/poll.js";
import { systemTimers } from "./runtime.js";
import { SubscriptionController } from "./subscription.js";
import type { NotificationPlan, NotificationsClient, NotificationsDependencies } from "./types.js";

/**
 * Create the ADR-005 client. plan() reports advertised transport preference without I/O.
 * T-040 runs the polling fallback; push channel implementations arrive in T-041/T-042.
 */
export function createNotifications(deps: NotificationsDependencies): NotificationsClient {
  return {
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
}
