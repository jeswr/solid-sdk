// AUTHORED-BY Claude Opus 5.5
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
  clientId: "https://manager.example/clientid.jsonld",
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
  const podFetch = vi.fn<typeof fetch>(async () => new Response("private content"));
  const auth = {
    fetch: podFetch,
    // Account-pinned fetches share the fake transport so tests can assert on one mock.
    fetchFor: vi.fn<PodAuth["fetchFor"]>(() => podFetch),
    restore: vi.fn<PodAuth["restore"]>(async () => null),
    remembered: vi.fn<PodAuth["remembered"]>(async () => []),
    identity: vi.fn<PodAuth["identity"]>(async () => null),
    login: vi.fn<PodAuth["login"]>(async () => {
      emit("login", identity);
      return identity;
    }),
    logout: vi.fn<PodAuth["logout"]>(async () => {
      emit("logout", null);
    }),
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
