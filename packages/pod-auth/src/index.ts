// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type Identity as Claims, sameIssuer } from "@jeswr/reactive-authentication";
import { createAgentAuth } from "./agent.js";
import { StorageFailure } from "./kv.js";
import { secureUrl, validateOptions } from "./options.js";
import { AmbiguousIssuerError, createProviders } from "./providers.js";
import { decideSilentRestore } from "./session-restore.js";
import type {
  AuthEvent,
  AuthEventType,
  Identity,
  LoginHint,
  PodAuth,
  PodAuthOptions,
} from "./types.js";

export { IssuerNotAuthorizedError } from "@jeswr/reactive-authentication";
export type {
  AuthEvent,
  AuthEventType,
  CidSubject,
  Identity,
  KvStore,
  LoginHint,
  LoginOptions,
  PodAuth,
  PodAuthOptions,
} from "./types.js";
export { AmbiguousIssuerError };

export function createPodAuth(options: PodAuthOptions): PodAuth {
  validateOptions(options);
  if (options.lws !== undefined && options.lws.subject !== "oidc-id-token")
    return createAgentAuth(options, { kind: "cid", cid: { ...options.lws.subject.cid } });
  const lifetime = new AbortController();
  let current: Identity | null = null;
  let durableSession = false;
  let restoring: Promise<Identity | null> | undefined;
  let loggingOut: Promise<void> | undefined;
  let epoch = 0;
  let mode: "login" | "restore" = "login";
  let pending: { key: string; promise: Promise<Identity>; cancellable: boolean } | undefined;
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
  const session = async (
    request: Request,
    claims: Claims,
    protocol: Identity["protocol"],
    expected: LoginHint,
  ) => {
    lifetime.signal.throwIfAborted();
    if (loggingOut !== undefined) throw new Error("Logout is in progress");
    const started = epoch;
    if (
      (expected.webId !== undefined && expected.webId !== claims.webId) ||
      (expected.issuer !== undefined && !sameIssuer(expected.issuer, claims.issuer)) ||
      (current !== null &&
        (claims.issuer !== current.issuer ||
          claims.subject !== current.subject ||
          (claims.webId ?? null) !== current.webId))
    ) {
      current = null;
      await providers.solidProvider.forget();
      throw new Error("Authenticated identity does not match the selected account");
    }
    const generation = await providers.fence.generation();
    const context = await providers.contextFor(request, expected);
    await providers.boundary.learn(claims.webId, request.signal, providers.fence.signal);
    request.signal.throwIfAborted();
    const webId = claims.webId;
    if (webId !== undefined) {
      const account = {
        webId,
        issuer: claims.issuer,
        selected: expected,
        requestUrl: request.url,
        context,
      };
      await providers.fence.commit(
        generation,
        async () => await providers.persistence.remember(account),
        request.signal,
      );
      if (current === null) durableSession = await providers.persistence.present(account);
    }
    if (started !== epoch) throw new Error("Session changed during authentication");
    const first = current === null;
    observedFence = providers.fence.signal;
    current = {
      webId: claims.webId ?? null,
      issuer: claims.issuer,
      subject: claims.subject,
      clientId: claims.clientId ?? null,
      protocol,
      storages: providers.boundary.storages(),
    };
    if (first) emit(mode);
  };
  const providers = createProviders(options, {
    challenge: (url) => emit("challenge", url),
    session,
  });
  let observedFence = providers.fence.signal;
  /**
   * Ends a session an abandoned login may hold. A logout since the attempt began already superseded the
   * fence, so the attempt cannot commit, and a second purge could remove another tab's newer session.
   * A logout failure (such as failed revocation) leaves local state cleared; the caller sees the abort.
   */
  const discard = async (started: number) => {
    if (started !== epoch) return;
    await api.logout().catch(() => undefined);
  };
  const readIdentity = async () => {
    const started = epoch;
    await providers.fence.generation();
    if (providers.fence.signal !== observedFence) {
      observedFence = providers.fence.signal;
      current = null;
    }
    return started === epoch ? snapshot() : null;
  };
  const checkExpiry = async () => {
    if (current === null || !durableSession) return;
    const account = await providers.persistence.active();
    if (account !== null && !(await providers.persistence.present(account))) {
      current = null;
      providers.boundary.clear();
      emit("expired");
    }
  };
  const api: PodAuth = {
    fetch: async (input, init) => {
      lifetime.signal.throwIfAborted();
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      try {
        const response = await providers.manager.fetch(input, {
          ...init,
          signal: AbortSignal.any([lifetime.signal, ...(signal == null ? [] : [signal])]),
        });
        if (response.status === 401) await checkExpiry();
        return response;
      } catch (error) {
        await checkExpiry();
        throw error;
      }
    },
    identity: readIdentity,
    remembered: async () => {
      const account = await providers.persistence.active();
      return account === null ? [] : [{ webId: account.webId, issuer: account.issuer }];
    },
    restore: () => {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason);
      if (loggingOut || pending) return Promise.reject(new Error("Authentication is in progress"));
      if (restoring) return restoring;
      const started = epoch;
      let failure: unknown;
      const promise = (async () => {
        mode = "restore";
        const existing = await readIdentity();
        if (existing !== null) return existing;
        const account = await providers.persistence.active();
        if (started !== epoch) return null;
        const decision = await decideSilentRestore({
          lastActiveWebId: account?.webId,
          remembered: account === null ? [] : [account],
          restoreIssuer: async () => {
            try {
              const claims = await providers.restore(account!, lifetime.signal);
              return claims?.webId === undefined ? undefined : { webId: claims.webId };
            } catch (error) {
              // Transport/protocol failures are fail-closed; storage errors still propagate below.
              failure = error;
              return undefined;
            }
          },
        });
        if (started !== epoch) return null;
        if (decision.outcome === "restored") return snapshot();
        current = null;
        // A missing credential (invalid_grant or unusable key) drops its pointer. Transient failures keep it.
        if (account !== null) {
          if (!(await providers.persistence.present(account))) {
            await providers.persistence.forgetPointer();
            emit("expired");
          }
        }
        if (failure instanceof StorageFailure) throw failure.cause;
        return null;
      })().finally(() => {
        restoring = undefined;
        mode = "login";
      });
      restoring = promise;
      return promise;
    },
    logout: (logoutOptions) => {
      if (logoutOptions?.scope === "session" && options.sessionScope === undefined)
        return Promise.reject(new Error("Session-only logout requires sessionScope"));
      if (loggingOut) return loggingOut;
      ++epoch;
      current = null;
      durableSession = false;
      providers.boundary.clear();
      const promise = providers.logout().finally(() => {
        observedFence = providers.fence.signal;
        current = null;
        emit("logout");
        loggingOut = undefined;
      });
      loggingOut = promise;
      return promise;
    },
    login: (hint, loginOptions) => {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason);
      const abort = loginOptions?.signal;
      if (abort?.aborted) return Promise.reject(abort.reason);
      if (loggingOut || restoring)
        return Promise.reject(new Error("Authentication is in progress"));
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
      // A cancellable attempt is never shared: one caller's abort must not cancel another's login.
      if (pending)
        return pending.key === key && abort === undefined && !pending.cancellable
          ? pending.promise
          : Promise.reject(new Error("Another login is in progress"));
      const started = epoch;
      const promise = (async () => {
        const existing = await readIdentity();
        if (started !== epoch) throw new Error("Session changed during authentication");
        if (existing !== null) {
          if (
            (selected.webId !== undefined && selected.webId !== existing.webId) ||
            (selected.issuer !== undefined && !sameIssuer(selected.issuer, existing.issuer))
          )
            throw new Error("Account changes require logout");
          return existing;
        }
        // Keep preflight cancellation even if provider startup observes a newer generation.
        const signal = AbortSignal.any([
          providers.fence.signal,
          lifetime.signal,
          ...(abort === undefined ? [] : [abort]),
        ]);
        let granted = false;
        try {
          await providers.login(selected, signal, () => {
            granted = true;
          });
        } catch (error) {
          // A grant obtained before the abort was observed must not outlive the abandoned attempt.
          if (abort?.aborted && granted) await discard(started);
          throw error;
        }
        if (abort?.aborted) {
          await discard(started);
          throw abort.reason;
        }
        return snapshot()!;
      })().finally(() => {
        pending = undefined;
      });
      pending = { key, promise, cancellable: abort !== undefined };
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
    dispose: () => {
      ++epoch;
      current = null;
      lifetime.abort(new Error("PodAuth instance disposed"));
      providers.boundary.clear();
      providers.fence.close();
      listeners.clear();
    },
  };
  return api;
}
