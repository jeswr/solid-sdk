// AUTHORED-BY Codex GPT-6
import { randomBytes } from "node:crypto";
import { matchesHash, sha256 } from "./device-proof.js";
import { activityPayload, type PushSink } from "./push-payload.js";
import type { PushRegistration, PushState } from "./push-state.js";
import { PushError, parseBody, pushBody } from "./push-validation.js";
import { type ResourceIdentity, webhookSenderPolicy } from "./resource-auth.js";
import { type createWebhookVerifier, safeUrl } from "./signatures.js";
import type { RelayStore } from "./store.js";

const absentSecretHash = sha256("");
type Transaction = <T>(operation: (state: PushState, at: number) => T) => Promise<T>;

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function identifier(value: unknown): unknown {
  return record(value)?.id ?? value;
}

/** Reject dot segments before WHATWG URL parsing can erase them. */
function resourceUrl(value: string, allowLoopback: boolean | undefined): URL {
  if (
    value.includes("?") ||
    value.includes("#") ||
    /%2f|%5c|(?:^|\/)(?:\.|%2e){1,2}(?=\/|$)/iu.test(value)
  )
    throw new Error("Invalid resource identifier");
  return safeUrl(value, allowLoopback);
}

function contains(topic: string, value: unknown, allowLoopback: boolean | undefined): boolean {
  if (typeof value !== "string") return false;
  try {
    const parent = resourceUrl(topic, allowLoopback);
    const child = resourceUrl(value, allowLoopback);
    return (
      parent.origin === child.origin &&
      (parent.href === child.href ||
        (parent.pathname.endsWith("/") && child.pathname.startsWith(parent.pathname)))
    );
  } catch {
    return false;
  }
}

// Bind verification to the exact subscription snapshot, including secret rotations and moves.
const binding = (registration: PushRegistration) =>
  JSON.stringify([
    registration.installationId,
    registration.webId,
    registration.protocol,
    registration.storage,
    registration.topics,
    registration.inboxSecretHash,
  ]);

/** The legacy SSE registration map has no link to a push registration. */
export function createPushInbox(options: {
  transaction: Transaction;
  store: RelayStore;
  now: () => number;
  verifyResourceToken: (request: Request) => Promise<ResourceIdentity>;
  verifyWebhook: ReturnType<typeof createWebhookVerifier>;
  pushSink?: PushSink;
  allowLoopback?: boolean;
}) {
  return async (request: Request): Promise<number> => {
    const url = new URL(request.url);
    const route = /^\/inbox\/([\w-]{1,128})\/([\w-]{1,128})$/u.exec(url.pathname);
    if (!route || request.method !== "POST" || url.href.includes("?") || url.href.includes("#"))
      return 404;
    const id = route[1] as string;
    const secret = route[2] as string;
    const registration = await options.transaction((state) => state.registrations.get(id));
    const matches = matchesHash(secret, registration?.inboxSecretHash ?? absentSecretHash);
    if (!registration || !matches) return 404;
    const body = await pushBody(
      request,
      false,
      /^application\/(?:lws\+json|ld\+json|json)(?:\s*;.*)?$/iu,
    );
    let json: unknown;
    try {
      json = parseBody(body);
    } catch {
      throw new PushError(400);
    }
    const envelope = record(json);
    if (!envelope) return 202;
    const channel = identifier(
      envelope.subscription !== undefined ? envelope.subscription : envelope.channel,
    );
    if (
      envelope.subscription !== undefined &&
      envelope.channel !== undefined &&
      identifier(envelope.subscription) !== identifier(envelope.channel)
    )
      return 202;
    const topic = registration.topics.find(
      (topic) =>
        topic.expiresAt > options.now() &&
        (channel === undefined || topic.channel === channel) &&
        (registration.protocol === "solid"
          ? contains(topic.topic, identifier(envelope.object), options.allowLoopback)
          : channel !== undefined),
    );
    if (!topic) return 202;
    let unauthenticated = false;
    if (registration.protocol === "solid") {
      if (topic.sender) {
        try {
          const identity = await options.verifyResourceToken(request);
          if (!webhookSenderPolicy(topic.sender)(identity)) return 401;
        } catch {
          return 401;
        }
      } else unauthenticated = true;
    } else {
      if (envelope.storage !== registration.storage || envelope.type !== "Notification") return 202;
      try {
        const signed = await options.verifyWebhook({
          url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body,
          storage: registration.storage,
        });
        if (
          !(await options.store.insertIfAbsent(
            `push-webhook:${id}:${signed.fingerprint}`,
            Math.max(1, signed.expires - options.now() + 1),
          ))
        )
          return 202;
      } catch {
        return 202;
      }
    }
    // Store transactions may be replayed; choose entropy outside their pure callback.
    const payloadId = randomBytes(16).toString("hex");
    const delivery = await options.transaction((state, at) => {
      const live = state.registrations.get(id);
      if (!live || binding(live) !== binding(registration) || topic.expiresAt <= at) return;
      if (unauthenticated) live.unauthenticated = true;
      const installation = state.installations.get(live.installationId);
      if (!installation?.activated) return;
      const payload = activityPayload(id, topic.index, topic.kind, at, payloadId);
      return { installation, payload };
    });
    if (delivery) {
      try {
        await options.pushSink?.send(delivery.installation, delivery.payload);
      } catch {
        // A paused or unavailable sink must not cause webhook retries.
      }
    }
    return 202;
  };
}
