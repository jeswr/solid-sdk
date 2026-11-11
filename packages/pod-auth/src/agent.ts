// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { sameIssuer } from "@jeswr/reactive-authentication";
import { accountMatches, extraResourceOrigins } from "./options.js";
import { type AgentConfiguration, type AgentPolicy, createAgentProviders } from "./providers.js";
import type { AuthEvent, AuthEventType, Identity, PodAuth } from "./types.js";

/** In-memory agent lifecycle. Credentials remain owned by the protocol providers. */
export function createAgentAuth(policy: AgentPolicy, config: AgentConfiguration): PodAuth {
  let current: Identity | null = null;
  let epoch = 0;
  let pending: Promise<Identity> | undefined;
  let loggingOut: Promise<void> | undefined;
  const listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  const snapshot = () =>
    current === null ? null : { ...current, storages: [...current.storages] };
  const emit = (type: AuthEventType, url?: string) => {
    for (const handler of [...(listeners.get(type) ?? [])]) {
      try {
        handler({
          type,
          identity: snapshot(),
          timestamp: (policy.clock ?? Date.now)(),
          ...(url === undefined ? {} : { url }),
        });
      } catch {
        /* Observers cannot interrupt credential policy. */
      }
    }
  };
  const providers = createAgentProviders(policy, config, {
    challenge: (url) => emit("challenge", url),
    session: (signal) => {
      signal.throwIfAborted();
      if (loggingOut) throw new Error("Logout is in progress");
      const first = current === null;
      current = { ...providers.identity, storages: providers.boundary.storages() };
      if (first) emit("login");
    },
  });
  return {
    fetch: providers.manager.fetch as typeof fetch,
    fetchFor: (account, options) => {
      if (extraResourceOrigins(options).length)
        throw new Error("Extra resource origins require a Solid-OIDC account");
      if (!accountMatches(account, current)) throw new Error("Account session is unavailable");
      const selected = snapshot()!;
      const started = epoch;
      return async (input, init) => {
        if (started !== epoch || !accountMatches(selected, current))
          throw new Error("Account session is unavailable");
        return await providers.manager.fetch(input, init);
      };
    },
    identity: async () => snapshot(),
    remembered: async () => [],
    restore: async () => snapshot(),
    login: (hint, loginOptions) => {
      if (loginOptions?.signal?.aborted) return Promise.reject(loginOptions.signal.reason);
      if (loggingOut) return Promise.reject(new Error("Logout is in progress"));
      // Client credentials are opaque; never infer a human WebID from an access token.
      if (
        hint?.webId !== undefined ||
        (hint?.issuer !== undefined && !sameIssuer(hint.issuer, providers.identity.issuer))
      )
        return Promise.reject(new Error("Agent identity does not match the selected account"));
      if (pending) return pending;
      const started = epoch;
      pending = (async () => {
        await providers.login();
        if (started !== epoch) throw new Error("Session changed during authentication");
        return snapshot()!;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    logout: () => {
      if (loggingOut) return loggingOut;
      ++epoch;
      current = null;
      loggingOut = providers.manager.logout().finally(() => {
        current = null;
        emit("logout");
        loggingOut = undefined;
      });
      return loggingOut;
    },
    on: (event, handler) => {
      let handlers = listeners.get(event);
      if (!handlers) {
        handlers = new Set();
        listeners.set(event, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
