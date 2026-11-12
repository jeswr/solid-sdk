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
  let expired = false;
  let expiring: Promise<void> | undefined;
  /** One shared restore; it is cancelled only when every waiter has cancelled (or the instance is disposed). */
  interface SharedRestore {
    promise: Promise<Identity | null>;
    controller: AbortController;
    waiters: number;
    uncancellable: boolean;
  }
  let restoring: SharedRestore | undefined;
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
    if (await checkExpiry(started)) throw new Error("Session expired");
    if (started !== epoch) throw new Error("Session changed during authentication");
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
    // A cancelled restore or login publishes no identity and emits no event.
    request.signal.throwIfAborted();
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
    expired = false;
    if (first) emit(mode);
  };
  const providers = createProviders(
    options,
    {
      challenge: (url) => emit("challenge", url),
      session,
    },
    lifetime.signal,
  );
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
  const expire = async () => {
    expired = true;
    ++epoch;
    current = null;
    durableSession = false;
    providers.boundary.clear();
    // Cancel cached upgrades now; explicit login waits for this generation change to finish.
    const invalidation = providers.fence.supersede().then(() => {
      expiring = undefined;
    });
    expiring = invalidation;
    emit("expired");
    await invalidation;
  };
  const checkExpiry = async (started: number) => {
    if (expired && !pending) return true;
    const identity = current;
    const unchanged = () =>
      started === epoch && current === identity && !pending && !restoring && !loggingOut;
    if (identity === null || !durableSession || !unchanged()) return false;
    const account = await providers.persistence.active();
    const present =
      account !== null &&
      (await providers.persistence.present({
        ...account,
        webId: identity.webId!,
        issuer: identity.issuer,
      }));
    if (!unchanged()) return false;
    if (!present) {
      await expire();
      return true;
    }
    return false;
  };
  const api: PodAuth = {
    fetch: async (input, init) => {
      lifetime.signal.throwIfAborted();
      if (expired) throw new Error("Session expired");
      const started = epoch;
      if (await checkExpiry(started)) throw new Error("Session expired");
      if (started !== epoch) throw new Error("Session changed during authentication");
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      try {
        const response = await providers.manager.fetch(input, {
          ...init,
          signal: AbortSignal.any([lifetime.signal, ...(signal == null ? [] : [signal])]),
        });
        if (response.status === 401) await checkExpiry(started);
        return response;
      } catch (error) {
        await checkExpiry(started);
        throw error;
      }
    },
    identity: readIdentity,
    remembered: async () => {
      const account = await providers.persistence.active();
      return account === null ? [] : [{ webId: account.webId, issuer: account.issuer }];
    },
    restore: (restoreOptions) => {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason);
      const abort = restoreOptions?.signal;
      if (abort?.aborted) return Promise.reject(abort.reason);
      if (loggingOut || pending) return Promise.reject(new Error("Authentication is in progress"));
      // Each caller's signal cancels only its own wait; the shared work stops once nobody waits.
      const join = (shared: SharedRestore): Promise<Identity | null> => {
        if (abort === undefined) {
          shared.uncancellable = true;
          return shared.promise;
        }
        shared.waiters++;
        return new Promise<Identity | null>((resolve, reject) => {
          const onAbort = () => {
            reject(abort.reason);
            if (--shared.waiters === 0 && !shared.uncancellable)
              shared.controller.abort(abort.reason);
          };
          abort.addEventListener("abort", onAbort, { once: true });
          shared.promise.then(
            (value) => {
              abort.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (error: unknown) => {
              abort.removeEventListener("abort", onAbort);
              reject(error);
            },
          );
        });
      };
      if (restoring !== undefined && !restoring.controller.signal.aborted) return join(restoring);
      if (expired) return Promise.resolve(null);
      const started = ++epoch;
      const controller = new AbortController();
      const signal = AbortSignal.any([lifetime.signal, controller.signal]);
      let failure: unknown;
      const promise = (async () => {
        mode = "restore";
        const existing = await readIdentity();
        if (started !== epoch) return null;
        signal.throwIfAborted();
        if (existing !== null) return existing;
        const account = await providers.persistence.active();
        if (started !== epoch) return null;
        signal.throwIfAborted();
        const decision = await decideSilentRestore({
          lastActiveWebId: account?.webId,
          remembered: account === null ? [] : [account],
          restoreIssuer: async () => {
            try {
              const claims = await providers.restore(account!, signal);
              return claims?.webId === undefined ? undefined : { webId: claims.webId };
            } catch (error) {
              // Transport/protocol failures are fail-closed; storage errors still propagate below.
              failure = error;
              return undefined;
            }
          },
        });
        if (started !== epoch) return null;
        signal.throwIfAborted();
        if (decision.outcome === "restored") return snapshot();
        current = null;
        // A missing credential (invalid_grant or unusable key) drops its pointer. Transient failures keep it.
        if (account !== null) {
          const present = await providers.persistence.present(account);
          signal.throwIfAborted();
          if (!present) {
            await providers.persistence.forgetPointer();
            signal.throwIfAborted();
            if (started === epoch) await expire();
          }
        }
        if (failure instanceof StorageFailure) throw failure.cause;
        return null;
      })().finally(() => {
        if (restoring === shared) {
          restoring = undefined;
          mode = "login";
        }
      });
      // Waiters observe the outcome; a restore cancelled after its last waiter left has no observer.
      promise.catch(() => {});
      const shared: SharedRestore = { promise, controller, waiters: 0, uncancellable: false };
      restoring = shared;
      return join(shared);
    },
    logout: (logoutOptions) => {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason);
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
      const wasExpired = expired;
      const started = ++epoch;
      const promise = (async () => {
        if (expiring !== undefined) await expiring;
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
        if (wasExpired && current === null) expired = true;
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
