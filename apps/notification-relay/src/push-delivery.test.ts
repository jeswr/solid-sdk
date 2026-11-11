// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, test, vi } from "vitest";
import { activity, challenge, decrypt, installation } from "../test/delivery-fixtures.js";
import { createFakeSinks } from "../test/fake-sinks.js";
import type { FcmMessage } from "./fcm.js";
import {
  createDeliverySink,
  type DeliveryOptions,
  retryDelay,
  type TransportResult,
} from "./push-delivery.js";

const active: ReturnType<typeof createDeliverySink>[] = [];
afterEach(() => {
  for (const sink of active.splice(0)) sink.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup(options: DeliveryOptions = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(activity.sentAt);
  const fake = createFakeSinks();
  const onInvalid = vi.fn();
  const onAlert = vi.fn();
  const onOutcome = vi.fn();
  const schedule = vi.fn((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  });
  const sink = createDeliverySink({
    ...fake,
    bundleId: "org.jeswr.suite",
    now: Date.now,
    schedule,
    onInvalid,
    onAlert,
    onOutcome,
    ...options,
  });
  active.push(sink);
  return { sink, fake, onInvalid, onAlert, onOutcome, schedule };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

test("delivers encrypted wire messages to each fake provider and keeps distinct topics", async () => {
  const { sink, fake, onOutcome } = setup();
  for (const payload of [activity, { ...activity, topicIndex: 4 }, challenge]) {
    await sink.send(installation, payload);
    await sink.send({ ...installation, platform: "ios" }, payload);
  }
  expect(fake.android).toHaveLength(3);
  expect(fake.ios).toHaveLength(3);
  for (const [index, payload] of [activity, { ...activity, topicIndex: 4 }, challenge].entries()) {
    for (const encoded of [fake.android[index]?.message.data.p, fake.ios[index]?.body.p])
      expect(
        JSON.parse(
          decrypt(encoded as string)
            .subarray(0, -1)
            .toString(),
        ),
      ).toEqual(payload);
  }
  expect(new Set(fake.ios.slice(0, 2).map((m) => m.headers["apns-collapse-id"])).size).toBe(2);
  expect(fake.ios[2]?.headers["apns-push-type"]).toBe("background");
  expect(onOutcome).toHaveBeenCalledTimes(6);
});

test("accepts the first attempt without waiting, snapshots the sent tokenVersion, and passes APNs timestamp", async () => {
  for (const platform of ["android", "ios"] as const) {
    let release!: (result: TransportResult) => void;
    const send = vi.fn(
      () =>
        new Promise<TransportResult>((resolve) => {
          release = resolve;
        }),
    );
    const { sink, onInvalid } = setup({ fcm: { send }, apns: { send } });
    const mutable = { ...installation, platform };
    await sink.send(mutable, challenge);
    expect(send).toHaveBeenCalledTimes(1);
    mutable.tokenVersion = 9;
    mutable.pushToken = "refreshed-token";
    release({ status: platform === "android" ? 404 : 410, timestamp: 123 });
    await flush();
    expect(onInvalid).toHaveBeenCalledWith({
      installationId: installation.installationId,
      tokenVersion: 1,
      ...(platform === "ios" ? { providerTimestamp: 123 } : {}),
    });
  }
});

test("maps invalid tokens and permanent payload failures without retries or sensitive logs", async () => {
  for (const result of [
    { status: 400 },
    { status: 422 },
    { status: 302 },
    { status: 400, reason: "UNREGISTERED" },
  ]) {
    const send = vi.fn(async () => result);
    const { sink, onInvalid, onOutcome, schedule } = setup({ fcm: { send } });
    await sink.send(installation, activity);
    await flush();
    expect(onInvalid).toHaveBeenCalledTimes(result.reason ? 1 : 0);
    expect(schedule).not.toHaveBeenCalled();
    expect(onOutcome).toHaveBeenCalledWith({
      id: activity.id,
      kind: "chat",
      outcome: result.reason ? "invalid-token" : "permanent-error",
    });
  }
  const { sink, onOutcome } = setup({
    apns: { send: async () => ({ status: 410 }) },
    onInvalid: async () => {
      throw new Error("store failed");
    },
  });
  await sink.send({ ...installation, platform: "ios" }, activity);
  await flush();
  expect(onOutcome).toHaveBeenLastCalledWith({
    id: activity.id,
    kind: "chat",
    outcome: "invalidation-failed",
  });
});

test("pauses only the platform with auth errors, alerts once, drains queued work, and resumes explicitly", async () => {
  for (const status of [401, 403]) {
    const send = vi.fn(async () => ({ status }));
    const { sink, onAlert, onOutcome, fake } = setup({ fcm: { send }, maxConcurrent: 1 });
    const first = sink.send(installation, challenge);
    const second = sink.send(installation, { ...activity, id: "queued" });
    await Promise.all([first, second]);
    await flush();
    expect(onOutcome).toHaveBeenCalledWith({ id: "queued", kind: "chat", outcome: "paused" });
    expect(onAlert).toHaveBeenCalledExactlyOnceWith("android");
    await expect(sink.send(installation, challenge)).rejects.toThrow("unavailable");
    await sink.send({ ...installation, platform: "ios" }, activity);
    expect(fake.ios).toHaveLength(1);
    send.mockResolvedValue({ status: 200 });
    sink.resume("android");
    await sink.send(installation, challenge);
    expect(send).toHaveBeenCalledTimes(2);
  }
});

test("drops an FCM per-token SENDER_ID_MISMATCH without pausing the platform", async () => {
  const send = vi.fn(async () => ({ status: 403, reason: "SENDER_ID_MISMATCH" }));
  const { sink, onAlert, onOutcome } = setup({ fcm: { send } });
  await sink.send(installation, challenge);
  await flush();
  expect(onOutcome).toHaveBeenCalledWith({
    id: challenge.id,
    kind: "challenge",
    outcome: "permanent-error",
  });
  expect(onAlert).not.toHaveBeenCalled();
  await sink.send(installation, { ...challenge, id: "next" });
  expect(send).toHaveBeenCalledTimes(2);
});

test("handles simultaneous auth failures once and suppresses retries of other in-flight work after pause", async () => {
  const gates: ((result: TransportResult) => void)[] = [];
  const send = vi.fn(() => new Promise<TransportResult>((resolve) => gates.push(resolve)));
  const { sink, onAlert, onOutcome } = setup({ fcm: { send } });
  for (let i = 0; i < 3; i++) await sink.send(installation, { ...challenge, id: String(i) });
  gates[0]?.({ status: 401 });
  gates[1]?.({ status: 403 });
  gates[2]?.({ status: 503 });
  await flush();
  expect(onAlert).toHaveBeenCalledTimes(1);
  expect(onOutcome).toHaveBeenCalledWith({ id: "2", kind: "challenge", outcome: "paused" });
  const quiet = setup({ apns: { send: async () => ({ status: 401 }) }, onAlert: undefined });
  await quiet.sink.send({ ...installation, platform: "ios" }, challenge);
  await flush();
  await expect(quiet.sink.send({ ...installation, platform: "ios" }, challenge)).rejects.toThrow();
});

test("retries network, 429 and server failures with exponential backoff, at most six attempts", async () => {
  const send = vi
    .fn<(...args: [FcmMessage]) => Promise<TransportResult>>()
    .mockRejectedValueOnce(new Error("network-secret"))
    .mockResolvedValueOnce({ status: 429 })
    .mockResolvedValue({ status: 500 });
  const { sink, schedule, onOutcome } = setup({ fcm: { send } });
  await sink.send(installation, activity);
  await flush();
  for (const ms of [1000, 120_000, 4000, 8000, 16000]) {
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), ms);
    await vi.advanceTimersByTimeAsync(ms - 1);
    const before = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(before + 1);
  }
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(send).toHaveBeenCalledTimes(6);
  expect(onOutcome).toHaveBeenLastCalledWith({
    id: activity.id,
    kind: "chat",
    outcome: "exhausted",
  });
  expect(new Set(send.mock.calls.map(([m]) => m.message.data.p)).size).toBe(1);
});

test("honours Retry-After seconds and HTTP dates beyond five minutes", async () => {
  const send = vi
    .fn(async () => ({ status: 429, retryAfter: "120" }))
    .mockResolvedValueOnce({
      status: 503,
      retryAfter: new Date(activity.sentAt + 90_000).toUTCString(),
    });
  const { sink, schedule } = setup({ fcm: { send } });
  await sink.send(installation, challenge);
  await flush();
  expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 90_000);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 120_000);
  for (const [attempt, value, expected] of [
    [1, undefined, 1000],
    [1, "garbage", 1000],
    [1, "0", 1000],
    [1, "900", 900_000],
    [1, "9".repeat(400), Number.POSITIVE_INFINITY],
    [12, undefined, 300_000],
    [2, new Date(0).toUTCString(), 2000],
  ] as const)
    expect(retryDelay(attempt, value, activity.sentAt)).toBe(expected);
});

