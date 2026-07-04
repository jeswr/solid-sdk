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
  withProbeFragment,
  hasPendingRedirectLogin,
} from "@/lib/solid/webid-token-provider";
import {
  AUTOLOGIN_SENTINEL_KEY,
  classifyAutologin,
  runAutologin,
  type AutologinCallbacks,
} from "@/lib/solid/autologin";
import {
  authFlowHolder,
  getCodeThroughHolder,
  lazyElementGetCode,
} from "@/lib/solid/auth-flow-holder";
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
  /**
   * True while a deep-link AUTOLOGIN is in flight — either beginning the full-page
   * Solid-OIDC redirect (CASE B) or completing it after the broker redirect back
   * (CASE A). The UI shows a "Signing you in…" state instead of the login panel.
   */
  autologinPending: boolean;
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

/**
 * MODULE-LEVEL single-flight guard for `login()`, keyed on the in-flight WebID.
 * The token provider tracks exactly ONE active login probe at a time (its
 * generation-scoped record), so two overlapping / double-clicked logins must NOT
 * both run a probe — the second would overwrite or race the first's probe record.
 *
 * KEYING ON THE WebID is the round-4b roborev fix. A bare promise single-flight
 * (`inFlightLogin ??= doLogin(id)`) is WRONG for a DIFFERENT identity: `login("bob")`
 * while `login("alice")` is still in flight would return ALICE's promise, so the
 * caller resolves as if Bob logged in though Bob was never attempted — a false
 * positive for a different identity. So we track WHICH WebID is in flight:
 *  - same WebID (a double-click) → share the one in-flight promise (a clean no-op);
 *  - DIFFERENT WebID → reject cleanly, WITHOUT starting a second probe and WITHOUT
 *    disturbing the in-flight attempt's state — the caller must wait or log out.
 *
 * It is module-level (not a ref) because the provider is a page-lifetime singleton,
 * so the in-flight login is a page-level fact, not a per-mount one. Cleared in
 * `finally` (only if it still points at this run) so the next login starts fresh.
 */
let inFlight: { id: string; promise: Promise<void> } | null = null;

/**
 * MODULE-LEVEL one-shot guard so the deep-link AUTOLOGIN effect fires at most once
 * per page. React.StrictMode double-invokes effects in dev, so a per-mount flag is
 * insufficient — the second invoke would run a second `runAutologin` (a second
 * full-page redirect / a second completion). This guard, paired with the
 * sessionStorage sentinel, makes the redirect fire exactly once. It is module-level
 * (a page-level fact, like the auth singleton) and never reset — the page either
 * navigates away (CASE B redirect) or settles into logged-in / login-panel.
 */
