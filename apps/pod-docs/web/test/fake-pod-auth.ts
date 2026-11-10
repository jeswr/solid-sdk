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
  clientId: "https://docs.example/clientid.jsonld",
  protocol: "solid-oidc",
  storages: [POD_ROOT],
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function fakePodAuth() {
  const listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  const emit = (type: AuthEventType, value: Identity | null) => {
    for (const handler of listeners.get(type) ?? [])
      handler({ type, identity: value, timestamp: Date.now() });
  };
  const auth = {
    fetch: vi.fn<typeof fetch>(async () => new Response("private files")),
    restore: vi.fn<PodAuth["restore"]>(async () => null),
    remembered: vi.fn<PodAuth["remembered"]>(async () => []),
    login: vi.fn<PodAuth["login"]>(async () => {
      emit("login", identity);
      return identity;
    }),
    logout: vi.fn<PodAuth["logout"]>(async () => {
      emit("logout", null);
    }),
    identity: vi.fn<PodAuth["identity"]>(async () => null),
    on: vi.fn<PodAuth["on"]>((type, handler) => {
      const handlers = listeners.get(type) ?? new Set();
      listeners.set(type, handlers);
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }),
  } satisfies PodAuth;
  return { auth, emit, listeners };
}
