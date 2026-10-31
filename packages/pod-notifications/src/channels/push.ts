// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient, type PodClientOptions } from "@jeswr/storage-client";
import { createChangeNormalizer } from "../normalise.js";
import { isOnline, platform, systemTimers } from "../runtime.js";
import { SubscriptionController } from "../subscription.js";
import type { EventSourceLike, NotificationsDependencies, WebSocketLike } from "../types.js";
import { channelUrl, validateChannelUrl } from "./channel-url.js";
import { readJsonLines } from "./json-lines.js";

/** Dependencies and scoped topics for the push adapters. */
export interface PushChannelOptions extends NotificationsDependencies {
  topics: readonly string[];
  signal?: AbortSignal;
}

/** Full jitter with the ADR's one-second floor; the exponential ceiling saturates at 60 s. */
export function reconnectDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
  return Math.max(1_000, random() * ceiling);
}

// Each discovery gets a fresh cache, shared only between createPodClient's resolve/probe
// calls. Reconnect must not reuse a still-fresh description from a previous channel.
function discoveryCache(): NonNullable<PodClientOptions["capabilities"]> {
  type Cache = NonNullable<PodClientOptions["capabilities"]>;
  const records = new Map<string, Awaited<ReturnType<Cache["get"]>>>();
  let prefix: { root: string; id: string } | undefined;
  return {
    get: async (id) => records.get(id),
    set: async (id, value) => {
      records.set(id, value);
    },
    delete: async (id) => {
      records.delete(id);
    },
    rememberPrefix: async (root, id) => {
      prefix = { root, id };
    },
    lookupPrefix: async (url) => (url.startsWith(prefix?.root ?? "\0") ? prefix?.id : undefined),
  };
}

