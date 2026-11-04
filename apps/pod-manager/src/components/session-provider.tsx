// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { Identity, LoginHint, PodAuth } from "@jeswr/pod-auth";
import { createRecentProvidersStore, resolveLoginTarget } from "@jeswr/pod-auth/directory";
import { sameIssuer } from "@jeswr/reactive-authentication";
import type { SignInCardProps, SignInRecentAccount } from "@jeswr/suite-ui/sign-in";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { allowInsecureLoopback } from "@/lib/auth-environment";
import { PopupLoginController } from "@/lib/popup-login";
import { fetchProfile, type PodProfile } from "@/lib/profile";
import { consumeSuggestedAccount, IssuerChoiceRequiredError, signInError } from "@/lib/sign-in";
import { publicFetch, sourceFetch } from "@/lib/source-fetch";
import { readCache } from "@/lib/swr-cache";
import { IssueAssignmentAnnouncer } from "@/lib/issues";

type Status = "loading" | "logged-out" | "authenticating" | "logged-in";
type Pending = SignInCardProps["pending"];
export interface Session {
  sourceFetch: typeof fetch;
  podFetch: typeof fetch;
  status: Status;
  webId?: string;
  profile?: PodProfile;
  activeStorage?: string;
  issueAssignments?: IssueAssignmentAnnouncer;
  recentAccounts: SignInRecentAccount[];
  recentProviders: string[];
  pending: Pending;
  error: string | null;
  ready: boolean;
  startupFailed: boolean;
  retry(): void;
  loginWithAddress(input: string, kind?: "webid" | "custom"): Promise<void>;
  /** Set when the WebID lists several providers; loginWithIssuer then keeps that WebID. */
  issuerChoice?: { webId: string; issuers: readonly string[] };
  loginWithIssuer(issuer: string): Promise<void>;
  loginWithAccount(webId: string): Promise<void>;
  cancelLogin(): void;
  logout(): Promise<void>;
  setActiveStorage(storage: string): void;
}
const SessionContext = createContext<Session | null>(null);

/** The removed provider's refresh tokens and keys must never survive migration. */
export function clearLegacyCredentials(): void {
  try {
    globalThis.indexedDB?.deleteDatabase("solid-pod-manager:sessions");
  } catch {
    /* Unavailable storage. */
  }
  for (const key of ["solid-pod-manager:active-webid", "solid:recent-accounts"]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Unavailable storage. */
    }
  }
}
function recentProvidersStore() {
  try {
    return createRecentProvidersStore(localStorage);
  } catch {
    return createRecentProvidersStore(undefined);
  }
}