test("coalesces to the latest activity per topic after ten/minute, with registration isolation and no challenge limit", async () => {
  const { sink, fake, onOutcome } = setup();
  for (let i = 0; i < 10; i++) await sink.send(installation, { ...activity, id: `sent-${i}` });
  await sink.send(installation, { ...activity, id: "old" });
  await sink.send(installation, { ...activity, id: "latest" });
  await sink.send(installation, { ...activity, topicIndex: 4, id: "other-topic" });
  expect(fake.android).toHaveLength(10);
  for (let i = 0; i < 11; i++) await sink.send(installation, challenge);
  await sink.send(installation, { ...activity, registrationId: "other-account" });
  expect(fake.android).toHaveLength(22);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(fake.android).toHaveLength(22);
  await vi.advanceTimersByTimeAsync(1);
  expect(fake.android).toHaveLength(24);
  const pending = fake.android
    .slice(-2)
    .map((m) => JSON.parse(decrypt(m.message.data.p).subarray(0, -1).toString()));
  expect(pending.map((p) => p.id)).toEqual(["latest", "other-topic"]);
  expect(onOutcome).toHaveBeenCalledWith({ id: "old", kind: "chat", outcome: "coalesced" });
});

test("enforces sixty/hour in a sliding window and releases pending work at the exact boundary", async () => {
  const { sink, fake } = setup();
  for (let batch = 0; batch < 6; batch++) {
    for (let i = 0; i < 10; i++) await sink.send(installation, activity);
    await vi.advanceTimersByTimeAsync(60_000);
  }
  expect(fake.android).toHaveLength(60);
  await sink.send(installation, activity);
  await vi.advanceTimersByTimeAsync(54 * 60_000 - 1);
  expect(fake.android).toHaveLength(60);
  await vi.advanceTimersByTimeAsync(1);
  expect(fake.android).toHaveLength(61);
});

