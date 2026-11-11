// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { JWK } from "jose";

export interface Installation {
  installationId: string;
  platform: "android" | "ios";
  pushToken: string;
  tokenVersion: number;
  tokenUpdatedAt: number;
  /** RFC 8291 uncompressed P-256 point (65 bytes), base64url. */
  devicePublicKey: string;
  authSecret: string;
  deviceSigningKey: JWK;
  activated: boolean;
  challengeHash: string;
  challengeAttempts: number[];
  /** Admission time; an installation no registration ever attaches to expires from here. */
  createdAt: number;
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
  /** At least one accepted Solid delivery relied on the secret alone. */
  unauthenticated?: boolean;
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

/**
 * An installation lives on only through its registrations: removeRegistration drops it with the
 * last one, and one that never gains a registration is removed once lifetimeMs has passed.
 */
export function expireUnattached(state: PushState, now: number, lifetimeMs: number): void {
  const attached = new Set([...state.registrations.values()].map((r) => r.installationId));
  for (const [id, installation] of state.installations)
    if (!attached.has(id) && installation.createdAt <= now - lifetimeMs)
      state.installations.delete(id);
}