/** React owns presentation and popup gestures; pod-auth owns all session credentials. */
export function SessionProvider({
  children,
  auth: suppliedAuth,
}: {
  children: React.ReactNode;
  auth?: PodAuth;
}) {
  const coreRef = useRef<PodAuth | null>(null);
  const restoreRef = useRef<{ core: PodAuth; promise: Promise<Identity | null> } | null>(null);
  const controller = useRef<PopupLoginController | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const cancelled = useRef<symbol | null>(null);
  // The attempt whose login already produced a pod-auth session (cancel must then drop it).
  const established = useRef<symbol | null>(null);
  const activeLogin = useRef<symbol | null>(null);
  /** Abandons the running login inside pod-auth, which discards any grant that lands later. */
  const loginAbort = useRef<AbortController | null>(null);
  const suggested = useRef<string | undefined>(undefined);
  const cleaned = useRef(false);
  const accountIssuers = useRef(new Map<string, string>());
  const [attempt, setAttempt] = useState(0);
  const [startupFailed, setStartupFailed] = useState(false);
  const [core, setCore] = useState<PodAuth | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [profile, setProfile] = useState<PodProfile>();
  const [activeStorage, setActiveStorage] = useState<string>();
  const [recentAccounts, setRecentAccounts] = useState<SignInRecentAccount[]>([]);
  const [recentProviders, setRecentProviders] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuerChoice, setIssuerChoice] = useState<Session["issuerChoice"]>();
  const [ready, setReady] = useState(false);
  const store = useMemo(recentProvidersStore, []);

  const reset = useCallback(() => {
    readCache.clearAll();
    setProfile(undefined);
    setActiveStorage(undefined);
    setPending(null);
    setStatus("logged-out");
  }, []);
  const accounts = useCallback(async (auth: PodAuth, current: () => boolean) => {
    const remembered = await auth.remembered();
    if (!current()) return;
    accountIssuers.current.clear();
    for (const account of remembered) accountIssuers.current.set(account.webId, account.issuer);
    const rows: SignInRecentAccount[] = remembered.map((a) => ({
      webId: a.webId,
      name: a.displayName,
      photoUrl: a.avatar,
    }));
    if (suggested.current && !rows.some((a) => a.webId === suggested.current))
      rows.push({ webId: suggested.current });
    setRecentAccounts(rows);
  }, []);
  const publish = useCallback(async (identity: Identity, current: () => boolean) => {
    if (!identity.webId) throw new Error("No WebID returned");
    const webId = identity.webId;
    const loaded = await fetchProfile(webId, publicFetch).catch(
      (): PodProfile => ({
        webId,
        profileDocumentUrl: webId.split("#")[0],
        displayName: webId,
        storages: [...identity.storages],
        issuers: [identity.issuer],
      }),
    );
    if (!current()) return;
    // Storage authority comes from the core's verified identity, even if public profile metadata changes.
    setProfile({ ...loaded, storages: [...identity.storages] });
    setActiveStorage(identity.storages[0]);
    setStatus("logged-in");
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const started = generation.current;
    const current = () => !disposed && generation.current === started;
    const stops: (() => void)[] = [];
    let runtime: typeof import("@/lib/pod-auth") | undefined;
    controller.current ??= new PopupLoginController({ expectedOrigin: location.origin });
    const popup = controller.current;
    if (!cleaned.current) {
      cleaned.current = true;
      clearLegacyCredentials();
      suggested.current = consumeSuggestedAccount();
    }
    setRecentProviders(store.list());
    void (async () => {
      if (!suppliedAuth) runtime = await import("@/lib/pod-auth");
      if (disposed) return;
      if (runtime) runtime.popupHolder.current = popup;
      const auth = suppliedAuth ?? runtime!.getPodAuth();
      coreRef.current = auth;
      setCore(auth);
      for (const type of ["logout", "expired"] as const)
        stops.push(
          auth.on(type, () => {
            if (disposed) return;
            ++generation.current;
            activeLogin.current = null;
            popup.cancel();
            reset();
            const epoch = generation.current;
            void accounts(auth, () => !disposed && generation.current === epoch).catch(() => {});
          }),
        );
      if (restoreRef.current?.core !== auth)
        restoreRef.current = { core: auth, promise: auth.restore() };
      let restored: Identity | null = null;
      try {
        restored = await restoreRef.current.promise;
      } catch {
        if (current()) setError("We couldn't restore your last session. Sign in again.");
      }
      if (!current()) {
        if (!disposed) setReady(true);
        return;
      }
      if (restored) await publish(restored, current);
      else setStatus("logged-out");
      await accounts(auth, current);
      if (current()) setReady(true);
    })().catch(() => {
      if (!current()) return;
      reset();
      setError("We couldn't start sign-in. Try again.");
      setStartupFailed(true);
      setStatus("logged-out");
    });
    return () => {
      disposed = true;
      mounted.current = false;
      // Read the live operation epoch to invalidate all work started before unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generation.current;
      const hadLogin = activeLogin.current !== null;
      activeLogin.current = null;
      popup.cancel();
      for (const stop of stops) stop();
      if (hadLogin) void coreRef.current?.logout().catch(() => {});
      if (runtime?.popupHolder.current === popup) runtime.popupHolder.current = null;
    };
  }, [suppliedAuth, attempt, accounts, publish, reset, store]);

  const dropCancelled = useCallback(async (auth: PodAuth) => {
    // Runs even after unmount: the core outlives the provider and would restore this session.
    await auth.logout().catch(() => {});
    if (mounted.current) setReady(true);
  }, []);
  const runLogin = useCallback(
    async (
      action: NonNullable<Pending>,
      target: () => Promise<LoginHint>,
      choice?: Session["issuerChoice"],
    ) => {
      const auth = coreRef.current;
      if (!auth || !ready || activeLogin.current) return;
      const token = Symbol();
      const epoch = ++generation.current;
      activeLogin.current = token;
      const abort = new AbortController();
      loginAbort.current = abort;
      const current = () =>
        mounted.current && generation.current === epoch && activeLogin.current === token;
      setPending(action);
      setStatus("authenticating");
      setError(null);
      setIssuerChoice(undefined);
      let hint: LoginHint | undefined;
      try {
        // Before the first await: the click's activation is still live.
        controller.current!.open();
        hint = await target();
        if (!current()) return;
        const identity = await auth.login(hint, { signal: abort.signal });
        established.current = token;
        if (!current()) {
          // Cancelled while the provider answered: drop the session before sign-in reopens.
          if (cancelled.current === token) await dropCancelled(auth);
          return;
        }
        controller.current!.closeIfOpen();
        await publish(identity, current);
        if (!current()) return;
        store.remember(identity.issuer);
        setRecentProviders(store.list());
        await accounts(auth, current);
      } catch (failure) {
        if (current()) {
          reset();
          setError(signInError(failure));
          // Offer the WebID's own providers and keep the WebID; a failed choice keeps the list.
          if (failure instanceof IssuerChoiceRequiredError && hint?.webId)
            setIssuerChoice({ webId: hint.webId, issuers: failure.issuers });
          else if (choice) setIssuerChoice(choice);
        }
      } finally {
        if (loginAbort.current === abort) loginAbort.current = null;
        // A cancel before any session existed reopens sign-in at once: pod-auth rejects the aborted
        // login immediately and discards anything the abandoned attempt still obtains.
        if (cancelled.current === token && established.current !== token && mounted.current)
          setReady(true);
        if (activeLogin.current === token) {
          activeLogin.current = null;
          controller.current?.closeIfOpen();
          if (mounted.current) setPending(null);
        }
      }
    },
    [ready, publish, accounts, reset, store, dropCancelled],
  );
  const loginWithAddress = useCallback(
    (input: string, kind: "webid" | "custom" = "webid") =>
      runLogin({ kind, key: input }, async () => {
        const target = await resolveLoginTarget(input, {
          fetch: publicFetch,
          signal: AbortSignal.timeout(15_000),
          allowInsecureLoopback: allowInsecureLoopback(),
        });
        return target.kind === "webid" ? { webId: target.webId } : { issuer: target.issuer };
      }),
    [runLogin],
  );
  const loginWithIssuer = useCallback(
    (issuer: string) => {
      const choice = issuerChoice?.issuers.some((listed) => sameIssuer(listed, issuer))
        ? issuerChoice
        : undefined;
      return runLogin(
        { kind: "provider", key: issuer },
        async () => (choice ? { webId: choice.webId, issuer } : { issuer }),
        choice,
      );
    },
    [runLogin, issuerChoice],
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
    controller.current?.cancel();
    reset();
    setError(null);
    setIssuerChoice(undefined);
    setReady(false);
    try {
      await coreRef.current?.logout();
    } catch {
      if (mounted.current) setError("We couldn't sign you out. Try again.");
    } finally {
      if (mounted.current) setReady(true);
    }
  }, [reset]);
  const cancelLogin = useCallback(() => {
    // Abandon only this attempt: remembered accounts and their stored sessions stay, unless this
    // attempt already signed in, in which case that new session is dropped at once.
    const token = activeLogin.current;
    if (!token) return;
    cancelled.current = token;
    ++generation.current;
    activeLogin.current = null;
    loginAbort.current?.abort(new DOMException("Sign-in was cancelled", "AbortError"));
    controller.current?.cancel();
    reset();
    setPending(null);
    setError("Sign-in was cancelled.");
    // Sign-in stays closed until the aborted login has rejected (pod-auth does so at once) or the
    // session it already made has been dropped.
    setReady(false);
    if (established.current === token && coreRef.current) void dropCancelled(coreRef.current);
  }, [reset, dropCancelled]);
  const retry = useCallback(() => {
    restoreRef.current = null;
    setStartupFailed(false);
    setError(null);
    setReady(false);
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);
  const webId = profile?.webId;
  const issueAssignments = useMemo(
    () =>
      status === "logged-in" && webId
        ? new IssueAssignmentAnnouncer({
            actorWebId: webId,
            fetchImpl: core?.fetch ?? publicFetch,
            onError: (message) => toast.error(message),
          })
        : undefined,
    [status, webId, core],
  );
  const session: Session = {
    sourceFetch,
    podFetch: core?.fetch ?? publicFetch,
    status,
    webId,
    profile,
    activeStorage,
    issueAssignments,
    recentAccounts,
    recentProviders,
    pending,
    error,
    issuerChoice,
    ready,
    startupFailed,
    retry,
    loginWithAddress,
    loginWithIssuer,
    loginWithAccount,
    cancelLogin,
    logout,
    setActiveStorage,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used within <SessionProvider>");
  return session;
}
