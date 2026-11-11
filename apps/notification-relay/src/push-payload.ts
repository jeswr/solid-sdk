// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { randomBytes } from "node:crypto";
import type { Installation } from "./push-state.js";

/** P5 plaintext. No URLs, WebIDs or labels; `kind` comes from the stored topic, never the webhook. */
export interface ChallengePayload {
  v: 1;
  id: string;
  kind: "challenge";
  registrationId: string;
  topicIndex: 0;
  nonce: string;
  sentAt: number;
}
export interface ActivityPayload {
  v: 1;
  id: string;
  kind: "inbox" | "chat";
  registrationId: string;
  topicIndex: number;
  sentAt: number;
}
export type PushPayload = ChallengePayload | ActivityPayload;

/** Shared by both send paths and the native interop vectors. IDs never contain provider data. */
export function challengePayload(
  installationId: string,
  nonce: string,
  at: number,
  id = randomBytes(16).toString("hex"),
): ChallengePayload {
  return {
    v: 1,
    id,
    kind: "challenge",
    registrationId: installationId,
    topicIndex: 0,
    nonce,
    sentAt: Math.floor(at),
  };
}

export function activityPayload(
  registrationId: string,
  topicIndex: number,
  kind: ActivityPayload["kind"],
  at: number,
  id = randomBytes(16).toString("hex"),
): ActivityPayload {
  return { v: 1, id, kind, registrationId, topicIndex, sentAt: Math.floor(at) };
}

/**
 * Delivery boundary between the routes (push.ts) and the transports (push-delivery.ts). send()
 * resolves once the payload is accepted for delivery (queued or sent); it rejects only when the
 * sink cannot accept it at all (paused, misconfigured), so the caller can report it.
 */
export interface PushSink {
  send(installation: Installation, payload: PushPayload): Promise<void>;
}

/**
 * The provider said the token is dead (FCM UNREGISTERED, APNs 410). The routes remove the
 * installation only if `tokenVersion` is still current and, for APNs, the token was last
 * updated before `providerTimestamp` (ms).
 */
export interface PushInvalidation {
  installationId: string;
  tokenVersion: number;
  providerTimestamp?: number;
}