test("bounds pending, in-flight and rate-history storage and logs overflow outcomes", async () => {
  let release!: (result: TransportResult) => void;
  const send = vi.fn(
    () =>
      new Promise<TransportResult>((resolve) => {
        release = resolve;
      }),
  );
  const { sink, onOutcome } = setup({ fcm: { send }, maxPending: 2, maxConcurrent: 1 });
  await sink.send(installation, challenge);
  await sink.send(installation, { ...activity, id: "old" });
  await sink.send(installation, { ...activity, id: "new", topicIndex: 4 });
  expect(onOutcome).toHaveBeenCalledWith({ id: "old", kind: "chat", outcome: "overflow" });
  release({ status: 200 });
  await flush();
  expect(send).toHaveBeenCalledTimes(2);
  const full = setup({ fcm: { send }, maxPending: 1 });
  await full.sink.send(installation, challenge);
  await full.sink.send(installation, activity);
  expect(full.onOutcome).toHaveBeenCalledWith({
    id: activity.id,
    kind: "chat",
    outcome: "overflow",
  });
  const rate = setup({ maxPending: 1 });
  await rate.sink.send(installation, activity);
  await rate.sink.send(installation, { ...activity, registrationId: "second" });
  expect(rate.onOutcome).toHaveBeenCalledWith({
    id: activity.id,
    kind: "chat",
    outcome: "rate-capacity",
  });
  expect(rate.fake.android).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3_600_000);
  await rate.sink.send(installation, { ...activity, registrationId: "second" });
  expect(rate.fake.android).toHaveLength(2);
});

