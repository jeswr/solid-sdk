// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6.1-Sol
import type { Identity, LoginHint, PodAuth } from "@jeswr/pod-auth";
import { createRecentProvidersStore, resolveLoginTarget } from "@jeswr/pod-auth/directory";
import { sameIssuer } from "@jeswr/reactive-authentication";
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
import { authFlowHolder, lazyElementGetCode } from "./auth-flow-holder.js";
import { IssuerChoiceRequiredError } from "./issuer-choice.js";
import { clearLegacyCredentials, type LegacyKeys } from "./legacy-credentials.js";
import { allowInsecureLoopback, publicFetch } from "./pod-auth.js";
import { readProfile } from "./profile.js";
import { type DerivedSession, deriveSession } from "./session-derivation.js";
import { consumeAutologinAccount, signInError } from "./sign-in.js";

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
  /** Set when a WebID lists several providers; the card then offers just those, keeping the WebID. */
  issuerChoice?: { webId: string; issuers: readonly string[] };
  loginWithAddress(input: string, kind?: "webid" | "custom"): Promise<void>;
  loginWithIssuer(issuer: string): Promise<void>;
  loginWithAccount(webId: string): Promise<void>;
  /** True when the auth runtime failed to initialise; `retry` starts it again. */
  startupFailed: boolean;
  retry(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function accountHint(webId: string, issuer?: string): LoginHint {
  return issuer ? { webId, issuer } : { webId };
}

/** Address lookups give up after this long, so a silent host cannot freeze the card. */
export const LOOKUP_TIMEOUT_MS = 15_000;

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

export interface SessionProviderProps {
  children: ReactNode;
  getPodAuth: () => Promise<PodAuth>;
  appName: string;
  legacyCredentials?: LegacyKeys;
  dev?: boolean;
  auth?: PodAuth;
  lookupTimeoutMs?: number;
  readProfile?: typeof readProfile;
}

/** Mirror the shared core; never handle credentials or patch global fetch. */
export function SessionProvider({
  children,
  getPodAuth,
  appName,
  legacyCredentials = {},
  dev = false,
  auth: suppliedAuth,
  lookupTimeoutMs = LOOKUP_TIMEOUT_MS,
  readProfile: profileReader = readProfile,
}: SessionProviderProps) {
  const flowRef = useRef<AuthorizationCodeFlow>(null);
  const restoreRef = useRef<Promise<Identity | null> | null>(null);
  const authRef = useRef<PodAuth | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const activeLogin = useRef<symbol | null>(null);
  const loginController = useRef<AbortController | null>(null);
  const deepLink = useRef<string | null | undefined>(undefined);
  // Remembered issuers, so an account row never needs to choose among several issuers again.
  const accountIssuers = useRef(new Map<string, string>());
  const [attempt, setAttempt] = useState(0);
  const [startupFailed, setStartupFailed] = useState(false);
  const [auth, setAuth] = useState<PodAuth | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [session, setSession] = useState<DerivedSession | null>(null);
  const [restoringSession, setRestoringSession] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuerChoice, setIssuerChoice] = useState<SessionContextValue["issuerChoice"]>();
  const [recentAccounts, setRecentAccounts] = useState<SignInRecentAccount[]>([]);
  const store = useMemo(recentProvidersStore, []);
  const [recentProviders, setRecentProviders] = useState(() => store.list());

  // biome-ignore lint/correctness/useExhaustiveDependencies: startup settings and legacy keys are captured on mount; attempt retries initialization.
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let changed = false;
    const stops: (() => void)[] = [];
    // The provider always renders this element before its effect runs.
    const getCode = lazyElementGetCode(flowRef.current as AuthorizationCodeFlow);
    authFlowHolder.current = getCode;
    if (deepLink.current === undefined) {
      deepLink.current = consumeAutologinAccount(dev);
      clearLegacyCredentials(legacyCredentials);
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
        setStartupFailed(true);
        setRestoringSession(false);
      }
    });

    return () => {
      disposed = true;
      mounted.current = false;
      loginController.current?.abort();
      activeLogin.current = null;
      ++generation.current;
      for (const stop of stops) stop();
      if (authFlowHolder.current === getCode) authFlowHolder.current = null;
    };
  }, [suppliedAuth, getPodAuth, attempt]);

  useEffect(() => {
    let disposed = false;
    if (!identity?.webId) {
      setSession(null);
      return;
    }
    const webId = identity.webId;
    setSession(null);
    void profileReader(webId, publicFetch)
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
  }, [identity, profileReader]);

  const runLogin = useCallback(
    async (
      action: NonNullable<Pending>,
      target: (signal: AbortSignal) => Promise<LoginHint>,
      choice?: SessionContextValue["issuerChoice"],
    ) => {
      const core = authRef.current;
      if (!core || !ready || activeLogin.current) return;
      const attempt = Symbol();
      const started = generation.current;
      activeLogin.current = attempt;
      const controller = new AbortController();
      loginController.current = controller;
      setPending(action);
      setError(null);
      // A pick from the listed providers keeps that list on screen while it runs.
      setIssuerChoice(choice);
      let hint: LoginHint | undefined;
      const current = () =>
        mounted.current && generation.current === started && activeLogin.current === attempt;
      try {
        hint = await target(controller.signal);
        if (!current()) return;
        const loggedIn = await core.login(hint, { signal: controller.signal });
        if (!current()) return;
        setIssuerChoice(undefined);
        store.remember(loggedIn.issuer);
        setRecentProviders(store.list());
        setIdentity(loggedIn);
      } catch (failure) {
        if (current()) {
          setError(signInError(failure));
          // Offer the WebID's own providers and keep the WebID; a failed choice keeps the list.
          if (failure instanceof IssuerChoiceRequiredError && hint?.webId)
            setIssuerChoice({ webId: hint.webId, issuers: failure.issuers });
          else if (choice) setIssuerChoice(choice);
        }
      } finally {
        if (activeLogin.current === attempt) {
          activeLogin.current = null;
          setPending(null);
        }
      }
    },
    [ready, store],
  );

  const loginWithAddress = useCallback(
    (input: string, kind: "webid" | "custom" = "webid") =>
      runLogin({ kind, key: input }, async (signal) => {
        const target = await resolveLoginTarget(input, {
          fetch: publicFetch,
          signal: AbortSignal.any([signal, AbortSignal.timeout(lookupTimeoutMs)]),
          allowInsecureLoopback: allowInsecureLoopback(dev),
        });
        return target.kind === "webid" ? { webId: target.webId } : { issuer: target.issuer };
      }),
    [runLogin, dev, lookupTimeoutMs],
  );
  const loginWithIssuer = useCallback(
    (issuer: string) => {
      const choice = issuerChoice?.issuers.some((listed) => sameIssuer(listed, issuer))
        ? issuerChoice
        : undefined;
      return runLogin(
        { kind: "provider", key: issuer },
        async () => (choice ? accountHint(choice.webId, issuer) : { issuer }),
        choice,
      );
    },
    [runLogin, issuerChoice],
  );
  const loginWithAccount = useCallback(
    (webId: string) =>
      runLogin({ kind: "account", key: webId }, async () =>
        accountHint(webId, accountIssuers.current.get(webId)),
      ),
    [runLogin],
  );
  const logout = useCallback(async () => {
    loginController.current?.abort();
    ++generation.current;
    activeLogin.current = null;
    setPending(null);
    setIdentity(null);
    setSession(null);
    setError(null);
    setIssuerChoice(undefined);
    try {
      await authRef.current?.logout();
    } catch {
      if (mounted.current) setError("We couldn't sign you out. Try again.");
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setStartupFailed(false);
    setAttempt((count) => count + 1);
  }, []);

  const value: SessionContextValue = {
    retry,
    startupFailed,
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
    issuerChoice,
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
