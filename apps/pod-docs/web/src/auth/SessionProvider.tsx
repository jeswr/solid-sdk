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
import { AmbiguousIssuerError, WebIdDPoPTokenProvider, webIdsEqual } from "./webid-token-provider";

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

/**
 * MODULE-LEVEL singleton for the auth runtime — the fix for the global-fetch
 * patch lifecycle bug (Finding 2). `ReactiveFetchManager.registerGlobally()`
 * monkey-patches `globalThis.fetch` and offers no idempotency guard or cleanup,
 * so a naive per-mount effect is unsafe: under React.StrictMode the mount effect
 * runs TWICE, and the second pass would (a) snapshot the ALREADY-PATCHED fetch as
 * if it were pristine, and (b) call `registerGlobally()` again, STACKING a second
 * patch over the first. Two stacked patches double-handle auth and break plain
 * reads. Hoisting the build+register out of React, behind a once-only guard,
 * makes it run exactly once for the lifetime of the page regardless of how many
 * times the effect mounts — the pristine fetch is captured once and the global is
 * patched once.
 */
interface AuthRuntime {
  provider: WebIdDPoPTokenProvider;
  /** The original, un-upgrading fetch captured BEFORE registerGlobally patched it. */
  profileFetch: typeof fetch;
}

interface AuthRuntimeConfig {
  callbackUri: string;
  clientId: string;
  allowInsecureLoopback: boolean;
  getWebId: () => Promise<string>;
  getCode: ConstructorParameters<typeof WebIdDPoPTokenProvider>[1];
}

let authRuntimeSingleton: Promise<AuthRuntime> | null = null;

/**
 * The WebID the user is currently logging in with, in a MODULE-level holder (not
 * a per-mount ref). The auth runtime is a page-lifetime singleton (Finding 2), so
 * its `getWebId` closure must read the latest value through a stable holder rather
 * than capturing one mount's ref — otherwise a StrictMode remount's `login()`
 * would write a ref the singleton never reads. `login()` sets this; the singleton
 * reads it on each 401 upgrade.
 */
const pendingWebIdHolder: { current: string | null } = { current: null };

/**
 * Build + globally-register the auth runtime EXACTLY ONCE per page. Repeated
 * calls (e.g. a StrictMode double-mount) return the same in-flight/settled
 * promise without re-snapshotting fetch or re-patching the global.
 */
function getAuthRuntime(cfg: AuthRuntimeConfig): Promise<AuthRuntime> {
  if (authRuntimeSingleton) return authRuntimeSingleton;
  authRuntimeSingleton = (async () => {
    // Snapshot the pristine global fetch BEFORE the manager patches it — captured
    // here, inside the once-only guard, so a second effect pass can never grab the
    // already-patched fetch as the "pristine" baseline.
    const profileFetch = globalThis.fetch.bind(globalThis);
    const { ReactiveFetchManager } = await import("@solid/reactive-authentication");
    const provider = new WebIdDPoPTokenProvider(cfg.callbackUri, cfg.getCode, cfg.getWebId, {
      clientId: cfg.clientId,
      allowInsecureLoopback: cfg.allowInsecureLoopback,
      profileFetch,
    });
    const manager = new ReactiveFetchManager([provider]);
    manager.registerGlobally(); // patched exactly once for the page lifetime.
    return { provider, profileFetch };
  })().catch((e) => {
    // A failed build must not poison the singleton — allow a later retry.
    authRuntimeSingleton = null;
    throw e;
  });
  return authRuntimeSingleton;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const flowRef = useRef<AuthorizationCodeFlow>(null);
  // The token provider + pristine fetch, resolved from the page-lifetime singleton.
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

  // Acquire the auth runtime, client-side, after the element exists. The runtime
  // is a page-lifetime singleton (getAuthRuntime), so a StrictMode double-mount
  // re-uses it instead of re-patching the global fetch (Finding 2).
  useEffect(() => {
    let cancelled = false;
    const ui = flowRef.current;
    if (!ui) return;
    const origin = location.origin;
    getAuthRuntime({
      callbackUri: new URL("/callback.html", location.href).toString(),
      clientId: new URL("/clientid.jsonld", location.href).toString(),
      // Only a localhost deployment may target an HTTP/loopback issuer.
      allowInsecureLoopback: isLoopbackOrigin(origin),
      getCode: ui.getCode.bind(ui),
      // Read the latest pending WebID through the module-level holder (not a
      // per-mount ref the singleton's closure would freeze).
      getWebId: async () => {
        const id = pendingWebIdHolder.current;
        if (!id) throw new Error("No WebID set for login");
        return id;
      },
    })
      .then(({ provider, profileFetch }) => {
        if (cancelled) return;
        providerRef.current = provider;
        profileFetchRef.current = profileFetch;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (id: string) => {
    setError(null);
    setLoggingIn(true);
    // IDENTITY CHANGE — drop EVERY trace of any prior identity FIRST (Finding 1):
    //  - reset the provider so its cached issuer, per-issuer sessions (DPoP keys +
    //    access tokens), authenticated-WebID claim, and token-attach count are gone
    //    — a login as a different WebID can never reuse the previous user's session;
    //  - clear session-derived React state (pod root, etc.) so nothing from WebID-A
    //    is rendered while authenticating as WebID-B.
    providerRef.current?.reset();
    setWebId(null);
    setSession(null);
    pendingWebIdHolder.current = id;
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
      // PROVE the session authenticated AS the requested WebID — never infer
      // "logged in" from "a token is attached" (Finding 1). The OP's id_token
      // `webid`/`sub` claim is the identity it vouched for; if it doesn't match
      // what the user asked to log in as (e.g. a stale session leaked from a prior
      // identity, or an IdP that authenticated a different account), fail closed.
      const authedWebId = providerRef.current?.authenticatedWebId();
      if (!webIdsEqual(authedWebId, id)) {
        throw new Error(
          "Login did not complete — the identity provider authenticated a " +
            `different WebID (${authedWebId ?? "unknown"}) than the one requested ` +
            `(${id}). For your security you were not logged in.`,
        );
      }
      // Re-read the profile (now authenticated) and derive the session.
      const me = await readProfile(id);
      const derived = deriveSession(me);
      setWebId(id);
      setSession(derived);
    } catch (e) {
      // The attempt failed — clear the pending WebID AND drop any partial provider
      // state, so a half-established session can't leak into the next attempt.
      pendingWebIdHolder.current = null;
      providerRef.current?.reset();
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
    // RESET THE PROVIDER, not just React state (Finding 1): the in-memory issuer,
    // per-issuer sessions (DPoP key + access/refresh tokens), authenticated-WebID
    // claim, and token-attach count are all dropped, so a later login as a DIFFERENT
    // WebID cannot reuse this user's token/session and a login probe cannot look
    // authenticated with the stale token.
    providerRef.current?.reset();
    pendingWebIdHolder.current = null;
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
