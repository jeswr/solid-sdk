"use client";
// AUTHORED-BY Codex GPT-6.1-Sol

/**
 * The Solid session bridge for React. `@solid/reactive-authentication` has no
 * session object: it patches `globalThis.fetch` and upgrades on `401`. This
 * provider owns that single patch and the LOGIN POPUP LIFECYCLE (first-party —
 * the library's `<authorization-code-flow>` web component is gone; see
 * `src/lib/popup-login.ts` for the rules), and exposes a small reactive
 * session for the UI.
 *
 * Login model (first-party UI): the user picks a provider, or enters EITHER a
 * WebID OR a bare issuer URL in one smart input (`src/lib/login-input.ts`).
 * The popup is opened SYNCHRONOUSLY in the click handler (user activation) —
 * UNLESS the provider's synchronous probe says a cached session or refresh
 * token completes the login with fetches alone (`openPopupUnlessRenewable`),
 * in which case no window opens at all. When one does open, the protocol
 * layer (`WebIdDPoPTokenProvider` — the vendored PR #11–#14
 * token+refresh logic) navigates it straight to the INTERACTIVE authorize URL
 * (explicit logins skip the doomed `prompt=none` hop; recent-account clicks
 * and background 401 re-auth keep silent-first, retrying interactively in the
 * same window). Issuer-first logins learn the WebID from the ID token's
 * `webid` claim. Access tokens stay in memory; reload restores the DPoP-bound
 * refresh credential and validates the authenticated profile.
 *
 * The auth library is dynamically imported so it never evaluates during SSR
 * (AGENTS.md §Mounting in Next.js).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RecentAccounts, type RecentAccount } from "@/lib/login-ux";
import { openPopupUnlessRenewable, PopupLoginController } from "@/lib/popup-login";
import type { WebIdDPoPTokenProvider } from "@/lib/webid-token-provider";
import {
  IndexedDbSessionStore,
  indexedDbAvailable,
  type SessionStore,
} from "@/lib/session-persistence";
import type { PodProfile } from "@/lib/profile";
import { SessionOperations } from "@/lib/session-operations";
import { sourceFetch } from "@/lib/source-fetch";
import { readCache } from "@/lib/swr-cache";
import { IssueAssignmentAnnouncer } from "@/lib/issues";
import { toast } from "sonner";

export { NoWebIdFromProviderError } from "@/lib/session-operations";

type Status = "loading" | "logged-out" | "authenticating" | "logged-in";

export interface Session {
  /** Separate source and Pod transports for connector imports. */
  sourceFetch: typeof fetch;
  podFetch: typeof fetch;
  status: Status;
  webId?: string;
  /** Assignment de-duplication survives route changes and ends with this login. */
  issueAssignments?: IssueAssignmentAnnouncer;
  profile?: PodProfile;
  /** The storage the user is browsing (chosen when several exist). */
  activeStorage?: string;
  recentAccounts: RecentAccount[];
  /**
   * Begin login for a WebID OR a bare issuer URL (one smart input). Call
   * DIRECTLY from the click/submit handler — when a popup is needed it opens
   * synchronously at the top so the user activation is never lost; when the
   * issuer is known up front (`opts.issuer`) and a cached session or refresh
   * token suffices, no popup opens at all. Resolves once
   * authenticated; throws on failure ({@link AmbiguousIssuerError} when the
   * WebID advertises several issuers and `opts.issuer` was not given).
   *
   * Interactive-first by default: an explicit sign-in has (almost always) no
   * IdP session, so the popup navigates straight to the login page instead of
   * bouncing through a doomed `prompt=none` attempt. `opts.silentFirst` keeps
   * the silent attempt for one-click surfaces where a live IdP session is
   * likely (the recent-account chips) — silent success there means zero typing.
   */
  login(input: string, opts?: { issuer?: string; silentFirst?: boolean }): Promise<void>;
  /**
   * Begin login against a KNOWN issuer (provider picker / "Get started" with
   * the home provider — works for a fresh human with no WebID). Call directly
   * from the click handler, like {@link login}.
   */
  loginWithIssuer(issuer: string): Promise<void>;
  /** Cancel an in-flight login: closes the popup, rejects the pending flow. */
  cancelLogin(): void;
  /** Log out: clears session state. Keeps the recent-accounts memory. */
  logout(): void;
  /** Pick which storage to browse when the profile advertises several. */
  setActiveStorage(storage: string): void;
}

const SessionContext = createContext<Session | null>(null);

const ACTIVE_WEBID_KEY = "solid-pod-manager:active-webid";

