// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuthEvent, AuthEventType, Identity, PodAuth } from "@jeswr/pod-auth";
import { vi } from "vitest";

export const WEB_ID = "https://alice.example/profile/card#me";
export const ISSUER = "https://provider.example/";
export const POD_ROOT = "https://storage.example/alice/";
export const identity: Identity = {
  webId: WEB_ID,
  issuer: ISSUER,
  subject: WEB_ID,
  clientId: "https://app.example/clientid.jsonld",
  protocol: "solid-oidc",
  storages: [POD_ROOT],
};

export function deferred<T>() {
  return Promise.withResolvers<T>();
}

export function fakePodAuth() {
  const listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  // Keep each event's subscriber set stable across repeated subscriptions.
  const subscribers = (type: AuthEventType) => {
    let handlers = listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      listeners.set(type, handlers);
    }
    return handlers;
  };
  const emit = (type: AuthEventType, value: Identity | null) => {
    for (const handler of listeners.get(type) ?? [])
      handler({ type, identity: value, timestamp: Date.now() });
  };
  const auth = {
    fetch: vi.fn<typeof fetch>(async () => new Response("private files")),
    restore: vi.fn<PodAuth["restore"]>(async () => null),
    remembered: vi.fn<PodAuth["remembered"]>(async () => []),
    retireIfOwnedBy: vi.fn<PodAuth["retireIfOwnedBy"]>(async () => ({
      retired: false,
      reason: "no-grant",
    })),
    login: vi.fn<PodAuth["login"]>(async () => {
      emit("login", identity);
      return identity;
    }),
    logout: vi.fn<PodAuth["logout"]>(async () => {
      emit("logout", null);
    }),
    identity: vi.fn<PodAuth["identity"]>(async () => null),
    on: vi.fn<PodAuth["on"]>((type, handler) => {
      const handlers = subscribers(type);
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }),
  } satisfies PodAuth;
  return { auth, emit, listeners };
}
