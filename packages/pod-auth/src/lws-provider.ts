// AUTHORED-BY Codex GPT-6
import {
  type CredentialSource,
  type LwsAccessToken,
  LwsTokenProvider,
  type LwsTokenProviderOptions,
  type SessionFence,
  type Stamped,
  type TokenProvider,
} from "@jeswr/reactive-authentication";
import type { createBoundary } from "./boundary.js";
import { memoryStore } from "./sessions.js";

/** Bind the engine's signal-less trust callback to each upgrade without sharing caller cancellation. */
export function createLwsProvider(
  source: CredentialSource,
  boundary: ReturnType<typeof createBoundary>,
  fence: SessionFence,
): TokenProvider {
  const tokens = new Map<string, Stamped<LwsAccessToken>>();
  const tokenStore: NonNullable<LwsTokenProviderOptions["tokenStore"]> & {
    clear(): Promise<void>;
  } = {
    getItem: async (key) => tokens.get(key) ?? null,
    setItem: async (key, value) => {
      tokens.set(key, value);
    },
    removeItem: async (key) => {
      tokens.delete(key);
    },
    clear: async () => tokens.clear(),
  };
  const options: LwsTokenProviderOptions = {
    http: boundary.exchangeHttp,
    fence,
    namespace: crypto.randomUUID(),
    tokenStore,
    metadataStore: memoryStore(),
  };
  const providerFor = (signal: AbortSignal) =>
    new LwsTokenProvider(source, {
      ...options,
      trustAuthorizationServer: (binding) => boundary.trustLws(binding, signal),
    });
  // Matching and cleanup do not invoke the trust policy; all upgrades use a request-bound instance.
  const shared = providerFor(fence.signal);
  let requests = new WeakMap<Request, LwsTokenProvider>();
  return {
    fence,
    matches: async (request, challenge) => await shared.matches(request, challenge),
    upgrade: async (request, challenge) => {
      const signal = AbortSignal.any([request.signal, fence.signal]);
      const provider = providerFor(signal);
      const upgraded = await provider.upgrade(new Request(request, { signal }), challenge);
      signal.throwIfAborted();
      requests.set(upgraded, provider);
      return upgraded;
    },
    invalidate: async (request) => await requests.get(request)!.invalidate(request),
    forget: async () => {
      requests = new WeakMap();
      await shared.forget();
    },
  };
}