/** A blocked-popup recovery: `resume` re-opens under a fresh user gesture. */
interface BlockedPopup {
  resume: () => void;
  cancel: () => void;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const registeredRef = useRef(false);
  const podTransportRef = useRef<typeof fetch | null>(null);
  // Validated session identity for the provider's 401 issuer resolution.
  const pendingWebIdRef = useRef<string>(undefined);
  // Shared ownership for login, reload restore and logout.
  const operationsRef = useRef<SessionOperations | null>(null);
  // The one popup controller — created lazily on the client, shared between
  // the click handlers (synchronous open) and the token provider (getCode).
  const controllerRef = useRef<PopupLoginController>(null);
  // Resolves to the token provider once the auth module is wired up.
  const providerReadyRef = useRef<Promise<WebIdDPoPTokenProvider>>(null);
  const podFetch = useCallback<typeof fetch>(async (input, init) => {
    await providerReadyRef.current;
    if (!podTransportRef.current) throw new Error("Pod transport is not initialized");
    return podTransportRef.current(input, init);
  }, []);
  // The SAME provider, synchronously reachable once ready — the click handlers
  // consult its canRenewWithoutInteraction probe BEFORE deciding to open a
  // popup, and a click handler cannot await (the user activation would be
  // spent). Null until the auth module loads; the probe then says "open".
  const providerSyncRef = useRef<WebIdDPoPTokenProvider>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [webId, setWebId] = useState<string>();
  const [profile, setProfile] = useState<PodProfile>();
  const [activeStorage, setActive] = useState<string>();
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([]);
  const [blockedPopup, setBlockedPopup] = useState<BlockedPopup | null>(null);

  /** The popup controller (client-only; created on first use). */
  const getController = useCallback((): PopupLoginController => {
    controllerRef.current ??= new PopupLoginController({
      // callback.html is same-origin with the app — the ONLY origin whose
      // postMessage may end a flow.
      expectedOrigin: location.origin,
      onBlocked: (resume, cancel) =>
        setBlockedPopup({
          resume: () => {
            setBlockedPopup(null);
            resume();
          },
          cancel: () => {
            setBlockedPopup(null);
            cancel();
          },
        }),
    });
    return controllerRef.current;
  }, []);

  const getOperations = useCallback(() => {
    operationsRef.current ??= new SessionOperations({
      provider: async () => providerReadyRef.current,
      currentProvider: () => providerSyncRef.current,
      openPopup: (issuer, expectedWebId) => openPopupUnlessRenewable(
        getController(), providerSyncRef.current, issuer, expectedWebId,
      ),
      closePopup: () => getController().closeIfOpen(),
      authenticating: () => setStatus("authenticating"),
      seedIdentity: (id) => { pendingWebIdRef.current = id; },
      publish: (id, p, issuer, remember) => {
        setWebId((prev) => {
          if (prev && prev !== id) readCache.clearWebId(prev);
          return id;
        });
        setProfile(p);
        setActive(p.storages[0]);
        setStatus("logged-in");
        if (remember) {
          const accounts = new RecentAccounts();
          accounts.remember({ webId: id, displayName: p.displayName, avatarUrl: p.avatarUrl, issuer, storage: p.storages[0] });
          setRecentAccounts(accounts.list());
        }
        if (typeof localStorage !== "undefined") localStorage.setItem(ACTIVE_WEBID_KEY, id);
      },
      failed: () => {
        getController().closeIfOpen();
        setBlockedPopup(null);
        setStatus("logged-out");
      },
      loggedOut: () => {
        readCache.clearAll();
        setWebId(undefined);
        setProfile(undefined);
        setActive(undefined);
        setStatus("logged-out");
        setBlockedPopup(null);
        pendingWebIdRef.current = undefined;
        getController().cancel();
        try { localStorage.removeItem(ACTIVE_WEBID_KEY); } catch { /* Storage may be unavailable. */ }
      },
    });
    return operationsRef.current;
  }, [getController]);

