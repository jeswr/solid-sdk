// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type Identity as Claims, sameIssuer } from "@jeswr/reactive-authentication";
import { createAgentAuth } from "./agent.js";
import { StorageFailure } from "./kv.js";
import { secureUrl, validateOptions } from "./options.js";
import { AmbiguousIssuerError, createProviders } from "./providers.js";
import { decideSilentRestore } from "./session-restore.js";
import type { ActiveAccount } from "./sessions.js";
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
  let current: Identity | null = null;
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
    if (webId !== undefined)
      await providers.fence.commit(
        generation,
        async () =>
          await providers.persistence.remember({
            webId,
            issuer: claims.issuer,
            selected: expected,
            requestUrl: request.url,
            context,
          }),
        request.signal,
      );
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
   * Discards an abandoned login's grant and puts back the remembered account it replaced; a session it
   * already announced ends with a logout event.
   */
  const discard = async (started: number, before: ActiveAccount | null) => {
    if (started !== epoch) return; // a logout already cleared everything
    ++epoch;
    const announced = current !== null;
    current = null;
    try {
      await providers.abandon();
      const after = await providers.persistence.active();
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        if (before === null) await providers.persistence.forgetPointer();
        else await providers.persistence.remember(before);
      }
    } finally {
      observedFence = providers.fence.signal;
      if (announced) emit("logout");
    }
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
  return {
    fetch: providers.manager.fetch as typeof fetch,
    identity: readIdentity,
    remembered: async () => {
      const account = await providers.persistence.active();
      return account === null ? [] : [{ webId: account.webId, issuer: account.issuer }];
    },
    restore: () => {
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
              const claims = await providers.restore(account!);
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
    logout: () => {
      if (loggingOut) return loggingOut;
      ++epoch;
      current = null;
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
        const before = abort === undefined ? null : await providers.persistence.active();
        // Keep preflight cancellation even if provider startup observes a newer generation.
        const signal =
          abort === undefined
            ? providers.fence.signal
            : AbortSignal.any([providers.fence.signal, abort]);
        try {
          await providers.login(selected, signal);
        } catch (error) {
          // The provider may have stored a grant before it observed the abort.
          if (abort?.aborted) await discard(started, before);
          throw error;
        }
        if (abort?.aborted) {
          await discard(started, before);
          throw abort.reason;
        }
        return snapshot()!;
      })().finally(() => {
        pending = undefined;
      });
      pending = { key, promise, cancellable: abort !== undefined };
      if (abort === undefined) return promise;
      // The caller is released at once; the attempt keeps `pending` until it has wound down.
      promise.catch(() => undefined);
      return new Promise<Identity>((resolve, reject) => {
        const onAbort = () => reject(abort.reason);
        abort.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => abort.removeEventListener("abort", onAbort));
      });
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
