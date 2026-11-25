// AUTHORED-BY Codex GPT-6
import type { PushClient, PushKeys, PushTopic } from "./push.js";
import { validatePushTopic } from "./push.js";
import {
  pushId,
  pushInteger,
  pushObject,
  pushString,
  pushUrl,
  relayOrigin,
  requirePush,
} from "./push-validation.js";

export interface PushTopicSpec extends PushTopic {
  topic: string;
}
export interface BoundPushTopic {
  index: number;
  kind: "inbox" | "chat";
  topic: string;
  channel: string;
  sender?: string;
  expiresAt: number;
}
export interface PushRegistrationRequest {
  accountId: string;
  webId: string;
  protocol: "solid" | "lws";
  storage: string;
  topics: PushTopicSpec[];
}
export interface PushRegistration extends Omit<PushRegistrationRequest, "topics"> {
  registrationId: string;
  inbox: string | null;
  requestedTopics: PushTopicSpec[];
  topics: BoundPushTopic[];
  /** Replaced pod channels retained until their DELETE succeeds. */
  cleanupTopics: BoundPushTopic[];
  removing: boolean;
  refreshedAt: number;
}
export interface PushRegistrarState {
  version: 1;
  relayUrl: string;
  installationId: string | null;
  registrations: PushRegistration[];
}
export interface PushSubscriptionRequest extends PushRegistrationRequest {
  inbox: string;
  requestedExpiresAt: number;
  signal: AbortSignal;
}
export interface PushSubscriptions {
  subscribe(request: PushSubscriptionRequest): Promise<BoundPushTopic[]>;
  remove(request: {
    accountId: string;
    protocol: "solid" | "lws";
    storage: string;
    topics: BoundPushTopic[];
    signal: AbortSignal;
  }): Promise<void>;
}
export interface PushRegistrarOptions {
  relayUrl: string;
  /** Obtain this from podAuth.fetchFor(account, {extraResourceOrigins:[RELAY_ORIGIN]}). */
  fetch: typeof globalThis.fetch;
  /** Required when this installation carries sessions for more than one account. */
  fetchFor?: (accountId: string) => typeof globalThis.fetch;
  /** Pristine tokenless transport; DELETEs carry only the native installation proof. */
  cleanupFetch?: typeof globalThis.fetch;
  push: PushClient;
  store: {
    load(): Promise<PushRegistrarState | null>;
    save(state: PushRegistrarState): Promise<void>;
  };
  subscriptions: PushSubscriptions;
  clock?: () => number;
}
export interface PushRegistrar {
  enable(request: PushRegistrationRequest): Promise<void>;
  renew(accountId: string): Promise<void>;
  remove(accountId: string): Promise<void>;
  retryCleanup(): Promise<void>;
  snapshot(): Promise<PushRegistrarState>;
}
const DAY = 86_400_000;
class RelayFailure extends Error {
  constructor(readonly status: number) {
    super("Push relay request failed");
  }
}
function validateRequest(value: unknown): asserts value is PushRegistrationRequest {
  const input = pushObject(value, ["accountId", "webId", "protocol", "storage", "topics"]);
  pushString(input.accountId);
  pushUrl(input.webId, true);
  pushUrl(input.storage);
  requirePush(input.protocol === "solid" || input.protocol === "lws");
  requirePush(Array.isArray(input.topics) && input.topics.length > 0 && input.topics.length <= 16);
  const seen = new Set<number>();
  for (const candidate of input.topics) {
    const topic = pushObject(candidate, ["index", "kind", "label", "route", "enabled", "topic"]);
    const { topic: url, ...local } = topic;
    validatePushTopic(local);
    pushUrl(url);
    requirePush(!seen.has(local.index));
    seen.add(local.index);
  }
}
function validateBound(value: unknown): asserts value is BoundPushTopic[] {
  requirePush(Array.isArray(value) && value.length <= 16);
  const seen = new Set<number>();
  for (const candidate of value) {
    const topic = pushObject(candidate, [
      "index",
      "kind",
      "topic",
      "channel",
      "sender",
      "expiresAt",
    ]);
    pushInteger(topic.index);
    requirePush(topic.index <= 15);
    requirePush(!seen.has(topic.index));
    seen.add(topic.index);
    requirePush(topic.kind === "inbox" || topic.kind === "chat");
    pushUrl(topic.topic);
    pushUrl(topic.channel);
    if (topic.sender !== undefined) pushUrl(topic.sender, true);
    pushInteger(topic.expiresAt);
    requirePush(topic.expiresAt > 0);
  }
}
function inboxUrl(value: unknown, origin: string, registrationId: string): string {
  const url = pushUrl(value);
  requirePush(new URL(url).origin === origin && !new URL(url).search);
  requirePush(
    new RegExp(`^/inbox/${registrationId}/[A-Za-z0-9_-]{43}$`, "u").test(new URL(url).pathname),
  );
  return url;
}
function validateState(value: unknown, origin: string): asserts value is PushRegistrarState {
  const state = pushObject(value, ["version", "relayUrl", "installationId", "registrations"]);
  requirePush(state.version === 1 && state.relayUrl === origin);
  if (state.installationId !== null) pushId(state.installationId);
  requirePush(Array.isArray(state.registrations) && state.registrations.length <= 4);
  requirePush(state.installationId !== null || state.registrations.length === 0);
  const ids = new Set<string>();
  for (const candidate of state.registrations) {
    const registration = pushObject(candidate, [
      "accountId",
      "webId",
      "protocol",
      "storage",
      "registrationId",
      "inbox",
      "requestedTopics",
      "topics",
      "cleanupTopics",
      "removing",
      "refreshedAt",
    ]);
    pushId(registration.registrationId);
    requirePush(!ids.has(registration.registrationId));
    ids.add(registration.registrationId);
    validateRequest({
      accountId: registration.accountId,
      webId: registration.webId,
      protocol: registration.protocol,
      storage: registration.storage,
      topics: registration.requestedTopics,
    });
    if (registration.inbox !== null)
      inboxUrl(registration.inbox, origin, registration.registrationId);
    validateBound(registration.topics);
    validateBound(registration.cleanupTopics);
    pushInteger(registration.refreshedAt);
    requirePush(typeof registration.removing === "boolean");
  }
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let reject!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const abort = () => reject(new Error("Push operation cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  // Race even when already aborted so a late native rejection always has a handler.
  if (signal.aborted) abort();
  try {
    return await Promise.race([cancelled, work]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** One instance per phone/relay. Persist metadata only; all signing and decryption stay native. */
export function createPushRegistrar(options: PushRegistrarOptions): PushRegistrar {
  const origin = relayOrigin(options.relayUrl);
  const clock = options.clock ?? Date.now;
  const cleanupFetch = options.cleanupFetch ?? globalThis.fetch;
  let pendingState: Promise<PushRegistrarState> | undefined;
  let queue = Promise.resolve();
  let saves = Promise.resolve();
  const attempts = new Map<string, AbortController>();
  const stopped = new Set<string>();
  const state = () => {
    pendingState ??= options.store.load().then((saved) => {
      const value = saved ?? {
        version: 1,
        relayUrl: origin,
        installationId: null,
        registrations: [],
      };
      validateState(value, origin);
      return structuredClone(value);
    });
    return pendingState;
  };
  const save = (value: PushRegistrarState) => {
    const copy = structuredClone(value);
    const next = saves.then(() => options.store.save(copy));
    saves = next.catch(() => {});
    return next;
  };
  const serial = (work: () => Promise<void>) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const schedule = async (value: PushRegistrarState) => {
    const expiries = value.registrations
      .filter((entry) => !entry.removing)
      .flatMap((entry) => entry.topics.map((topic) => topic.expiresAt))
      .filter((expiry) => expiry > clock());
    await options.push.scheduleRenewalReminder({
      expiresAt: expiries.length ? Math.min(...expiries) : null,
    });
  };
  async function request(
    accountId: string,
    path: string,
    method: string,
    data: unknown,
    signal: AbortSignal,
    cleanup = false,
  ) {
    const url = `${origin}${path}`;
    const body = data === undefined ? undefined : JSON.stringify(data);
    signal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    const { proof } = await abortable(
      options.push.sign({ method, url, ...(body === undefined ? {} : { body }) }),
      signal,
    );
    signal.throwIfAborted();
    const transport = cleanup
      ? cleanupFetch
      : options.fetchFor
        ? options.fetchFor(accountId)
        : options.fetch;
    const response = await abortable(
      transport(url, {
        method,
        credentials: "omit",
        redirect: "error",
        signal,
        headers: {
          "installation-proof": proof,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
      }),
      signal,
    );
    requirePush(!response.redirected && !response.headers.has("location"));
    if (cleanup && response.status === 404) return null;
    if (!response.ok) throw new RelayFailure(response.status);
    if (response.status === 204) return null;
    requirePush(response.body);
    const reader = response.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        length += value.byteLength;
        requirePush(length <= 65_536);
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
  async function install(
    accountId: string,
    value: PushRegistrarState,
    signal: AbortSignal,
  ): Promise<PushKeys> {
    signal.throwIfAborted();
    const status = await abortable(options.push.status(), signal);
    signal.throwIfAborted();
    requirePush(status.permission !== "denied");
    const keys = await abortable(options.push.enable(), signal);
    signal.throwIfAborted();
    const previous = value.installationId;
    let raw: unknown;
    let replacing = false;
    try {
      raw = await request(
        accountId,
        previous ? `/push/installations/${previous}` : "/push/installations",
        previous ? "PATCH" : "POST",
        { ...keys, ...(previous ? {} : { platform: status.platform }) },
        signal,
      );
    } catch (error) {
      if (!(error instanceof RelayFailure) || error.status !== 404 || !previous) throw error;
      replacing = true;
      raw = await request(
        accountId,
        "/push/installations",
        "POST",
        { ...keys, platform: status.platform },
        signal,
      );
    }
    const result = pushObject(raw, ["installationId", "activated", "challengeSent"]);
    pushId(result.installationId);
    requirePush(typeof result.activated === "boolean");
    requirePush(result.challengeSent === undefined || typeof result.challengeSent === "boolean");
    requirePush(previous === null || replacing || result.installationId === previous);
    if (replacing) for (const entry of value.registrations) entry.inbox = null;
    value.installationId = result.installationId;
    await save(value);
    if (!result.activated) {
      requirePush(result.challengeSent === true);
      const challenge = await abortable(
        options.push.activate({ installationId: value.installationId }),
        signal,
      );
      await request(
        accountId,
        `/push/installations/${value.installationId}/activate`,
        "POST",
        challenge,
        signal,
      );
    }
    signal.throwIfAborted();
    return keys;
  }
  const payload = (value: PushRegistrarState, entry: PushRegistration) => ({
    installationId: value.installationId,
    webId: entry.webId,
    protocol: entry.protocol,
    storage: entry.storage,
    topics: entry.topics,
  });
  async function refresh(
    value: PushRegistrarState,
    entry: PushRegistration,
    keys: PushKeys,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    requirePush(!entry.removing);
    // Drain the previously retained batch before an inbox change can retire the current one.
    if (entry.cleanupTopics.length) {
      await options.subscriptions.remove({
        accountId: entry.accountId,
        protocol: entry.protocol,
        storage: entry.storage,
        topics: entry.cleanupTopics,
        signal,
      });
      entry.cleanupTopics = [];
      await save(value);
    }
    const originalInbox = entry.inbox;
    const raw = await request(
      entry.accountId,
      `/push/registrations/${entry.registrationId}`,
      "PUT",
      payload(value, entry),
      signal,
    );
    const result = pushObject(raw, ["registrationId", "inbox"]);
    requirePush(result.registrationId === entry.registrationId);
    if (result.inbox !== undefined)
      entry.inbox = inboxUrl(result.inbox, origin, entry.registrationId);
    if (!entry.inbox) {
      const rotated = pushObject(
        await request(
          entry.accountId,
          `/push/registrations/${entry.registrationId}/rotate-inbox`,
          "POST",
          undefined,
          signal,
        ),
        ["inbox"],
      );
      entry.inbox = inboxUrl(rotated.inbox, origin, entry.registrationId);
    }
    // A recreated/rotated inbox invalidates every existing sendTo binding, even before expiry.
    if (entry.inbox !== originalInbox) {
      entry.cleanupTopics.push(...entry.topics);
      entry.topics = [];
    }
    await save(value);
    signal.throwIfAborted();
    const needsSubscription =
      entry.topics.length === 0 ||
      entry.topics.some((topic) => topic.expiresAt - clock() < 2 * DAY);
    if (needsSubscription) {
      // Replacement remains cleanup-visible until its relay binding has succeeded.
      const topics = await abortable(
        options.subscriptions.subscribe({
          accountId: entry.accountId,
          webId: entry.webId,
          protocol: entry.protocol,
          storage: entry.storage,
          inbox: entry.inbox,
          topics: structuredClone(entry.requestedTopics),
          requestedExpiresAt: clock() + 7 * DAY,
          signal,
        }),
        signal,
      );
      validateBound(topics);
      requirePush(topics.length === entry.requestedTopics.length);
      for (const topic of topics)
        requirePush(
          topic.expiresAt > clock() &&
            entry.requestedTopics.some(
              (expected) =>
                expected.index === topic.index &&
                expected.kind === topic.kind &&
                expected.topic === topic.topic,
            ),
        );
      entry.cleanupTopics.push(...entry.topics);
      entry.topics = structuredClone(topics);
      await save(value);
      signal.throwIfAborted();
      await request(
        entry.accountId,
        `/push/registrations/${entry.registrationId}`,
        "PUT",
        payload(value, entry),
        signal,
      );
    }
    // The adapter owns orphan cleanup if it fails part-way through creating a batch.
    if (entry.cleanupTopics.length) {
      await options.subscriptions.remove({
        accountId: entry.accountId,
        protocol: entry.protocol,
        storage: entry.storage,
        topics: entry.cleanupTopics,
        signal,
      });
      entry.cleanupTopics = [];
      await save(value);
    }
    signal.throwIfAborted();
    requirePush(!entry.removing);
    const topics = entry.requestedTopics.map(({ topic: _topic, ...local }) => local);
    await options.push.setTopicMap({
      registrationId: entry.registrationId,
      topics,
      pushToken: keys.pushToken,
    });
    if (signal.aborted || entry.removing) {
      await options.push.silence({ registrationId: entry.registrationId });
      signal.throwIfAborted();
      requirePush(!entry.removing);
    }
    entry.refreshedAt = clock();
    await save(value);
    await schedule(value);
  }
  async function cleanup(value: PushRegistrarState) {
    for (const entry of [...value.registrations]) {
      if (!entry.removing) continue;
      await options.push.silence({ registrationId: entry.registrationId });
      // A pod failure never prevents the device-proof relay deletion. Retain failures for retry.
      let podDeleted = false;
      try {
        await abortable(
          options.subscriptions.remove({
            accountId: entry.accountId,
            protocol: entry.protocol,
            storage: entry.storage,
            topics: [...entry.topics, ...entry.cleanupTopics],
            signal: AbortSignal.timeout(10_000),
          }),
          AbortSignal.timeout(10_000),
        );
        entry.topics = [];
        entry.cleanupTopics = [];
        podDeleted = true;
      } catch {
        /* Best effort, retry while keeping the account metadata. */
      }
      let relayDeleted = false;
      try {
        await request(
          entry.accountId,
          `/push/registrations/${entry.registrationId}`,
          "DELETE",
          undefined,
          AbortSignal.timeout(10_000),
          true,
        );
        relayDeleted = true;
      } catch {
        /* Keep keys and the silenced map for next launch. */
      }
      if (podDeleted && relayDeleted) {
        // Free the native four-registration capacity only after relay cleanup is confirmed.
        await options.push.setTopicMap({ registrationId: entry.registrationId, topics: [] });
        value.registrations = value.registrations.filter((other) => other !== entry);
      }
      await save(value);
    }
    if (value.registrations.length === 0 && value.installationId) {
      let confirmed = false;
      try {
        await request(
          "",
          `/push/installations/${value.installationId}`,
          "DELETE",
          undefined,
          AbortSignal.timeout(10_000),
          true,
        );
        confirmed = true;
      } catch {
        // Sign-out is local first and remote cleanup is best effort. Retain keys/ID for retry.
      }
      if (confirmed) {
        // Last-registration deletion may already have atomically deleted the installation (404).
        await options.push.disable({ deleteLocalData: true });
        value.installationId = null;
      }
      await save(value);
    }
    await schedule(value);
  }
  const operate = (
    accountId: string,
    work: (value: PushRegistrarState, signal: AbortSignal) => Promise<void>,
  ) =>
    serial(async () => {
      requirePush(!stopped.has(accountId));
      const controller = new AbortController();
      attempts.set(accountId, controller);
      try {
        await work(await state(), controller.signal);
      } finally {
        attempts.delete(accountId);
      }
    });
  return {
    enable(input) {
      validateRequest(input);
      const copy = structuredClone(input);
      stopped.delete(copy.accountId);
      return operate(copy.accountId, async (value, signal) => {
        let entry = value.registrations.find(
          (candidate) =>
            candidate.accountId === copy.accountId && candidate.storage === copy.storage,
        );
        requirePush(!entry?.removing);
        const keys = await install(copy.accountId, value, signal);
        if (!entry) {
          requirePush(value.registrations.length < 4);
          entry = {
            accountId: copy.accountId,
            webId: copy.webId,
            protocol: copy.protocol,
            storage: copy.storage,
            registrationId: crypto.randomUUID(),
            inbox: null,
            requestedTopics: copy.topics,
            topics: [],
            cleanupTopics: [],
            removing: false,
            refreshedAt: 0,
          };
          value.registrations.push(entry);
          await save(value);
        } else {
          requirePush(entry.webId === copy.webId && entry.protocol === copy.protocol);
          if (JSON.stringify(entry.requestedTopics) !== JSON.stringify(copy.topics)) {
            await options.push.silence({ registrationId: entry.registrationId });
            await options.subscriptions.remove({
              accountId: entry.accountId,
              protocol: entry.protocol,
              storage: entry.storage,
              topics: [...entry.topics, ...entry.cleanupTopics],
              signal,
            });
            entry.topics = [];
            entry.cleanupTopics = [];
            entry.requestedTopics = copy.topics;
            await save(value);
          }
        }
        await refresh(value, entry, keys, signal);
      });
    },
    renew(accountId) {
      pushString(accountId);
      return operate(accountId, async (value, signal) => {
        const entries = value.registrations.filter(
          (entry) => entry.accountId === accountId && !entry.removing,
        );
        if (!entries.length) return;
        const keys = await install(accountId, value, signal);
        for (const entry of entries) await refresh(value, entry, keys, signal);
      });
    },
    async remove(accountId) {
      pushString(accountId);
      stopped.add(accountId);
      attempts.get(accountId)?.abort();
      const value = await state();
      const entries = value.registrations.filter((entry) => entry.accountId === accountId);
      for (const entry of entries) {
        entry.removing = true;
        await options.push.silence({ registrationId: entry.registrationId });
      }
      await save(value);
      await schedule(value);
      return serial(() => cleanup(value));
    },
    retryCleanup: () => serial(async () => cleanup(await state())),
    snapshot: async () => structuredClone(await state()),
  };
}