  // Register the reactive fetch manager once.
  useEffect(() => {
    if (registeredRef.current) return;
    registeredRef.current = true;

    providerReadyRef.current = (async () => {
      const [{ ReactiveFetchManager }, { WebIdDPoPTokenProvider }] =
        await Promise.all([
          import("@solid/reactive-authentication"),
          import("@/lib/webid-token-provider"),
        ]);

      const controller = getController();
      const callbackUri = new URL("/callback.html", location.href).toString();

      // The published Client Identifier Document — served from /clientid.jsonld.
      // Locally the IdP is CSS, which dereferences localhost client-ids; in
      // production both app and IdP are HTTPS so it resolves there too
      // (solid-client-id skill).
      const clientId = new URL("/clientid.jsonld", location.href).toString();

      // Durable DPoP-bound refresh-token session (IndexedDB, origin-scoped) —
      // lets a returning user restore via a refresh grant (a fetch) instead of
      // the prompt=none authorization probe that flashes a window. Absent in
      // SSR / locked-down environments; the provider then stays in-memory only.
      const sessionStore: SessionStore | undefined = indexedDbAvailable()
        ? new IndexedDbSessionStore()
        : undefined;

      const provider = new WebIdDPoPTokenProvider(
        callbackUri,
        // The app-owned popup drives the user through the authorization
        // endpoint (silent first, interactive retry in the same window).
        (uri, signal) => controller.getCode(uri, signal),
        // Issuer resolution is available only after validated login or restore.
        async () => {
          const id = pendingWebIdRef.current;
          if (!id) throw new Error("No WebID provided for login");
          return id;
        },
        {
          clientId,
          allowInsecureLoopback: true, // local CSS over HTTP; remote stays HTTPS-strict
          sessionStore,
          // Keep the cached session continuously fresh in the BACKGROUND so a
          // long import or an idle→active session never hits an expired token
          // mid-flow. Visibility-gated (no churn in a hidden tab); torn down on
          // unmount; stops (no popup) on a dead refresh token. The lazy
          // renew-on-401 path remains the fallback. (Dom visibility lifecycle is
          // the default in a browser.)
          proactiveRefresh: true,
        },
      );

      const manager = new ReactiveFetchManager([provider]);
      podTransportRef.current = manager.fetch;
      manager.registerGlobally();
      providerSyncRef.current = provider;
      return provider;
    })();

    const accounts = new RecentAccounts();
    const remembered = accounts.list();
    setRecentAccounts(remembered);
    const last = typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_WEBID_KEY) : null;
    if (last) {
      void getOperations().restore(last, remembered.find((a) => a.webId === last)?.issuer).catch(() => {});
    } else {
      setStatus("logged-out");
    }

    return () => {
      operationsRef.current?.invalidate();
      // Tear down proactive-refresh timers + the visibility listeners on
      // unmount so nothing leaks (no orphaned intervals, no token churn) after
      // this provider is discarded. Fire-and-forget; teardown is idempotent.
      void providerReadyRef.current?.then((p) => p?.teardown()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    (input: string, opts?: { issuer?: string; silentFirst?: boolean }) => getOperations().login(input, opts),
    [getOperations],
  );

  const loginWithIssuer = useCallback(
    (issuer: string) => getOperations().loginWithIssuer(issuer),
    [getOperations],
  );

  const cancelLogin = useCallback(() => {
    setBlockedPopup(null);
    getController().cancel();
  }, [getController]);

  const logout = useCallback(() => {
    void getOperations().logout().catch(() => {});
  }, [getOperations]);

  const setActiveStorage = useCallback((storage: string) => setActive(storage), []);

  const issueAssignments = useMemo(
    () => status === "logged-in" && webId
      ? new IssueAssignmentAnnouncer({
          actorWebId: webId,
          onError: (message) => { toast.error(message); },
        })
      : undefined,
    [status, webId],
  );

  const session = useMemo<Session>(
    () => ({
      sourceFetch,
      podFetch,
      status,
      webId,
      issueAssignments,
      profile,
      activeStorage,
      recentAccounts,
      login,
      loginWithIssuer,
      cancelLogin,
      logout,
      setActiveStorage,
    }),
    [
      podFetch,
      status,
      webId,
      issueAssignments,
      profile,
      activeStorage,
      recentAccounts,
      login,
      loginWithIssuer,
      cancelLogin,
      logout,
      setActiveStorage,
    ],
  );

  return (
    <SessionContext.Provider value={session}>
      {children}
      {/* Blocked-popup recovery: a background re-auth needed a popup but the
          browser blocked window.open (no user activation). The button click
          IS the fresh activation `resume()` re-opens under. */}
      {blockedPopup && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="popup-blocked-title"
          className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg">
            <h2 id="popup-blocked-title" className="text-base font-semibold">
              Continue signing in
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your provider needs a sign-in window, but the browser blocked it.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={blockedPopup.cancel}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={blockedPopup.resume}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Open sign-in window
              </button>
            </div>
          </div>
        </div>
      )}
    </SessionContext.Provider>
  );
}

/** Access the Solid session. Must be used under {@link SessionProvider}. */
export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
