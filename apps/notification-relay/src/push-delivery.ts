// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { type ApnsMessage, buildApnsMessage } from "./apns.js";
import { buildFcmMessage, type FcmMessage } from "./fcm.js";
import { encryptPayload } from "./push-crypto.js";
import type { PushInvalidation, PushPayload, PushSink } from "./push-payload.js";
import type { Installation } from "./push-state.js";

export interface TransportResult {
  status: number;
  reason?: string;
  retryAfter?: string;
  /** APNs invalidation time in milliseconds since the Unix epoch. */
  timestamp?: number;
}
export interface PushTransport<Message = FcmMessage | ApnsMessage> {
  send(message: Message): Promise<TransportResult>;
  close?(): void;
}
export type PushPlatform = Installation["platform"];
export interface DeliveryOutcome {
  id: string;
  kind: PushPayload["kind"];
  outcome: string;
}
export interface DeliveryOptions {
  fcm?: PushTransport<FcmMessage>;
  apns?: PushTransport<ApnsMessage>;
  bundleId?: string;
  onInvalid?: (invalidation: PushInvalidation) => void | Promise<void>;
  onAlert?: (platform: PushPlatform) => void | Promise<void>;
  onOutcome?: (entry: DeliveryOutcome) => void;
  /** Return a cancellation function. The callback must run asynchronously. */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  maxPending?: number;
  maxConcurrent?: number;
}
type Job = {
  order: number;
  installation: Installation;
  payload: PushPayload;
  attempts: number;
  due: number;
  expiresAt: number;
  inFlight: boolean;
  topic?: string;
  message: FcmMessage | ApnsMessage;
};
const minute = 60_000;
const hour = 60 * minute;
const maxDelay = 5 * minute;

function defaultSchedule(fn: () => void, ms: number) {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return () => clearTimeout(timer);
}

/** Only exponential backoff is capped. Provider Retry-After always remains a minimum. */
export function retryDelay(
  attempt: number,
  retryAfter: string | undefined,
  now: number,
  base = 1000,
): number {
  const backoff = Math.min(base * 2 ** (attempt - 1), maxDelay);
  if (retryAfter === undefined) return backoff;
  const delay = /^\d+$/u.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - now;
  return Number.isNaN(delay) ? backoff : Math.max(backoff, delay);
}

/**
 * send accepts work without waiting for the provider. Mutable options.onInvalid is the
 * composition seam: set it to push.invalidate after constructing the routes. Invalidation
 * always carries the snapshot tokenVersion, never a later installation's version.
 */
