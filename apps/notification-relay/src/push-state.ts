// AUTHORED-BY Codex GPT-6
import type { JWK } from "jose";

export interface Installation {
  installationId: string;
  platform: "android" | "ios";
  pushToken: string;
  tokenVersion: number;
  /** RFC 8291 uncompressed P-256 point (65 bytes), base64url. */
  devicePublicKey: string;
  authSecret: string;
  deviceSigningKey: JWK;
  activated: boolean;
  challengeHash: string;
  challengeAttempts: number[];
}
export interface PushTopic {
  index: number;
  kind: "inbox" | "chat";
  topic: string;
  channel: string;
  sender?: string;
  expiresAt: number;
}
export interface PushRegistration {
  registrationId: string;
  installationId: string;
  webId: string;
  protocol: "solid" | "lws";
  storage: string;
  topics: PushTopic[];
  expiresAt: number;
  inboxSecretHash: string;
}
export interface PushState {
  installations: Map<string, Installation>;
  registrations: Map<string, PushRegistration>;
}

/** Deleting a registration and its now-empty installation is one indivisible mutation. */
export function removeRegistration(state: PushState, id: string): void {
  const registration = state.registrations.get(id);
  if (!registration) return;
  state.registrations.delete(id);
  if (
    ![...state.registrations.values()].some(
      (other) => other.installationId === registration.installationId,
    )
  )
    state.installations.delete(registration.installationId);
}

export function expireRegistrations(state: PushState, now: number): void {
  for (const [id, registration] of state.registrations)
    if (registration.expiresAt <= now) removeRegistration(state, id);
}
