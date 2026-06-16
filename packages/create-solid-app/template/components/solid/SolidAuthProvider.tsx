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
import type {
  AuthorizationCodeFlow,
  GetCodeCallback,
} from "@solid/reactive-authentication";
import {
  WebIdDPoPTokenProvider,
  AmbiguousIssuerError,
  webIdsEqual,
  PROBE_ID_HEADER,
} from "@/lib/solid/webid-token-provider";
import { authFlowHolder, getCodeThroughHolder } from "@/lib/solid/auth-flow-holder";
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

/**
 * MODULE-LEVEL singleton for the auth runtime — the fix for the global-fetch
 * patch lifecycle bug. `ReactiveFetchManager.registerGlobally()` monkey-patches
 * `globalThis.fetch` and offers NO idempotency guard or cleanup, so a naive
 * per-mount effect is unsafe: under React.StrictMode the mount effect runs TWICE,
 * and the second pass would call `registerGlobally()` again, STACKING a second
 * patch over the first. Two stacked patches double-handle auth and break plain
 * reads (and the second pass would also capture the already-patched fetch as if it
 * were pristine). Hoisting the build+register out of React, behind a once-only
 * guard, makes it run exactly once for the page lifetime regardless of how many
 * times the effect mounts.
 */
let authProviderSingleton: Promise<WebIdDPoPTokenProvider> | null = null;

/**
 * The WebID the user is currently logging in with, in a MODULE-level holder (not
 * a per-mount ref). The auth runtime is a page-lifetime singleton, so its
 * `getWebId` closure reads the latest value through this stable holder rather than
 * capturing one mount's ref. `login()` sets it; the singleton reads it on each 401.
 */
const pendingWebIdHolder: { current: string | null } = { current: null };

interface AuthProviderConfig {
  callbackUri: string;
  allowInsecureLoopback: boolean;
}

/**
 * Build + globally-register the auth provider EXACTLY ONCE per page. Repeated
 * calls (e.g. a StrictMode double-mount) return the same in-flight/settled promise
 * without re-patching the global fetch.
 *
 * The provider is given `getCodeThroughHolder`, NOT a `getCode` bound to one
 * element: the singleton outlives any single <authorization-code-flow> element, so
 * binding the first element here would leave the singleton calling a StrictMode-
 * removed element forever. The holder is updated on every mount; the singleton
 * reads the latest from it at authentication time.
 */
function getAuthProvider(cfg: AuthProviderConfig): Promise<WebIdDPoPTokenProvider> {
  if (authProviderSingleton) return authProviderSingleton;
  authProviderSingleton = (async () => {
    // Dynamic import keeps the browser-only custom element out of the SSR bundle.
    const { ReactiveFetchManager } = await import(
      "@solid/reactive-authentication"
    );
    const provider = new WebIdDPoPTokenProvider(
      cfg.callbackUri,
      // getCode reads the CURRENT mounted element from the module-level holder —
      // never a first-mount element a StrictMode remount removed.
      getCodeThroughHolder,
      // getWebId: hand back whichever WebID the user is logging in with.
      async () => {
        const id = pendingWebIdHolder.current;
        if (!id) throw new Error("No WebID set for login");
        return id;
      },
      {
        // Dev-only: lets interactive login target a local CSS over HTTP.
        // Remote issuers stay HTTPS-strict.
        allowInsecureLoopback: cfg.allowInsecureLoopback,
      },
    );
    const manager = new ReactiveFetchManager([provider]);
    manager.registerGlobally(); // 0.1.3: the constructor does NOT patch fetch — THIS does.
    return provider;
  })().catch((e) => {
    // A failed build must not poison the singleton — allow a later retry.
    authProviderSingleton = null;
    throw e;
  });
  return authProviderSingleton;
}