test("rejects absent platforms and closed sinks, drops encryption failures, and cancels timers and transports", async () => {
  const close = vi.fn();
  const { sink, onOutcome } = setup({
    fcm: { send: async () => ({ status: 503 }), close },
    apns: undefined,
  });
  await expect(sink.send({ ...installation, platform: "ios" }, challenge)).rejects.toThrow(
    "configured",
  );
  await sink.send({ ...installation, authSecret: "invalid" }, challenge);
  expect(onOutcome).toHaveBeenCalledWith({
    id: challenge.id,
    kind: "challenge",
    outcome: "encryption-error",
  });
  await sink.send(installation, challenge);
  await flush();
  sink.close();
  await vi.advanceTimersByTimeAsync(1_000_000);
  expect(close).toHaveBeenCalledTimes(1);
  await expect(sink.send(installation, challenge)).rejects.toThrow("unavailable");
  const missing = setup({ fcm: undefined });
  await expect(missing.sink.send(installation, challenge)).rejects.toThrow("configured");
  let release!: () => void;
  const inFlight = setup({
    fcm: {
      send: () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 500 });
        }),
    },
  });
  await inFlight.sink.send(installation, challenge);
  inFlight.sink.close();
  release();
  await flush();
  expect(inFlight.onOutcome).not.toHaveBeenCalled();
});

test("default scheduler/log/invalidation and the mutable invalidation composition seam work", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const send = vi.fn(async () => ({ status: 404 })).mockResolvedValueOnce({ status: 503 });
  const sink = createDeliverySink({ fcm: { send }, onInvalid: undefined });
  active.push(sink);
  await sink.send(installation, challenge);
  await vi.advanceTimersByTimeAsync(1000);
  expect(log).toHaveBeenLastCalledWith("push-delivery", {
    id: challenge.id,
    kind: "challenge",
    outcome: "invalid-token",
  });
  const invalidate = vi.fn();
  sink.options.onInvalid = invalidate;
  await sink.send(installation, challenge);
  expect(invalidate).toHaveBeenCalledWith({
    installationId: installation.installationId,
    tokenVersion: 1,
  });
});

test("validates finite positive capacities and requires a bundle id with an APNs transport", () => {
  for (const options of [
    { maxPending: 0 },
    { maxPending: 1.5 },
    { maxConcurrent: 0 },
    { maxConcurrent: Number.POSITIVE_INFINITY },
    { apns: createFakeSinks().apns },
  ])
    expect(() => createDeliverySink(options)).toThrow();
});

test("ignores an already-dequeued timer after close and contains alert callback failures", async () => {
  let callback!: () => void;
  const cancel = vi.fn();
  const delayed = setup({
    fcm: { send: async () => ({ status: 500 }) },
    schedule: (fn) => {
      callback = fn;
      return cancel;
    },
  });
  await delayed.sink.send(installation, challenge);
  await flush();
  delayed.sink.close();
  callback();
  expect(cancel).toHaveBeenCalled();
  const failed = setup({
    fcm: { send: async () => ({ status: 403 }) },
    onAlert: async () => {
      throw new Error("alert unavailable");
    },
  });
  await failed.sink.send(installation, challenge);
  await flush();
  expect(failed.onOutcome).toHaveBeenCalledWith({
    id: challenge.id,
    kind: "challenge",
    outcome: "alert-failed",
  });
});

test("bounds concurrent invalidation callbacks and stops pumping when closed during storage work", async () => {
  let release!: () => void;
  const onInvalid = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const send = vi.fn(async () => ({ status: 404 }));
  const { sink } = setup({ fcm: { send }, onInvalid, maxConcurrent: 1 });
  await sink.send(installation, challenge);
  await sink.send(installation, challenge);
  expect(send).toHaveBeenCalledTimes(1);
  sink.close();
  release();
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
});

test("two offline chats are retried independently and both reach the device", async () => {
  const fake = createFakeSinks();
  const send = vi
    .fn(fake.fcm.send)
    .mockResolvedValueOnce({ status: 503 })
    .mockResolvedValueOnce({ status: 503 });
  const { sink } = setup({ fcm: { send } });
  const payloads = [activity, { ...activity, id: "chat-two", topicIndex: 4 }];
  await Promise.all(payloads.map((payload) => sink.send(installation, payload)));
  expect(fake.android).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fake.android).toHaveLength(2);
  expect(
    fake.android.map((m) => JSON.parse(decrypt(m.message.data.p).subarray(0, -1).toString())),
  ).toEqual(payloads);
  for (const message of fake.android) expect(message.message).not.toHaveProperty("collapse_key");
});

test("retries share the registration's rate budget", async () => {
  const send = vi.fn(async () => ({ status: 503 }));
  const { sink } = setup({ fcm: { send } });
  for (let i = 0; i < 10; i++) await sink.send(installation, { ...activity, topicIndex: i });
  expect(send).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(send).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(20);
});

