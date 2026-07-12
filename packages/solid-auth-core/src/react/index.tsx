// AUTHORED-BY Claude Fable 5
//
// @jeswr/solid-auth-core/react — the thin React layer over the framework-free
// core: ONE SessionProvider + useSolidSession() replacing the 14 hand-rolled,
// >1,200-line-divergent app-local SessionProvider copies (shared-logic
// upstreaming review, cluster B).
//
// DESIGN:
//   • The provider OWNS nothing security-critical — all credential handling
//     lives in the core `SolidAuth` object (created once, StrictMode-safe). The
//     React layer only mirrors {status, webId, error} into state and exposes the
//     core's fetches + actions.
//   • Injectable-auth seam: pass a ready `auth` (a `SolidAuth`, incl. a test
//     fake) OR a `config` the provider turns into one via `createSolidAuth`.
//     Tests exercise the full component tree with a fake — no server, no OP.
//   • SILENT RESTORE ON LOAD (suite cross-app invariant #1): on mount the
//     provider runs `auth.restore()` once (the core single-flights concurrent
//     calls, so a StrictMode double-mount cannot double-restore) and lands on
//     `authenticated` or `unauthenticated` — a brief `restoring` state, never a
//     login wall when a persisted session exists.
//   • The provider subscribes to `auth.onSessionChange`, so a login/logout done
//     OUTSIDE React (e.g. another component sharing the same auth object) is
//     reflected too. Unmount unsubscribes; a post-unmount event is ignored.

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
// NOTE: everything from the core is imported via "../index.js" (never a deep
// module path) — the dist build keeps that specifier EXTERNAL so the /react
// bundle shares the ONE core module instance (its pristine snapshot + install
// singleton are module state).
import { createSolidAuth, type SolidAuth, type SolidAuthConfig } from "../index.js";

/** The session state machine the suite's apps share. */
export type SolidSessionStatus = "restoring" | "unauthenticated" | "authenticated";

/** What {@link useSolidSession} returns. */
export interface SolidSession {
  /** `restoring` (on-load silent restore in flight) → `authenticated` | `unauthenticated`. */
  status: SolidSessionStatus;
  /** The authenticated WebID, or null. */
  webId: string | null;
  /**
   * The session-bound fetch (attaches the DPoP token for allowed origins; the
   * pristine fetch while logged out). STABLE identity across renders — safe in
   * dependency arrays; it reads the live session on every call.
   */
  fetch: typeof fetch;
  /** The pristine, credential-free fetch (foreign-origin / public reads). */
  publicFetch: typeof fetch;
  /** Interactive login (optionally for a specific WebID). Errors surface in {@link error}. */
  login: (webId?: string) => Promise<void>;
  /** Log out (clears the persisted credential; fail-closed to logged-out). */
  logout: () => Promise<void>;
  /** The last login/logout error message, or null. Cleared on the next attempt. */
  error: string | null;
  /** The underlying core object, for advanced use (recentAccounts, issuer, …). */
  auth: SolidAuth;
}

const SolidSessionContext = createContext<SolidSession | null>(null);

/** Props for {@link SessionProvider}: a ready `auth` OR a `config` to build one. */
export type SessionProviderProps = {
  children?: ReactNode;
} & ({ auth: SolidAuth; config?: never } | { config: SolidAuthConfig; auth?: never });

/**
 * Mount ONE of these at the app root. It creates (or adopts) the core
 * {@link SolidAuth}, silently restores on load, and provides
 * {@link useSolidSession} to the tree.
 */
export function SessionProvider(props: SessionProviderProps): ReactNode {
  const { children } = props;
  // Create the auth object EXACTLY ONCE (never re-created on re-render — a new
  // engine mid-session would drop the live session). An injected `auth` is
  // adopted as-is; a `config` is turned into one on first render. The first
  // render's choice sticks (changing props later is a consumer bug we tolerate
  // by ignoring, not by re-creating a credential engine).
  const authRef = useRef<SolidAuth | null>(null);
  if (authRef.current === null) {
    authRef.current = props.auth ?? createSolidAuth(props.config);
  }
  const auth = authRef.current;

  const [status, setStatus] = useState<SolidSessionStatus>("restoring");
  const [webId, setWebId] = useState<string | null>(auth.webId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    // Mirror EVERY core session change (incl. ones initiated outside React).
    const unsubscribe = auth.onSessionChange(({ webId: current }) => {
      if (disposed) return;
      setWebId(current);
      setStatus(current !== null ? "authenticated" : "unauthenticated");
    });
    // SILENT RESTORE ON LOAD. The core single-flights concurrent restores, so a
    // StrictMode double-mount shares one attempt. restore() is fail-closed
    // (never throws; any failure = { outcome: "login" }), but guard anyway so a
    // fake-auth test double that throws still lands on the login prompt.
    void auth
      .restore()
      .catch((): { outcome: "login" } => ({ outcome: "login" }))
      .then((outcome) => {
        if (disposed) return;
        if (outcome.outcome === "restored") {
          setWebId(outcome.webId);
          setStatus("authenticated");
        } else {
          // Don't clobber a session a concurrent login already established.
          setWebId((prev) => prev ?? auth.webId);
          setStatus(auth.webId !== null ? "authenticated" : "unauthenticated");
        }
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [auth]);

  // STABLE-identity handles (per auth object, i.e. for the provider's lifetime):
  // the fetch delegates PER-CALL to the live engine getter (authenticatedFetch is
  // pristine while logged out, the DPoP-attaching wrapper while live), so
  // consumers can safely keep `session.fetch` / `login` / `logout` in dependency
  // arrays without effect churn on every status change. (setError from useState
  // is itself identity-stable, so these closures never go stale.)
  const handles = useMemo(() => {
    const sessionFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      auth.authenticatedFetch(input, init)) as typeof fetch;
    const login = async (target?: string): Promise<void> => {
      setError(null);
      try {
        await auth.login(target);
        // state lands via onSessionChange
      } catch (e) {
        // A superseded/cancelled attempt (AbortError) is not a user-facing error.
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    };
    const logout = async (): Promise<void> => {
      setError(null);
      try {
        await auth.logout();
      } catch (e) {
        // Local teardown already happened (fail-closed); surface the durable-
        // delete failure but the session state (logged out) came via the event.
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    };
    return { sessionFetch, login, logout };
  }, [auth]);

  const session = useMemo<SolidSession>(
    () => ({
      status,
      webId,
      fetch: handles.sessionFetch,
      publicFetch: auth.publicFetch,
      login: handles.login,
      logout: handles.logout,
      error,
      auth,
    }),
    [auth, handles, status, webId, error],
  );

  return createElement(SolidSessionContext.Provider, { value: session }, children);
}

/**
 * The session hook. Must be used under a {@link SessionProvider}; throws a
 * targeted error otherwise (the classic silent-null footgun).
 */
export function useSolidSession(): SolidSession {
  const session = useContext(SolidSessionContext);
  if (session === null) {
    throw new Error(
      "useSolidSession() must be used inside a <SessionProvider> " +
        "(@jeswr/solid-auth-core/react). Mount one at your app root.",
    );
  }
  return session;
}

export type { SolidAuth, SolidAuthConfig } from "../index.js";