export function SolidAuthProvider({ children }: { children: ReactNode }) {
  const flowRef = useRef<AuthorizationCodeFlow>(null);
  // The token provider, resolved from the page-lifetime singleton. Held so login()
  // can (a) reset it on every identity change, (b) confirm a token was actually
  // minted + attached DURING THIS attempt, and (c) confirm the OP authenticated
  // the REQUESTED WebID — never inferring "logged in" from a token merely being
  // attached, and never letting a prior identity's session leak into a new login.
  const providerRef = useRef<WebIdDPoPTokenProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [webId, setWebId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acquire the auth runtime, client-side, after the element exists. The runtime
  // is a page-lifetime singleton (getAuthProvider), so a StrictMode double-mount
  // re-uses it instead of re-patching the global fetch.
  useEffect(() => {
    let cancelled = false;
    const ui = flowRef.current;
    if (!ui) return;
    // Publish THIS mount's element to the module-level holder so the page-lifetime
    // singleton's getCode always drives the CURRENT live element. Under StrictMode
    // the first element is unmounted right after this effect runs; the second
    // mount overwrites the holder with its (live) element — so the singleton never
    // ends up bound to a removed element.
    const getCode: GetCodeCallback = ui.getCode.bind(ui);
    authFlowHolder.current = getCode;
    getAuthProvider({
      callbackUri: new URL("/callback.html", location.href).toString(),
      allowInsecureLoopback:
        process.env.NEXT_PUBLIC_ALLOW_INSECURE_LOOPBACK === "true",
    })
      .then((provider) => {
        if (cancelled) return;
        providerRef.current = provider;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      // Only relinquish the holder if it still points at THIS element's getCode —
      // a later mount may already have replaced it (StrictMode remount). Never null
      // out a newer element's getCode.
      if (authFlowHolder.current === getCode) authFlowHolder.current = null;
    };
  }, []);

  const login = useCallback(async (id: string) => {
    setError(null);
    setLoggingIn(true);
    // IDENTITY CHANGE — drop EVERY trace of any prior identity FIRST: reset the
    // provider so its cached issuer, per-issuer sessions (DPoP keys + access
    // tokens), authenticated-WebID claim, and token-attach count are gone (so a
    // login as a different WebID can never reuse the previous user's session), and
    // clear the rendered profile so WebID-A's data is not shown while
    // authenticating as WebID-B.
    providerRef.current?.reset();
    setWebId(null);
    setProfile(null);
    pendingWebIdHolder.current = id;
    try {
      // Resolve the issuer/storage from the PUBLIC profile first — this gives a
      // clear, early error if the WebID is unusable (no oidcIssuer / unreachable)
      // before we open a popup, and gives us the storage to probe.
      const pub = await readProfile(id);
      // Snapshot the provider's running token-attachment count BEFORE the probe.
      // Detection is PER-ATTEMPT: we compare this against the count AFTER the
      // probe, so only a token attached during THIS attempt counts — never a
      // sticky flag a previous session/attempt left set. (reset() above also zeroes
      // the count, so this baseline is clean for the new identity.) This stays as
      // DEFENCE-IN-DEPTH alongside the per-probe proof below.
      const tokensAttachedBefore =
        providerRef.current?.tokensAttachedCount() ?? 0;
      // PER-PROBE PROOF (primary): stamp this probe with a unique id. The provider
      // records the id iff it actually upgrades THIS request — so we can prove THIS
      // probe was token-upgraded, not merely that "some request" was (a concurrent
      // upgraded request for the SAME WebID can bump the provider-wide count, but
      // not satisfy our own probe id).
      const probeId = `probe-${crypto.randomUUID()}`;
      // Trigger the auth flow by making an authenticated request the global fetch
      // will upgrade on 401: registerGlobally() intercepts the 401, opens the
      // <authorization-code-flow> popup, mints a DPoP token, and RETRIES the
      // request. A storage root is private on CSS by default, so this 401s →
      // popup → retry, and the RETRY's status tells us whether login succeeded.
      const probe = pub.storages[0] ?? new URL("/", id).toString();
      const res = await fetch(probe, {
        method: "GET",
        headers: { [PROBE_ID_HEADER]: probeId },
      });
      // Success requires a 2xx AND that the token provider upgraded THIS specific
      // probe (per-probe), with the count delta kept as defence-in-depth. A bare
      // 2xx is NOT enough: probing a PUBLIC resource returns 200 with no token
      // attached this attempt and no flow at all — that must NOT count as logged
      // in. A final 401/403 (cancelled popup / rejected token) is also a failure.
      // The status decision is the pure assessLoginProbe() so the rule is testable.
      const tokensAttachedAfter =
        providerRef.current?.tokensAttachedCount() ?? 0;
      const assessment = assessLoginProbe({
        status: res.status,
        tokensAttachedBefore,
        tokensAttachedAfter,
      });
      if (!assessment.ok) {
        throw new Error(assessment.message);
      }
      // The primary, per-probe gate: THIS probe must have been token-upgraded. A
      // concurrent same-WebID upgrade for a DIFFERENT request cannot satisfy it.
      if (!providerRef.current?.wasProbeUpgraded(probeId)) {
        throw new Error(
          "Login did not complete — no token was attached to this login's own " +
            "request (the probed resource may be public, or a different request " +
            "was upgraded). You were not logged in.",
        );
      }
      // PROVE the session authenticated AS the requested WebID — never infer
      // "logged in" from "a token is attached". The OP's id_token `webid`/`sub`
      // claim is the identity it vouched for; if it doesn't match what the user
      // asked to log in as (e.g. a stale session leaked from a prior identity, or
      // an IdP that authenticated a different account), fail closed.
      const authedWebId = providerRef.current?.authenticatedWebId();
      if (!webIdsEqual(authedWebId, id)) {
        throw new Error(
          "Login did not complete — the identity provider authenticated a " +
            `different WebID (${authedWebId ?? "unknown"}) than the one requested ` +
            `(${id}). For your security you were not logged in.`,
        );
      }
      // The token was minted, attached AND accepted, AND proven to be THIS WebID's.
      // Re-read the profile (now authenticated) and record the session.
      const me = await readProfile(id);
      setWebId(id);
      setProfile(me);
    } catch (e) {
      // The attempt failed — clear the pending WebID AND drop any partial provider
      // state, so a half-established session can't leak into the next attempt.
      pendingWebIdHolder.current = null;
      providerRef.current?.reset();
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
    // RESET THE PROVIDER, not just React state: the in-memory issuer, per-issuer
    // sessions (DPoP key + access/refresh tokens), authenticated-WebID claim, and
    // token-attach count are all dropped, so a later login as a DIFFERENT WebID
    // cannot reuse this user's token/session and a login probe cannot look
    // authenticated with the stale token.
    providerRef.current?.reset();
    pendingWebIdHolder.current = null;
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