test("coalesces failed attempts to the latest topic activity despite out-of-order provider responses", async () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const gates: ((result: TransportResult) => void)[] = [];
    const send = vi.fn(() => new Promise<TransportResult>((resolve) => gates.push(resolve)));
    const { sink, onOutcome } = setup({ fcm: { send } });
    await sink.send(installation, { ...activity, id: "older" });
    await sink.send(installation, { ...activity, id: "newer" });
    for (const index of order) {
      gates[index]?.({ status: 503 });
      await flush();
    }
    expect(onOutcome).toHaveBeenCalledWith({ id: "older", kind: "chat", outcome: "coalesced" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(3);
    const last = send.mock.calls.at(-1) as unknown as [FcmMessage];
    expect(JSON.parse(decrypt(last[0].message.data.p).subarray(0, -1).toString()).id).toBe("newer");
    sink.close();
    gates[2]?.({ status: 200 });
    await flush();
  }
});

test("FCM 429 defaults to sixty seconds with capped exponential growth; APNs retains normal backoff", async () => {
  for (const platform of ["android", "ios"] as const) {
    const send = vi.fn(async () => ({ status: 429 }));
    const { sink, schedule, onOutcome } = setup({ fcm: { send }, apns: { send } });
    await sink.send({ ...installation, platform }, challenge);
    await flush();
    const delays =
      platform === "android"
        ? [60_000, 120_000, 240_000, 300_000, 300_000]
        : [1000, 2000, 4000, 8000, 16000];
    for (const delay of delays) {
      expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), delay);
      const before = send.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(send).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(before + 1);
    }
    expect(onOutcome).toHaveBeenLastCalledWith({
      id: challenge.id,
      kind: "challenge",
      outcome: "exhausted",
    });
    sink.close();
  }
});

test("Retry-After is a minimum above five minutes for both providers, including HTTP dates", async () => {
  for (const platform of ["android", "ios"] as const) {
    for (const retryAfter of ["900", new Date(activity.sentAt + 900_000).toUTCString()]) {
      const send = vi
        .fn(async () => ({ status: 200 }))
        .mockResolvedValueOnce({ status: 429, retryAfter } as TransportResult);
      const { sink, schedule } = setup({ fcm: { send }, apns: { send } });
      await sink.send({ ...installation, platform }, challenge);
      await flush();
      expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 900_000);
      await vi.advanceTimersByTimeAsync(899_999);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(2);
      sink.close();
    }
  }
});

test("drops retries at or beyond the accepted job's 24-hour TTL instead of scheduling them", async () => {
  for (const retryAfter of [
    "86400",
    "86401",
    "9".repeat(400),
    new Date(activity.sentAt + 86_401_000).toUTCString(),
  ]) {
    const send = vi.fn(async () => ({ status: 429, retryAfter }));
    const { sink, schedule, onOutcome } = setup({ fcm: { send } });
    await sink.send(installation, { ...challenge, sentAt: 0 });
    await flush();
    expect(onOutcome).toHaveBeenLastCalledWith({
      id: challenge.id,
      kind: "challenge",
      outcome: "expired",
    });
    expect(schedule).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000_000);
    expect(send).toHaveBeenCalledTimes(1);
    sink.close();
  }
  // Time spent waiting for a provider response consumes the same TTL.
  let release!: (result: TransportResult) => void;
  const send = vi.fn(
    () =>
      new Promise<TransportResult>((resolve) => {
        release = resolve;
      }),
  );
  const { sink, onOutcome } = setup({ fcm: { send } });
  await sink.send(installation, challenge);
  await vi.advanceTimersByTimeAsync(86_399_000);
  release({ status: 503, retryAfter: "2" });
  await flush();
  expect(onOutcome).toHaveBeenLastCalledWith({
    id: challenge.id,
    kind: "challenge",
    outcome: "expired",
  });
});

test("queued and scheduled jobs expire if the event loop or another request holds them beyond the TTL", async () => {
  let release!: (result: TransportResult) => void;
  const send = vi.fn(
    () =>
      new Promise<TransportResult>((resolve) => {
        release = resolve;
      }),
  );
  const { sink, onOutcome } = setup({ fcm: { send }, maxConcurrent: 1 });
  await sink.send(installation, challenge);
  await sink.send(installation, activity);
  vi.setSystemTime(activity.sentAt + 86_400_000);
  release({ status: 200 });
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
  expect(onOutcome).toHaveBeenLastCalledWith({ id: activity.id, kind: "chat", outcome: "expired" });
});
