// AUTHORED-BY Codex GPT-6.1-Sol
import type { Identity, LoginHint, PodAuth } from "@jeswr/pod-auth";
import { createRecentProvidersStore, resolveLoginTarget } from "@jeswr/pod-auth/directory";
import type { AuthorizationCodeFlow } from "@jeswr/reactive-authentication/elements";
import type { SignInCardProps, SignInRecentAccount } from "@jeswr/suite-ui/sign-in";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { authFlowHolder, lazyElementGetCode } from "./auth-flow-holder";
import { allowInsecureLoopback, getPodAuth, publicFetch } from "./pod-auth";
import { readProfile } from "./profile";
import { type DerivedSession, deriveSession } from "./session-derivation";
import { consumeAutologinAccount, signInError } from "./sign-in";

type Pending = SignInCardProps["pending"];
export interface SessionContextValue {
  webId: string | null;
  session: DerivedSession | null;
  fetch: typeof fetch;
  logout(): Promise<void>;
  restoringSession: boolean;
  error: string | null;
  ready: boolean;
  pending: Pending;
  recentAccounts: SignInRecentAccount[];
  recentProviders: string[];
  loginWithAddress(input: string, kind?: "webid" | "custom"): Promise<void>;
  loginWithIssuer(issuer: string): Promise<void>;
  loginWithAccount(webId: string): Promise<void>;
  /** Start again after the auth runtime failed to initialise. */
  retry(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Address lookups give up after this long, so a silent host cannot freeze the card. */
export const LOOKUP_TIMEOUT_MS = 15_000;

/**
 * Builds before pod-auth kept refresh tokens and DPoP keys in their own stores. pod-auth's
 * logout cannot reach them, so remove them once (they are never read again).
 */
export function clearLegacyCredentials(): void {
  try {
    globalThis.indexedDB?.deleteDatabase("pod-drive:sessions");
  } catch {
    // Storage may be unavailable (private mode); there is then nothing to clear.
  }
  for (const [storage, key] of [
    ["localStorage", "pod-drive:remembered-account"],
    ["sessionStorage", "pod-drive:autologin-attempted"],
  ] as const) {
    try {
      globalThis[storage]?.removeItem(key);
    } catch {
      // As above.
    }
  }
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

function recentProvidersStore() {
  try {
    return createRecentProvidersStore(localStorage);
  } catch {
    return createRecentProvidersStore(undefined);
  }
}

/** Mirror the shared core; this host never handles credentials or patches global fetch. */
export function SessionProvider({
  children,
  auth: suppliedAuth,
}: {
  children: ReactNode;
  auth?: PodAuth;
}) {
  const flowRef = useRef<AuthorizationCodeFlow>(null);
  const restoreRef = useRef<Promise<Identity | null> | null>(null);
  const authRef = useRef<PodAuth | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const activeLogin = useRef<symbol | null>(null);
  const deepLink = useRef<string | null | undefined>(undefined);
  // Remembered issuers, so an account row never needs to choose among several issuers again.
  const accountIssuers = useRef(new Map<string, string>());
  const [attempt, setAttempt] = useState(0);
  const [auth, setAuth] = useState<PodAuth | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [session, setSession] = useState<DerivedSession | null>(null);
  const [restoringSession, setRestoringSession] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<SignInRecentAccount[]>([]);
  const store = useMemo(recentProvidersStore, []);
  const [recentProviders, setRecentProviders] = useState(() => store.list());

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs start-up on retry.
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let changed = false;
    const stops: (() => void)[] = [];
    const element = flowRef.current;
    const getCode = element ? lazyElementGetCode(element) : null;
    authFlowHolder.current = getCode;
    if (deepLink.current === undefined) {
      deepLink.current = consumeAutologinAccount();
      clearLegacyCredentials();
    }
    const suggestedAccounts = (): SignInRecentAccount[] =>
      deepLink.current ? [{ webId: deepLink.current }] : [];

    void (async () => {
      const core = suppliedAuth ?? (await getPodAuth());
      if (disposed) return;
      if (authRef.current !== core) restoreRef.current = null;
      authRef.current = core;
      setAuth(core);
      for (const type of ["login", "restore", "logout", "expired"] as const) {
        stops.push(
          core.on(type, (event) => {
            if (disposed) return;
            changed = true;
            setIdentity(event.identity);
            if (event.identity === null) {
              ++generation.current;
              activeLogin.current = null;
              setPending(null);
              setSession(null);
              setRecentAccounts(suggestedAccounts());
            }
          }),
        );
      }
      // Reuse the same restore promise across StrictMode effect replay.
      setRestoringSession(true);
      restoreRef.current ??= core.restore();
      const restore = restoreRef.current;
      try {
        const restored = await restore;
        if (!disposed && !changed) setIdentity(restored);
      } catch {
        // pod-auth keeps the remembered account on transient failures, so offer it again.
        if (!disposed && !changed)
          setError("We couldn't restore your last session. Sign in again.");
      } finally {
        if (!disposed) setRestoringSession(false);
      }
      const remembered = await core.remembered().catch(() => []);
      if (disposed) return;
      for (const account of remembered) accountIssuers.current.set(account.webId, account.issuer);
      const accounts: SignInRecentAccount[] = remembered.map((account) => ({
        webId: account.webId,
        name: account.displayName,
        photoUrl: account.avatar,
      }));
      for (const account of suggestedAccounts()) {
        if (!accounts.some((existing) => existing.webId === account.webId)) accounts.push(account);
      }
      setRecentAccounts(accounts);
      setReady(true);
    })().catch(() => {
      if (!disposed) {
        setError("We couldn't start sign-in. Try again.");
        setRestoringSession(false);
      }
    });

    return () => {
      disposed = true;
      mounted.current = false;
      ++generation.current;
      for (const stop of stops) stop();
      if (authFlowHolder.current === getCode) authFlowHolder.current = null;
    };
  }, [suppliedAuth, attempt]);

  useEffect(() => {
    let disposed = false;
    if (!identity?.webId) {
      setSession(null);
      return;
    }
    const webId = identity.webId;
    setSession(null);
    void readProfile(webId, publicFetch)
      .then(deriveSession)
      .catch(() =>
        deriveSession({
          webId,
          name: webId,
          // These are the core's verified roots if the public profile is temporarily unavailable.
          storages: [...identity.storages],
          oidcIssuers: [],
        }),
      )
      .then((derived) => {
        if (!disposed) setSession(derived);
      });
    return () => {
      disposed = true;
    };
  }, [identity]);

  const runLogin = useCallback(
    async (action: NonNullable<Pending>, target: () => Promise<LoginHint>) => {
      const core = authRef.current;
      if (!core || !ready || activeLogin.current) return;
      const attempt = Symbol();
      const started = generation.current;
      activeLogin.current = attempt;
      setPending(action);
      setError(null);
      const current = () =>
        mounted.current && generation.current === started && activeLogin.current === attempt;
      try {
        const hint = await target();
        if (!current()) return;
        const loggedIn = await core.login(hint);
        if (!current()) return;
        store.remember(loggedIn.issuer);
        setRecentProviders(store.list());
        setIdentity(loggedIn);
      } catch (failure) {
        if (current()) setError(signInError(failure));
      } finally {
        if (activeLogin.current === attempt) {
          activeLogin.current = null;
          if (mounted.current) setPending(null);
        }
      }
    },
    [ready, store],
  );

  const loginWithAddress = useCallback(
    (input: string, kind: "webid" | "custom" = "webid") =>
      runLogin({ kind, key: input }, async () => {
        const target = await resolveLoginTarget(input, {
          fetch: publicFetch,
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
          allowInsecureLoopback: allowInsecureLoopback(),
        });
        return target.kind === "webid" ? { webId: target.webId } : { issuer: target.issuer };
      }),
    [runLogin],
  );
  const loginWithIssuer = useCallback(
    (issuer: string) => runLogin({ kind: "provider", key: issuer }, async () => ({ issuer })),
    [runLogin],
  );
  const loginWithAccount = useCallback(
    (webId: string) =>
      runLogin({ kind: "account", key: webId }, async () => {
        const issuer = accountIssuers.current.get(webId);
        return issuer ? { webId, issuer } : { webId };
      }),
    [runLogin],
  );
  const logout = useCallback(async () => {
    ++generation.current;
    activeLogin.current = null;
    setPending(null);
    setIdentity(null);
    setSession(null);
    setError(null);
    try {
      await authRef.current?.logout();
    } catch {
      if (mounted.current) setError("We couldn't sign you out. Try again.");
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((count) => count + 1);
  }, []);

  const value: SessionContextValue = {
    retry,
    webId: identity?.webId ?? null,
    session: session?.webId === identity?.webId ? session : null,
    fetch: auth?.fetch ?? publicFetch,
    logout,
    restoringSession,
    error,
    ready,
    pending,
    recentAccounts,
    recentProviders,
    loginWithAddress,
    loginWithIssuer,
    loginWithAccount,
  };
  return (
    <SessionContext.Provider value={value}>
      <authorization-code-flow ref={flowRef} data-testid="solid-auth-flow">
        <span slot="new-text">Open your provider's sign-in window to continue.</span>
        <span slot="switch-text">Finish signing in in the other window.</span>
      </authorization-code-flow>
      {children}
    </SessionContext.Provider>
  );
}
