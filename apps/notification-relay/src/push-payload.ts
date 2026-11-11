// AUTHORED-BY Claude Opus 5.5
import type { Installation } from "./push-state.js";

/** P5 plaintext. No URLs, WebIDs or labels; `kind` comes from the stored topic, never the webhook. */
export interface ChallengePayload {
  v: 1;
  id: string;
  kind: "challenge";
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