export function createDeliverySink(options: DeliveryOptions) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  const limit = options.maxPending ?? 10_000;
  const concurrency = options.maxConcurrent ?? 100;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1
  )
    throw new Error("Invalid push queue capacity");
  if (options.apns && !options.bundleId) throw new Error("APNs bundle id required");
  const callbacks = {
    ...options,
    onInvalid: options.onInvalid ?? (() => {}),
  };
  const log =
    options.onOutcome ?? ((entry: DeliveryOutcome) => console.info("push-delivery", entry));
  const jobs = new Set<Job>();
  const topics = new Map<string, Job>();
  // At most limit registrations, each with at most 60 provider-attempt timestamps.
  const history = new Map<string, number[]>();
  const paused = new Set<PushPlatform>();
  let closed = false;
  let running = 0;
  let sequence = 0;
  let cancel: (() => void) | undefined;
  function outcome(job: Job, value: string) {
    log({ id: job.payload.id, kind: job.payload.kind, outcome: value });
  }
  function forget(job: Job) {
    jobs.delete(job);
    if (job.topic !== undefined) topics.delete(job.topic);
  }
  function drop(job: Job, value: string) {
    forget(job);
    outcome(job, value);
  }
  function allowed(job: Job, at: number): number {
    if (job.payload.kind === "challenge") return at;
    const times = history.get(job.payload.registrationId) ?? [];
    const perMinute = times.length >= 10 ? (times[times.length - 10] as number) + minute : at;
    const perHour = times.length >= 60 ? (times[0] as number) + hour : at;
    return Math.max(at, perMinute, perHour);
  }
  function pump() {
    cancel?.();
    cancel = undefined;
    if (closed) return;
    const at = now();
    for (const [id, times] of history) {
      const live = times.filter((time) => time > at - hour);
      if (live.length) history.set(id, live);
      else history.delete(id);
    }
    let next = Number.POSITIVE_INFINITY;
    for (const job of jobs) {
      if (job.inFlight) continue;
      if (at >= job.expiresAt) {
        drop(job, "expired");
        continue;
      }
      const due = Math.max(job.due, allowed(job, at));
      if (due > at) {
        next = Math.min(next, due, job.expiresAt);
        continue;
      }
      if (running >= concurrency) continue;
      if (job.payload.kind !== "challenge") {
        const id = job.payload.registrationId;
        if (!history.has(id) && history.size >= limit) {
          drop(job, "rate-capacity");
          continue;
        }
        const times = history.get(id) ?? [];
        times.push(at);
        history.set(id, times);
      }
      if (job.topic !== undefined) {
        topics.delete(job.topic);
        job.topic = undefined;
      }
      job.inFlight = true;
      running++;
      void attempt(job);
    }
    if (Number.isFinite(next)) cancel = schedule(pump, Math.max(0, next - at));
  }
  async function attempt(job: Job) {
    job.attempts++;
    const platform = job.installation.platform;
    let result: TransportResult;
    try {
      result =
        platform === "android"
          ? await (options.fcm as PushTransport<FcmMessage>).send(job.message as FcmMessage)
          : await (options.apns as PushTransport<ApnsMessage>).send(job.message as ApnsMessage);
    } catch {
      result = { status: 503 };
    }
    if (closed) {
      running--;
      job.inFlight = false;
      return;
    }
    if (result.status >= 200 && result.status < 300) drop(job, "delivered");
    else if (
      (platform === "android" && (result.status === 404 || result.reason === "UNREGISTERED")) ||
      (platform === "ios" && result.status === 410)
    ) {
      drop(job, "invalid-token");
      try {
        await callbacks.onInvalid({
          installationId: job.installation.installationId,
          tokenVersion: job.installation.tokenVersion,
          ...(platform === "ios" && result.timestamp !== undefined
            ? { providerTimestamp: result.timestamp }
            : {}),
        });
      } catch {
        outcome(job, "invalidation-failed");
      }
    } else if (
      result.status === 401 ||
      // FCM's SENDER_ID_MISMATCH is a per-token 403: a device-supplied foreign token must not
      // pause delivery for everyone, so it falls through to a permanent drop.
      (result.status === 403 && result.reason !== "SENDER_ID_MISMATCH")
    ) {
      const first = !paused.has(platform);
      paused.add(platform);
      drop(job, "paused");
      for (const pending of jobs)
        if (!pending.inFlight && pending.installation.platform === platform)
          drop(pending, "paused");
      if (first) {
        try {
          await callbacks.onAlert?.(platform);
        } catch {
          outcome(job, "alert-failed");
        }
      }
    } else if (result.status === 429 || result.status >= 500) {
      if (paused.has(platform)) drop(job, "paused");
      else if (job.attempts >= 6) drop(job, "exhausted");
      else {
        const at = now();
        job.due =
          at +
          retryDelay(
            job.attempts,
            result.retryAfter,
            at,
            platform === "android" && result.status === 429 ? minute : 1000,
          );
        if (job.due >= job.expiresAt) drop(job, "expired");
        else if (job.payload.kind !== "challenge") {
          const topic = JSON.stringify([job.payload.registrationId, job.payload.topicIndex]);
          const pending = topics.get(topic);
          if (pending && pending.order > job.order) drop(job, "coalesced");
          else {
            if (pending) drop(pending, "coalesced");
            job.topic = topic;
            topics.set(topic, job);
          }
        }
        if (jobs.has(job)) outcome(job, "retry");
      }
    } else drop(job, "permanent-error");
    // Invalidation/alert callbacks occupy a concurrency slot too, so delayed storage
    // or alerting cannot create an unbounded collection of detached promises.
    running--;
    job.inFlight = false;
    pump();
  }
  const sink: PushSink = {
    async send(installation, payload) {
      const acceptedAt = now();
      const platform = installation.platform;
      if (closed || paused.has(platform)) throw new Error("Push sink unavailable");
      if (platform === "android" ? !options.fcm : !options.apns)
        throw new Error("Push platform not configured");
      const snapshot = { ...installation };
      let message: FcmMessage | ApnsMessage;
      try {
        const p = encryptPayload(payload, snapshot.devicePublicKey, snapshot.authSecret);
        message =
          platform === "android"
            ? buildFcmMessage(snapshot.pushToken, p)
            : buildApnsMessage(
                snapshot.pushToken,
                payload,
                p,
                options.bundleId as string,
                acceptedAt,
              );
      } catch {
        log({ id: payload.id, kind: payload.kind, outcome: "encryption-error" });
        return;
      }
      const topic =
        payload.kind === "challenge"
          ? undefined
          : JSON.stringify([payload.registrationId, payload.topicIndex]);
      const old = topic === undefined ? undefined : topics.get(topic);
      if (old) drop(old, "coalesced");
      const job: Job = {
        order: ++sequence,
        installation: snapshot,
        payload: { ...payload },
        message,
        attempts: 0,
        due: acceptedAt,
        expiresAt: acceptedAt + 24 * hour,
        inFlight: false,
        topic,
      };
      if (jobs.size >= limit) {
        const oldest = [...jobs].find((pending) => !pending.inFlight);
        if (oldest) drop(oldest, "overflow");
        else {
          outcome(job, "overflow");
          return;
        }
      }
      jobs.add(job);
      if (topic !== undefined) topics.set(topic, job);
      pump();
    },
  };
  return {
    ...sink,
    options: callbacks,
    resume(platform: PushPlatform) {
      paused.delete(platform);
    },
    close() {
      closed = true;
      cancel?.();
      jobs.clear();
      topics.clear();
      history.clear();
      options.fcm?.close?.();
      options.apns?.close?.();
    },
  };
}
