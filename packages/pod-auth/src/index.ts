// AUTHORED-BY Codex GPT-6.1-Sol
import type { Identity as Claims } from "@jeswr/reactive-authentication";
import { secureUrl, validateOptions } from "./options.js";
import { AmbiguousIssuerError, createProviders } from "./providers.js";
import type {
  AuthEvent,
  AuthEventType,
  Identity,
  LoginHint,
  PodAuth,
  PodAuthOptions,
} from "./types.js";

export type {
  AuthEvent,
  AuthEventType,
  Identity,
  KvStore,
  LoginHint,
  PodAuth,
  PodAuthOptions,
} from "./types.js";
export { AmbiguousIssuerError };

export function createPodAuth(options: PodAuthOptions): PodAuth {
  validateOptions(options);
  let current: Identity | null = null;
  let expected: LoginHint = {};
  let pending: { key: string; promise: Promise<Identity> } | undefined;
  const listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  const snapshot = () =>
    current === null ? null : { ...current, storages: [...current.storages] };
  const emit = (type: AuthEventType, url?: string) => {
    for (const handler of [...(listeners.get(type) ?? [])]) {
      try {
        handler({
          type,
          identity: snapshot(),
          timestamp: (options.clock ?? Date.now)(),
          ...(url === undefined ? {} : { url }),
        });
      } catch {
        /* Observers cannot interrupt credential policy or other observers. */
      }
    }
  };
  const session = async (_request: Request, claims: Claims, protocol: Identity["protocol"]) => {
    if (
      (expected.webId !== undefined && expected.webId !== claims.webId) ||
      (expected.issuer !== undefined && expected.issuer !== claims.issuer) ||
      (current !== null &&
        (claims.issuer !== current.issuer ||
          claims.subject !== current.subject ||
          (claims.webId ?? null) !== current.webId))
    ) {
      current = null;
      await providers.solidProvider.forget();
      throw new Error("Authenticated identity does not match the selected account");
    }
    const first = current === null;
    current = {
      webId: claims.webId ?? null,
      issuer: claims.issuer,
      subject: claims.subject,
      clientId: claims.clientId ?? null,
      protocol,
      storages: [...providers.boundary.roots()],
    };
    if (first) emit("login");
  };
  const providers = createProviders(options, {
    challenge: (url) => emit("challenge", url),
    session,
  });
  return {
    fetch: providers.manager.fetch as typeof fetch,
    identity: async () => snapshot(),
    login: (hint) => {
      let selected: LoginHint;
      try {
        const normalize = (value: string, name: string) =>
          secureUrl(value, options.allowInsecureLoopback === true, name).href;
        selected = {
          ...(hint?.webId === undefined ? {} : { webId: normalize(hint.webId, "WebID") }),
          ...(hint?.issuer === undefined ? {} : { issuer: normalize(hint.issuer, "issuer") }),
        };
      } catch (error) {
        return Promise.reject(error);
      }
      const key = JSON.stringify(selected);
      if (pending)
        return pending.key === key
          ? pending.promise
          : Promise.reject(new Error("Another login is in progress"));
      if (current !== null) {
        if (
          (selected.webId !== undefined && selected.webId !== current.webId) ||
          (selected.issuer !== undefined && selected.issuer !== current.issuer)
        )
          return Promise.reject(
            new Error("Account changes require a new PodAuth instance until logout is available"),
          );
        return Promise.resolve(snapshot()!);
      }
      expected = selected;
      const promise = providers
        .login(selected)
        .then(() => snapshot()!)
        .finally(() => {
          pending = undefined;
        });
      pending = { key, promise };
      return promise;
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
