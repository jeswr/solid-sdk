"use client";
// SolidAuthProvider — the ONE place auth is wired. Mounts the
// <authorization-code-flow> popup element, builds a WebID-driven token provider,
// and calls registerGlobally() so EVERY plain `fetch()` (including the ones
// inside @jeswr/fetch-rdf) transparently upgrades on a 401 with a DPoP token.
//
// WHY IT LOOKS LIKE THIS — the load-bearing house rules:
//  1. @solid/reactive-authentication is pure-ESM + browser-only (custom
//     elements, popups). Importing it at module top level breaks `next build`
//     (SSR has no `customElements`). So it is loaded via a DYNAMIC import inside
//     an effect — see `loadAuth()`.
//  2. The 0.1.3 ReactiveFetchManager CONSTRUCTOR DOES NOT PATCH fetch. You MUST
//     call `manager.registerGlobally()` explicitly (done below). Forgetting it
//     is the single most common reactive-auth mistake.
//  3. The published `DPoPTokenProvider` resolves the issuer from a hard-coded
//     host map and rejects HTTP/loopback issuers. We instead use the vendored
//     `WebIdDPoPTokenProvider`, whose issuer comes from the user's WebID profile
//     and whose `allowInsecureLoopback` makes LOCAL CSS login work in dev.
//
// #18-GATED (create-solid-app S2 — interactive auth-code login). The vendored
// `WebIdDPoPTokenProvider` is a STOP-GAP for the local-loopback case until
// @solid/reactive-authentication ships a first-class loopback-issuer option:
//   https://github.com/solid-contrib/reactive-authentication/issues/18
// create-solid-app is NOT published to npm until #18 lands (so downstream apps
// depend on the published provider, not this vendored copy). Do not remove the
// vendored provider until #18 ships an equivalent. See the package README §S2.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthorizationCodeFlow } from "@solid/reactive-authentication";
import {
  WebIdDPoPTokenProvider,
  AmbiguousIssuerError,
} from "@/lib/solid/webid-token-provider";
import { readProfile, type Profile } from "@/lib/solid/profile";
import { assessLoginProbe } from "@/lib/solid/login-result";

export interface SolidAuthContextValue {
  /** The WebID once the user has authenticated, else null. */
  webId: string | null;
  /** The authenticated user's rendered profile, if loaded. */
  profile: Profile | null;
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

const SolidAuthContext = createContext<SolidAuthContextValue | null>(null);

/** Read the auth state anywhere under <SolidAuthProvider>. */
export function useSolidAuth(): SolidAuthContextValue {
  const ctx = useContext(SolidAuthContext);
  if (!ctx) {
    throw new Error("useSolidAuth must be used inside <SolidAuthProvider>");
  }
  return ctx;
}

export function SolidAuthProvider({ children }: { children: ReactNode }) {
  const flowRef = useRef<AuthorizationCodeFlow>(null);
  // The WebID the user is logging in with — read by the provider's getWebId.
  const pendingWebId = useRef<string | null>(null);
  // The token provider, held so login() can confirm a token was actually minted
  // and attached (an auth flow truly ran) — not merely that some probe returned 2xx.
  const providerRef = useRef<WebIdDPoPTokenProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [webId, setWebId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mount the auth runtime exactly once, client-side, after the element exists.
  useEffect(() => {
    let cancelled = false;
    async function loadAuth() {
      const ui = flowRef.current;
      if (!ui) return;
      // Dynamic import keeps the browser-only custom element out of the SSR bundle.
      const { ReactiveFetchManager } = await import(
        "@solid/reactive-authentication"
      );
      const callbackUri = new URL("/callback.html", location.href).toString();
      const provider = new WebIdDPoPTokenProvider(
        callbackUri,
        ui.getCode.bind(ui),
        // getWebId: hand back whichever WebID the user is logging in with.
        async () => {
          const id = pendingWebId.current;
          if (!id) throw new Error("No WebID set for login");
          return id;
        },
        {
          // Dev-only: lets interactive login target a local CSS over HTTP.
          // Remote issuers stay HTTPS-strict.
          allowInsecureLoopback:
            process.env.NEXT_PUBLIC_ALLOW_INSECURE_LOOPBACK === "true",
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
      // Resolve the issuer/storage from the PUBLIC profile first — this gives a
      // clear, early error if the WebID is unusable (no oidcIssuer / unreachable)
      // before we open a popup, and gives us the storage to probe.
      const pub = await readProfile(id);
      // Trigger the auth flow by making an authenticated request the global fetch
      // will upgrade on 401: registerGlobally() intercepts the 401, opens the
      // <authorization-code-flow> popup, mints a DPoP token, and RETRIES the
      // request. A storage root is private on CSS by default, so this 401s →
      // popup → retry, and the RETRY's status tells us whether login succeeded.
      const probe = pub.storages[0] ?? new URL("/", id).toString();
      const res = await fetch(probe, { method: "GET" });
      // Success requires BOTH a 2xx AND that the token provider actually minted +
      // attached a token (an auth flow ran to completion). A bare 2xx is NOT
      // enough: probing a PUBLIC resource returns 200 with no token attached and
      // no flow at all — that must NOT count as logged in. (Treating any 2xx as
      // success was the bug — a public 200 marked the user authenticated with no
      // token.) A final 401/403 (cancelled popup / rejected token) is also a
      // failure. The decision is the pure assessLoginProbe() so the rule is
      // testable in isolation and can't be silently weakened.
      const tokenAttached =
        providerRef.current?.hasEstablishedSession() ?? false;
      const assessment = assessLoginProbe({ status: res.status, tokenAttached });
      if (!assessment.ok) {
        throw new Error(assessment.message);
      }
      // The token was minted, attached AND accepted. Re-read the profile (now
      // authenticated) and record the session — only reached on a proven login.
      const me = await readProfile(id);
      setWebId(id);
      setProfile(me);
    } catch (e) {
      pendingWebId.current = null;
      const msg =
        e instanceof AmbiguousIssuerError
          ? "This WebID lists multiple identity providers — multi-issuer choice is not yet wired in this template."
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
    // Tokens live in memory only; reloading drops them. Here we clear app state.
    pendingWebId.current = null;
    setWebId(null);
    setProfile(null);
    setError(null);
  }, []);

  const value = useMemo<SolidAuthContextValue>(
    () => ({ webId, profile, loggingIn, error, ready, login, logout }),
    [webId, profile, loggingIn, error, ready, login, logout],
  );

  return (
    <SolidAuthContext.Provider value={value}>
      {/* The popup UI element. Hidden until a flow needs it; the library shows
          its own <dialog> parts. Kept mounted so getCode() has an element. */}
      <authorization-code-flow ref={flowRef} data-testid="solid-auth-flow" />
      {children}
    </SolidAuthContext.Provider>
  );
}
