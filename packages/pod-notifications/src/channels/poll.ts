// AUTHORED-BY Codex GPT-6.1-Sol
import type { Entry, StorageClient } from "@jeswr/storage-client";
import { isOnline, platform } from "../runtime.js";
import { SubscriptionController } from "../subscription.js";
import type { ChangeEvent, Timers } from "../types.js";

/** Dependencies for the polling channel; all storage I/O uses the public storage API. */
export interface PollChannelOptions {
  storage: StorageClient;
  topics: readonly string[];
  intervalMs: number;
  timers: Timers;
  now: () => number;
  signal?: AbortSignal;
}

interface Snapshot {
  etag: string | null;
  members: Map<string, Entry>;
}

/**
 * Start a non-overlapping HEAD/listAll loop. First observations establish a quiet baseline.
 * Container diffs commit only after all pages succeed. Offline/close abort in-flight work;
 * resuming online reconciles immediately. Containers cover membership, hot topics cover edits.
 */
export function createPollChannel(options: PollChannelOptions): SubscriptionController {
  const subscription = new SubscriptionController(options.topics);
  subscription.channel = "poll";
  const snapshots = new Map<string, Snapshot>();
  let timer: unknown;
  let active: AbortController | undefined;
  let stopped = false;
  let resume = false;
  let offlineSince: Date | undefined;
  let sequence = 0;

  const clear = () => {
    if (timer !== undefined) options.timers.clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delay: number) => {
    if (stopped) return;
    clear();
    timer = options.timers.setTimeout(() => {
      timer = undefined;
      return poll();
    }, delay);
  };
  const emit = (
    type: ChangeEvent["type"],
    object: string,
    objectKind: ChangeEvent["objectKind"],
    raw: unknown,
    extra: Partial<ChangeEvent>,
  ) => {
    subscription.change({
      type,
      object,
      objectKind,
      raw,
      published: new Date(options.now()),
      id: `poll:${++sequence}`,
      via: "poll",
      ...extra,
    });
  };
  const poll = async () => {
    if (stopped || !isOnline()) return;
    const request = new AbortController();
    let reconciled = true;
    active = request;
    subscription.transition("degraded", "polling");
    try {
      for (const topic of options.topics) {
        if (request.signal.aborted) break;
        try {
          const head = await options.storage.head(topic, {
            signal: request.signal,
            revalidate: true,
          });
          request.signal.throwIfAborted();
          const members = new Map<string, Entry>();
          if (head.kind === "container") {
            for await (const entry of options.storage.listAll(topic, {
              signal: request.signal,
              revalidate: true,
            })) {
              request.signal.throwIfAborted();
              if (options.storage.isWithinStorage(entry.url)) members.set(entry.url, entry);
            }
          }
          request.signal.throwIfAborted();
          const previous = snapshots.get(topic);
          snapshots.set(topic, { etag: head.etag, members });
          if (!previous) continue;
          if (head.etag !== null && previous.etag !== null && head.etag !== previous.etag) {
            emit("Update", topic, head.kind, head, { state: head.etag });
          }
          for (const [url, entry] of members) {
            if (!previous.members.has(url))
              emit("Create", url, entry.kind, entry, { target: topic });
          }
          for (const [url, entry] of previous.members) {
            if (!members.has(url)) emit("Delete", url, entry.kind, entry, { origin: topic });
          }
        } catch (error) {
          reconciled = false;
          if (request.signal.aborted) break;
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "forbidden"
          ) {
            subscription.transition("closed", "forbidden");
            await subscription.close();
            break;
          }
          subscription.transition("degraded", "poll-failed");
        }
      }
    } finally {
      active = undefined;
      if (!stopped && isOnline()) {
        if (offlineSince && !request.signal.aborted && reconciled) {
          subscription.resync(offlineSince);
          offlineSince = undefined;
        }
        schedule(resume ? 0 : options.intervalMs);
        resume = false;
      }
    }
  };
  const offline = () => {
    offlineSince = new Date(options.now());
    clear();
    active?.abort();
    subscription.transition("degraded", "offline");
  };
  const online = () => {
    if (active) resume = true;
    else schedule(0);
  };
  const abort = () => {
    void subscription.close();
  };
  subscription.cleanup = () => {
    stopped = true;
    clear();
    active?.abort();
    snapshots.clear();
    platform.removeEventListener?.("offline", offline);
    platform.removeEventListener?.("online", online);
    options.signal?.removeEventListener("abort", abort);
  };
  platform.addEventListener?.("offline", offline);
  platform.addEventListener?.("online", online);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  else if (isOnline()) schedule(0);
  else offline();
  return subscription;
}