let autologinStarted = false;

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
    // Capture a PRISTINE fetch reference BEFORE the dynamic import — and
    // therefore before `manager.registerGlobally()` below patches the global —
    // EXPLICITLY, rather than relying on the provider's implicit construction-
    // time-capture default. Pass it as BOTH `profileFetch` and `oauthFetch` (see
    // the login-stall note below): an explicit, named snapshot survives a future
    // reordering of this function far better than an implicit "whatever
    // `globalThis.fetch` happens to be when `new WebIdDPoPTokenProvider(...)`
    // runs" assumption would.
    const pristineFetch = globalThis.fetch.bind(globalThis);
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
        // Pin BOTH the public WebID-profile read AND the provider's OWN OIDC
        // hops (discovery / dynamic client registration / token grant) to the
        // SAME pristine snapshot captured above. `registerGlobally()` below
        // patches the global fetch with a wrapper whose credential boundary
        // deliberately includes the active ISSUER's origin (so it can upgrade a
        // 401 there) — so a provider-internal OIDC request riding the patched
        // global would re-enter `provider.upgrade()`, which single-flights onto
        // the very `#authenticate()` promise that ISSUED the request: a
        // circular await that stalls interactive login forever, after the
        // WebID profile read succeeds and before the OIDC popup ever opens
        // (the login-stall bug; see `WebIdDPoPTokenProviderOptions.oauthFetch`).
        profileFetch: pristineFetch,
        oauthFetch: pristineFetch,
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
  // "Signing you in…" while a deep-link autologin redirect is beginning (CASE B) or
  // completing (CASE A). Distinct from `loggingIn` (the interactive popup login).
  const [autologinPending, setAutologinPending] = useState(false);

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
    //
    // COLD-START SAFETY (roborev HIGH): @solid/reactive-authentication is loaded by
    // a DYNAMIC import (`getAuthProvider`), and `customElements.define(
    // "authorization-code-flow", …)` lives at the top of that chunk. So on a COLD
    // first mount this effect runs BEFORE the import resolves and BEFORE the element
    // is upgraded — `ui.getCode` is still `undefined`. Eagerly binding it here
    // (`ui.getCode.bind(ui)`) would THROW on that very first load and break login.
    //
    // The holder therefore gets a LAZY accessor (`lazyElementGetCode`) that reads
    // `getCode` at CALL time (login time), not at mount time. By the time the
    // singleton invokes it (inside `login()`, which has awaited the dynamic import +
    // element registration), the element is upgraded and `getCode` is defined; and
    // as belt-and-braces the accessor awaits `customElements.whenDefined` first if
    // the element is somehow still un-upgraded — so even a very-early login can't
    // throw. We do NOT touch `ui.getCode` until invocation.
    const getCode: GetCodeCallback = lazyElementGetCode(ui);
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

  // DEEP-LINK AUTOLOGIN (media-kraken#54 pattern). Runs ONLY when the auth runtime is
  // `ready` AND the user is NOT already logged in (`!webId`) — a stored/active session
  // takes precedence. Decides CASE A (returning from the broker redirect: a pending
  // record + `?code&state`) vs CASE B (a fresh `#autologin/<webid>` deep-link) vs the
  // loop-guard fallback, then runs the side-effectful orchestration in `runAutologin`.
  //
  // STRICTMODE: the effect double-invokes in dev. The module-level `autologinStarted`
  // guard (paired with the sessionStorage sentinel) makes the redirect fire at most
  // once. We classify first and only flip the guard when there is real work to do, so
  // a "none" mount doesn't burn the one-shot.
  useEffect(() => {
    if (!ready) return;
    if (autologinStarted) return;
    const decision = classifyAutologin({
      ready,
      loggedIn: webId !== null,
      href: location.href,
      hash: location.hash,
      hasPendingRedirect: hasPendingRedirectLogin(),
      sentinel: sessionStorage.getItem(AUTOLOGIN_SENTINEL_KEY),
    });
    if (decision.kind === "none") return;
    // `ready` is only set after providerRef is populated, so this is defensive —
    // but check BEFORE claiming the one-shot so a (theoretical) null provider does
    // not burn the guard and block a later legitimate attempt.
    const provider = providerRef.current;
    if (!provider) return;
    // Real work with a live provider — claim the one-shot so a StrictMode re-invoke
    // (and any later re-run from the deps) is a no-op.
    autologinStarted = true;

    const cb: AutologinCallbacks = {
      provider,
      readProfile: (id) => readProfile(id),
      href: () => location.href,
      origin: () => location.origin,
      replaceUrl: (url) => history.replaceState(null, "", url),
      assignUrl: (url) => location.assign(url),
      setPendingWebId: (id) => {
        pendingWebIdHolder.current = id;
      },
      getSentinel: () => sessionStorage.getItem(AUTOLOGIN_SENTINEL_KEY),
      setSentinel: (id) => sessionStorage.setItem(AUTOLOGIN_SENTINEL_KEY, id),
      clearSentinel: () => sessionStorage.removeItem(AUTOLOGIN_SENTINEL_KEY),
      setRestoring: (restoring) => setAutologinPending(restoring),
      onAuthenticated: (id, profile) => {
        setWebId(id);
        setProfile(profile as Profile);
        setAutologinPending(false);
      },
      onFallback: (message) => {
        if (message) setError(message);
        setAutologinPending(false);
      },
    };
    // Fire-and-forget: runAutologin owns its own error handling (it never rejects).
    void runAutologin(decision, cb);
    // Re-run when readiness flips or the user logs in/out (the guard makes it a no-op
    // after the first real run).
  }, [ready, webId]);

  // The actual login body. Wrapped by `login` below in a module-level single-flight
  // so two concurrent / double-clicked logins never run overlapping probes (the
  // provider tracks exactly ONE active probe — see beginLoginProbe).
  const doLogin = useCallback(async (id: string) => {
    setError(null);
    setLoggingIn(true);
    // IDENTITY CHANGE — drop EVERY trace of any prior identity FIRST: reset the
    // provider so its cached issuer, per-issuer sessions (DPoP keys + access
    // tokens), authenticated-WebID claim, active login probe, and token-attach count
    // are gone (so a login as a different WebID can never reuse the previous user's
    // session), and clear the rendered profile so WebID-A's data is not shown while
    // authenticating as WebID-B.
    providerRef.current?.reset();
    setWebId(null);
    setProfile(null);
    pendingWebIdHolder.current = id;
    // Snapshot the provider's generation AFTER reset() so the per-probe proof below
    // is scoped to THIS login's generation — a later reset() advances the generation
    // and so can never make a stale upgrade satisfy this check.
    const gen = providerRef.current?.loginGeneration() ?? 0;
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
      // PER-PROBE PROOF (primary): register THIS probe Request with the provider via
      // beginLoginProbe — a generation-scoped, in-process record, NOT a network
      // header. The provider records its upgrade generation iff it actually upgrades
      // THIS request (object identity, or an unforgeable URL fallback that survives
      // the manager's re-wrap) — so we can prove THIS probe was token-upgraded, not
      // merely that "some request" was (a concurrent upgraded request for the SAME
      // WebID can bump the provider-wide count, but not satisfy our own probe).
      //
      // The probe URL carries a unique, unguessable `#probe-<uuid>` fragment
      // (withProbeFragment) — an UNFORGEABLE in-process marker that (a) survives the
      // manager's `new Request(input)` re-wrap and (b) is NEVER sent on the wire
      // (fragments are client-side per RFC 3986 §3.5), so an unrelated same-base-URL
      // fetch during the login window cannot consume the URL fallback (the round-4b
      // roborev fix). It is not a header, so the probe stays a "simple" CORS request
      // and the OP fetches the exact same resource.
      // Trigger the auth flow by making an authenticated request the global fetch
      // will upgrade on 401: registerGlobally() intercepts the 401, opens the
      // <authorization-code-flow> popup, mints a DPoP token, and RETRIES the
      // request. A storage root is private on CSS by default, so this 401s →
      // popup → retry, and the RETRY's status tells us whether login succeeded.
      // Build the Request OBJECT first and register it before fetching.
      const probe = withProbeFragment(pub.storages[0] ?? new URL("/", id).toString());
      const probeRequest = new Request(probe, { method: "GET" });
      providerRef.current?.beginLoginProbe(probeRequest);
      let res: Response;
      try {
        res = await fetch(probeRequest);
      } finally {
        // Clear the active probe record (e.g. a public 200 with no 401 → no upgrade
        // ran), so a later request to the same URL can never match this probe.
        providerRef.current?.endLoginProbe();
      }
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
      // The primary, per-probe gate: THIS probe must have been token-upgraded IN
      // this login's generation. A concurrent same-WebID upgrade for a DIFFERENT
      // request cannot satisfy it.
      if (!providerRef.current?.wasLoginProbeUpgraded(gen)) {
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

  const login = useCallback(
    async (id: string) => {
      // WebID-SCOPED SINGLE-FLIGHT (round-4b). The provider tracks exactly one
      // active probe, so overlapping logins must not both run one.
      if (inFlight) {
        // A login is already in flight. If it is for the SAME WebID (a double-click
        // / re-render), share its promise — exactly one login proceeds. If it is for
        // a DIFFERENT WebID, REJECT cleanly: do NOT start a second probe, do NOT
        // silently resolve as the in-flight identity (the false-positive this fixes),
        // and do NOT disturb the in-flight attempt's React/provider state.
        if (webIdsEqual(inFlight.id, id)) return inFlight.promise;
        return Promise.reject(
          new Error(
            "A login for a different WebID is already in progress — wait for it to " +
              "finish or log out first.",
          ),
        );
      }
      // No login in flight: run the real flow and record WHICH WebID it is for.
      // Cleared in `finally` only if `inFlight` still points at THIS run (a later
      // login that replaced it must not be cleared by ours).
      const run = { id, promise: Promise.resolve() };
      run.promise = doLogin(id).finally(() => {
        if (inFlight === run) inFlight = null;
      });
      inFlight = run;
      return run.promise;
    },
    [doLogin],
  );

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
    () => ({ webId, profile, loggingIn, error, ready, autologinPending, login, logout }),
    [webId, profile, loggingIn, error, ready, autologinPending, login, logout],
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