/** Shared one-shot channel lifecycle. A failed member reconnects the whole subscription. */
export function createPushChannel(
  options: PushChannelOptions,
  protocol: "solid" | "lws",
  transport: "websocket" | "sse" | "legacy-ws",
): SubscriptionController {
  const { storage } = options;
  if (
    storage.protocol !== protocol ||
    options.topics.length === 0 ||
    options.topics.some((topic) => {
      channelUrl(topic);
      return !storage.isWithinStorage(topic);
    })
  )
    throw new TypeError("Push topics must belong to the selected storage protocol");
  const subscription = new SubscriptionController(options.topics);
  subscription.channel = transport;
  const timers = options.timers ?? systemTimers;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const socketFactory: (url: string, protocols?: string[]) => WebSocketLike =
    options.socketFactory ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols));
  const eventSourceFactory: (url: string) => EventSourceLike =
    options.eventSourceFactory ?? ((url: string) => new EventSource(url));
  const insecure = options.allowInsecureLoopback === true;
  const validate = (url: unknown, service?: string, socket = false) =>
    validateChannelUrl(url, storage.root, service, socket, insecure);
  let stopped = false;
  let retry: unknown;
  let active: AbortController | undefined;
  let attempt = 0;
  let interrupted = false;
  let lastFrame = new Date(now());
  let storageId: string | undefined;
  let normalise: ReturnType<typeof createChangeNormalizer>;
  const sockets = new Map<EventSourceLike, () => void>();
  const frameTimes = new Map<object, number>();
  const streams = new Set<{ close(): void }>();
  const deletions = new Set<Promise<void>>();
  const subscriptions = new Set<string>();

  const removeSubscription = (url: string) => {
    const pending = (async () => {
      try {
        await options.fetch(url, { method: "DELETE", redirect: "error" });
      } catch {
        // Subscription expiry is the fallback when best-effort deletion fails.
      }
    })();
    deletions.add(pending);
    void pending.then(() => deletions.delete(pending));
  };
  const clearRetry = () => {
    if (retry !== undefined) timers.clearTimeout(retry);
    retry = undefined;
  };
  const disconnect = () => {
    // A healthy topic must not advance the resync boundary past a silent sibling.
    // Preserve the first gap's boundary through partially successful reconnects.
    if (!interrupted && frameTimes.size > 0) {
      let earliest = Infinity;
      for (const time of frameTimes.values()) earliest = Math.min(earliest, time);
      lastFrame = new Date(earliest);
    }
    frameTimes.clear();
    active?.abort();
    active = undefined;
    for (const cleanup of sockets.values()) cleanup();
    sockets.clear();
    for (const stream of streams) stream.close();
    streams.clear();
    for (const url of subscriptions) removeSubscription(url);
    subscriptions.clear();
  };
  const schedule = (delay: number) => {
    if (stopped) return;
    clearRetry();
    retry = timers.setTimeout(() => {
      retry = undefined;
      return connect();
    }, delay);
  };
  const fail = () => {
    disconnect();
    interrupted = true;
    subscription.transition("degraded", "reconnecting");
    if (isOnline()) schedule(reconnectDelay(attempt++, random));
  };
  const connect = async () => {
    if (stopped || !isOnline()) return;
    const request = new AbortController();
    active = request;
    const current = () => !stopped && active === request && !request.signal.aborted;
    // Validate all discovery HTTP requests, forbid redirects and observe 403 even if
    // the resolver wraps the response as a capabilities error.
    const fetch: typeof globalThis.fetch = async (input, init) => {
      request.signal.throwIfAborted();
      validate(input instanceof Request ? input.url : String(input));
      const response = await options.fetch(input, {
        ...init,
        redirect: "error",
        cache: "no-cache",
        signal: request.signal,
      });
      if (response.status === 403 && current()) {
        subscription.transition("closed", "forbidden");
        void subscription.close();
      }
      if (response.redirected) throw new Error("Notification redirect refused");
      return response;
    };
    try {
      const pod = await createPodClient({
        storage: storage.root,
        fetch,
        capabilities: discoveryCache(),
        signal: request.signal,
        clock: now,
      });
      if (!current()) return;
      const live = pod.features.liveUpdates;
      if (
        pod.description.protocol !== protocol ||
        pod.description.root !== storage.root ||
        live.state !== "available" ||
        !live.detail.channels.includes(transport)
      )
        throw new Error("No notification subscription service");
      // The feature endpoint belongs to the preferred channel, which may be WebSocket.
      // SSE adapters must resolve their own service again on every discovery.
      const serviceEndpoint =
        transport === "sse"
          ? pod.description.services.find((service) => {
              if (protocol === "solid") {
                const channels = [
                  service.extra["http://www.w3.org/ns/solid/notifications#channelType"],
                ].flat();
                return (
                  service.type.includes("https://jeswr.org/ns/solid-sd#SolidNotificationService") &&
                  (channels.includes(
                    "http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023",
                  ) ||
                    channels.includes("https://jeswr.org/ns/solid-sd#StreamingHttpChannel"))
                );
              }
              return (
                service.type.includes("https://www.w3.org/ns/lws#NotificationService") &&
                new URL(service.endpoint).origin === new URL(storage.root).origin &&
                [
                  "subscriptionType",
                  "ssd:subscriptionType",
                  "https://jeswr.org/ns/solid-sd#subscriptionType",
                  "https://www.w3.org/ns/lws#subscriptionType",
                ].some((key) =>
                  [service.extra[key]]
                    .flat()
                    .includes("https://jeswr.org/ns/solid-sd#SseSubscription"),
                )
              );
            })?.endpoint
          : live.detail.endpoint;
      const endpoint =
        transport === "legacy-ws"
          ? validate(serviceEndpoint, storage.root, true)
          : validate(serviceEndpoint);
      if (storageId !== pod.description.id) {
        storageId = pod.description.id;
        normalise = createChangeNormalizer({
          storageId,
          isWithinStorage: (url) => storage.isWithinStorage(url),
          via: transport,
          now,
        });
      }
      const groups =
        protocol === "lws" || transport === "legacy-ws"
          ? [subscription.topics]
          : subscription.topics.map((topic) => [topic]);
      let opened = 0;
      const ready = () => {
        if (opened !== groups.length) return;
        attempt = 0;
        subscription.transition("live");
        if (current() && interrupted) {
          interrupted = false;
          subscription.resync(lastFrame);
        }
      };
      for (const topics of groups) {
        const body =
          protocol === "lws"
            ? {
                "@context": ["https://www.w3.org/ns/lws/v1"],
                type: `https://jeswr.org/ns/solid-sd#${transport === "sse" ? "Sse" : "WebSocket"}Subscription`,
                topic: topics,
                expires: new Date(now() + 86_400_000).toISOString(),
              }
            : {
                "@context": ["https://www.w3.org/ns/solid/notifications-context/v1"],
                type: `http://www.w3.org/ns/solid/notifications#${transport === "sse" ? "StreamingHTTP" : "WebSocket"}Channel2023`,
                topic: topics[0],
              };
        let receiveFrom = endpoint;
        if (transport !== "legacy-ws") {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": protocol === "lws" ? "application/lws+json" : "application/ld+json",
              accept: protocol === "lws" ? "application/lws+json" : "application/ld+json",
            },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error("Notification subscription failed");
          const channel: unknown = await response.json();
          if (typeof channel !== "object" || channel === null || Array.isArray(channel))
            throw new Error("Invalid notification channel");
          if (protocol === "lws" && "subscription" in channel) {
            const url = validate(channel.subscription, endpoint);
            if (current()) subscriptions.add(url);
            else removeSubscription(url);
          }
          if (!current()) return;
          receiveFrom = validate(
            "receiveFrom" in channel ? channel.receiveFrom : undefined,
            endpoint,
            transport === "websocket",
          );
        }
        if (transport === "sse" && protocol === "solid") {
          const response = await fetch(receiveFrom, { headers: { accept: "application/ld+json" } });
          if (!current()) {
            await response.body?.cancel();
            return;
          }
          if (!response.ok || !response.body) throw new Error("Notification stream failed");
          const reader = response.body.getReader();
          // Register cancellation before publishing live; observers may close synchronously.
          const stream = {
            close: () => {
              void reader.cancel().catch(() => {});
            },
          };
          streams.add(stream);
          frameTimes.set(stream, now());
          opened++;
          ready();
          void readJsonLines(reader, current, (frame) => {
            frameTimes.set(stream, now());
            for (const change of normalise(frame)) subscription.change(change);
          }).then(
            () => {
              if (current()) fail();
            },
            () => {
              if (current()) fail();
            },
          );
          continue;
        }
        const socket =
          transport === "sse"
            ? eventSourceFactory(receiveFrom)
            : socketFactory(receiveFrom, transport === "legacy-ws" ? ["solid-0.1"] : undefined);
        frameTimes.set(socket, now());
        let heartbeat: unknown;
        let open = false;
        const clearHeartbeat = () => {
          if (heartbeat !== undefined) timers.clearTimeout(heartbeat);
        };
        const armHeartbeat = () => {
          if (transport === "sse") return;
          clearHeartbeat();
          heartbeat = timers.setTimeout(onFailure, 90_000);
        };
        const onFailure = () => {
          if (current()) fail();
        };
        const onError = () => {
          if (!current()) return;
          // Keep the same EventSource while it reconnects: the browser retains its
          // last-event-id buffer and sends Last-Event-ID, including empty-id resets.
          if (transport === "sse" && socket.readyState === 0) {
            if (open) {
              open = false;
              opened--;
            }
            if (!interrupted) lastFrame = new Date(frameTimes.get(socket) as number);
            interrupted = true;
            subscription.transition("degraded", "reconnecting");
          } else onFailure();
        };
        const onOpen = () => {
          if (!current() || open) return;
          open = true;
          opened++;
          armHeartbeat();
          if (transport === "legacy-ws") {
            try {
              for (const topic of topics) (socket as WebSocketLike).send(`sub ${topic}`);
            } catch {
              fail();
              return;
            }
          }
          ready();
        };
        const onMessage = (event: { data: unknown }) => {
          if (!current() || !open) return;
          frameTimes.set(socket, now());
          armHeartbeat();
          if (typeof event.data !== "string") return;
          if (transport === "legacy-ws") {
            const match = /^pub (\S+)$/u.exec(event.data);
            if (match && topics.includes(match[1] as string)) {
              for (const change of normalise({ type: "Update", object: match[1] })) {
                change.raw = event.data;
                subscription.change(change);
              }
            }
            return;
          }
          let frame: unknown;
          try {
            frame = JSON.parse(event.data);
          } catch {
            return;
          }
          for (const change of normalise(frame)) subscription.change(change);
        };
        socket.addEventListener("open", onOpen);
        socket.addEventListener("message", onMessage);
        if (transport === "sse") socket.addEventListener("notification", onMessage);
        socket.addEventListener("error", onError);
        socket.addEventListener("close", onFailure);
        sockets.set(socket, () => {
          clearHeartbeat();
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("message", onMessage);
          if (transport === "sse") socket.removeEventListener("notification", onMessage);
          socket.removeEventListener("error", onError);
          socket.removeEventListener("close", onFailure);
          try {
            socket.close();
          } catch {
            /* Detached first: close errors cannot prevent cleanup. */
          }
        });
        armHeartbeat();
      }
    } catch {
      if (current()) fail();
    }
  };
  const offline = () => {
    clearRetry();
    disconnect();
    interrupted = true;
    subscription.transition("degraded", "offline");
  };
  const online = () => {
    if (!active) schedule(0);
  };
  const abort = () => {
    void subscription.close();
  };
  subscription.cleanup = () => {
    stopped = true;
    clearRetry();
    disconnect();
    platform.removeEventListener?.("offline", offline);
    platform.removeEventListener?.("online", online);
    options.signal?.removeEventListener("abort", abort);
    return Promise.all(deletions).then(() => {});
  };
  platform.addEventListener?.("offline", offline);
  platform.addEventListener?.("online", online);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  else if (isOnline()) schedule(0);
  else offline();
  return subscription;
}
