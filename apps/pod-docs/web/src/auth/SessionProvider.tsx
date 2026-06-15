// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SessionProvider — the ONE place auth is wired for the Pod Docs static host.
// It mounts the browser-only <authorization-code-flow> popup element, builds a
// WebID-driven DPoP token provider bound to THIS origin's static Client
// Identifier Document, and calls registerGlobally() so EVERY plain `fetch()`
// (including the ones inside @jeswr/fetch-rdf and the @jeswr/pod-docs data layer)
// transparently upgrades on a 401 with a DPoP token. The library's
// `fetch?:` seam can then be left as the ambient global — no per-call wiring.
//
// LOAD-BEARING HOUSE RULES (do not "simplify" away):
//  1. @solid/reactive-authentication is pure-ESM + browser-only (custom elements,
//     popups). It is loaded via a DYNAMIC import inside an effect so it NEVER
//     evaluates at module-eval / SSR / prerender time. (This host has no SSR, but
//     keeping the dynamic import means the bundle has no top-level reactive-auth
//     evaluation — verified by the build gate.)
//  2. The 0.1.3 ReactiveFetchManager CONSTRUCTOR DOES NOT PATCH fetch — you MUST
//     call `manager.registerGlobally()`. Forgetting it is the #1 reactive-auth bug.
//  3. The client_id is the per-origin static Client Identifier Document at
//     `${origin}/clientid.jsonld` (generated at build by scripts/gen-clientid.mjs),
//     so the OP shows "Pod Docs" on the consent screen instead of a throwaway
//     dynamic registration.
//  4. `allowInsecureLoopback` is enabled ONLY for a localhost origin (dev against
//     a local CSS over HTTP); a deployed HTTPS origin stays strict.

import type { AuthorizationCodeFlow } from "@solid/reactive-authentication";
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
import { assessLoginProbe } from "./login-result";
import { readProfile } from "./profile";
import { type DerivedSession, deriveSession } from "./session-derivation";
import { AmbiguousIssuerError, WebIdDPoPTokenProvider } from "./webid-token-provider";

export interface SessionContextValue {
  /** The authenticated user's WebID, else null. */
  webId: string | null;
  /** The derived session (pod root + documents container) once logged in. */
  session: DerivedSession | null;
  /** True while a login flow is running. */
  loggingIn: boolean;
  /** Last login error, surfaced to the UI. */
  error: string | null;
  /** True once the auth runtime has loaded and registerGlobally() ran. */
  ready: boolean;
  /** Begin login for a WebID. Resolves when authenticated, rejects on failure. */
  login: (webId: string) => Promise<void>;
  /** Drop the in-memory session (tokens are memory-only; this clears app state). */
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Read the session state anywhere under <SessionProvider>. */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const flowRef = useRef<AuthorizationCodeFlow>(null);
  const pendingWebId = useRef<string | null>(null);
  const providerRef = useRef<WebIdDPoPTokenProvider | null>(null);
  // The original, un-upgrading fetch snapshotted BEFORE registerGlobally patches
  // the global — used for the pre-popup public profile read so it can never
  // recurse into the provider on a 401.
  const profileFetchRef = useRef<typeof fetch | null>(null);
  const [ready, setReady] = useState(false);
  const [webId, setWebId] = useState<string | null>(null);
  const [session, setSession] = useState<DerivedSession | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mount the auth runtime once, client-side, after the element exists.
  useEffect(() => {
    let cancelled = false;
    async function loadAuth() {
      const ui = flowRef.current;
      if (!ui) return;
      // Snapshot the pristine global fetch BEFORE the manager patches it.
      profileFetchRef.current = globalThis.fetch.bind(globalThis);
      // Dynamic import — keeps the browser-only custom element + oauth stack out
      // of any module-eval / prerender path.
      const { ReactiveFetchManager } = await import("@solid/reactive-authentication");
      const origin = location.origin;
      const callbackUri = new URL("/callback.html", location.href).toString();
      const clientId = new URL("/clientid.jsonld", location.href).toString();
      const provider = new WebIdDPoPTokenProvider(
        callbackUri,
        ui.getCode.bind(ui),
        async () => {
          const id = pendingWebId.current;
          if (!id) throw new Error("No WebID set for login");
          return id;
        },
        {
          clientId,
          // Only a localhost deployment may target an HTTP/loopback issuer.
          allowInsecureLoopback: isLoopbackOrigin(origin),
          profileFetch: profileFetchRef.current,
        },
      );
      const manager = new ReactiveFetchManager([provider]);
      manager.registerGlobally(); // 0.1.3: the constructor does NOT patch fetch — THIS does.
      if (!cancelled) {
        providerRef.current = provider;
        setReady(true);
      }
    }
    loadAuth().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (id: string) => {
    setError(null);
    setLoggingIn(true);
    pendingWebId.current = id;
    try {
      // Read the PUBLIC profile FIRST (pristine fetch) so an unusable WebID errors
      // early — before any popup — and gives us the storage to probe.
      const pub = await readProfile(id, profileFetchRef.current ?? undefined);
      const tokensAttachedBefore = providerRef.current?.tokensAttachedCount() ?? 0;
      // Probe a protected resource via the PATCHED global fetch: a 401 triggers
      // the popup → token mint → retry. The retry's status + whether a token was
      // attached THIS attempt prove login (assessLoginProbe — per-attempt, not a
      // sticky flag). A storage root is private on CSS/PSS by default, so it 401s.
      const probe = pub.storages[0] ?? new URL("/", id).toString();
      const res = await fetch(probe, { method: "GET" });
      const tokensAttachedAfter = providerRef.current?.tokensAttachedCount() ?? 0;
      const assessment = assessLoginProbe({
        status: res.status,
        tokensAttachedBefore,
        tokensAttachedAfter,
      });
      if (!assessment.ok) throw new Error(assessment.message);
      // Re-read the profile (now authenticated) and derive the session.
      const me = await readProfile(id);
      const derived = deriveSession(me);
      setWebId(id);
      setSession(derived);
    } catch (e) {
      pendingWebId.current = null;
      const msg =
        e instanceof AmbiguousIssuerError
          ? "This WebID lists multiple identity providers — multi-issuer choice is not yet wired in this host."
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Tokens live in memory only; reloading drops them. Clear app state here.
    pendingWebId.current = null;
    setWebId(null);
    setSession(null);
    setError(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ webId, session, loggingIn, error, ready, login, logout }),
    [webId, session, loggingIn, error, ready, login, logout],
  );

  return (
    <SessionContext.Provider value={value}>
      {/* The popup UI element. Kept mounted so getCode() has an element; the
          library renders its own dialog parts. */}
      <authorization-code-flow ref={flowRef} data-testid="solid-auth-flow" />
      {children}
    </SessionContext.Provider>
  );
}
