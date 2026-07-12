// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SessionProvider — the ONE place auth is wired for the Pod Docs static host.
// It mounts the browser-only <authorization-code-flow> popup element, builds a
// WebID-driven DPoP token provider bound to THIS origin's static Client
// Identifier Document, and installs the @jeswr/solid-elements PROACTIVE auth-fetch
// patch (`installProactiveAuthFetch`) so EVERY plain `fetch()` (including the ones
// inside @jeswr/fetch-rdf and the @jeswr/pod-docs data layer) PROACTIVELY carries
// the DPoP token on the FIRST request to an allowed origin. The library's `fetch?:`
// seam can then be left as the ambient global — no per-call wiring.
//
// WHY THE SEAM, NOT THE RAW `ReactiveFetchManager` (task #123): the raw upstream
// manager sends every request UNAUTHENTICATED first and attaches the token only
// REACTIVELY on a 401 — per resource, with no origin/storage cache — so every
// distinct pod URL pays a wasted 401 → upgrade → retry. The DocumentBrowser load
// reads the documents container AND THEN each `pd:Document` it lists (DocsStore.list
// → read per child), so a container of N documents paid N+1 wasted 401s. The
// seam-based proactive patch attaches up front for an allowed origin (zero wasted
// 401s) AND enforces a real credential boundary (the provider's own `matches()` is
// unconditional; `isOriginAllowed` is the gate), so the token never rides
// cross-origin. The shared, generalized helper lives in @jeswr/solid-elements/auth
// (pod-docs IMPORTS it — it is NOT a per-app copy).
//
// LOAD-BEARING HOUSE RULES (do not "simplify" away):
//  1. @solid/reactive-authentication is pure-ESM + browser-only (custom elements,
//     popups), and the WebIdDPoPTokenProvider builds on it. The provider lives in
//     ./webid-token-provider; the seam primitives are pure + tree-shakeable, so the
//     proactive patch carries no browser-only top-level evaluation (verified by the
//     build gate). The provider's login/autologin/logout/DPoP invariants are UNCHANGED
//     by the #123 fetch-layer swap — only HOW the token is attached to fetches moved
//     from reactive (ReactiveFetchManager) to proactive (the seam). The package is
//     still loaded via a DYNAMIC import inside the runtime build so it never evaluates
//     at module-eval / SSR / prerender time (it remains the home of the popup element).
//  2. The proactive patch is installed EXACTLY ONCE per page (its own once-only guard,
//     mirroring this file's auth-runtime singleton): a StrictMode double-mount re-uses
//     the install and never stacks a second patch over the first.
//  3. The client_id is the per-origin static Client Identifier Document at
//     `${origin}/clientid.jsonld` (generated at build by scripts/gen-clientid.mjs),
//     so the OP shows "Pod Docs" on the consent screen instead of a throwaway
//     dynamic registration.
//  4. `allowInsecureLoopback` is enabled ONLY for a localhost origin (dev against
//     a local CSS over HTTP); a deployed HTTPS origin stays strict. It also gates
//     whether the proactive credential boundary admits an http:// loopback pod origin.
//
// NOTE (pod-docs delta): this host has NO silent-session-restore yet (the separate
// #69 P0 task) — tokens are memory-only, so there is no `restoring` state and no
// remembered-account / refresh-grant arming. The proactive boundary is armed only on
// the login PROBE and in `establishSessionFor` (provisional → authoritative), and
// dropped fail-closed on logout / identity-switch / every login + autologin failure
// path. The `@jeswr/solid-session-restore` dependency is present only because the
// @jeswr/solid-elements/auth seam statically imports it; pod-docs does not USE it.

import {
  deriveProactiveAllowedOrigins,
  installProactiveAuthFetch,
  type ProactiveFetchInstall,
} from "@jeswr/solid-elements/auth";
import type { AuthorizationCodeFlow, GetCodeCallback } from "@solid/reactive-authentication";
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
import { authFlowHolder, getCodeThroughHolder, lazyElementGetCode } from "./auth-flow-holder";
import { planAutologin } from "./autologin-plan";
import { assessLoginProbe } from "./login-result";
import { readProfile } from "./profile";
import { type DerivedSession, deriveSession } from "./session-derivation";
import { decideSingleFlight } from "./single-flight";
import {
  AmbiguousIssuerError,
  consumePendingRedirectWebId,
  hasPendingRedirectLogin,
  WebIdDPoPTokenProvider,
  webIdsEqual,
  withProbeFragment,
} from "./webid-token-provider";

export interface SessionContextValue {
  /** The authenticated user's WebID, else null. */
  webId: string | null;
  /** The derived session (pod root + documents container) once logged in. */
  session: DerivedSession | null;
  /** True while a login flow is running. */
  loggingIn: boolean;
  /** Last login error, surfaced to the UI. */
  error: string | null;
  /** True once the auth runtime has loaded and the proactive auth-fetch patch installed. */
  ready: boolean;
  /**
   * True while a full-page-redirect (autologin) login is being initiated or
   * completed — i.e. "Signing you in…". Distinct from {@link loggingIn} (the
   * interactive popup flow): autologin runs WITHOUT a user gesture (a deep-link or
   * a redirect return), so App/LoginScreen surface a restoring state rather than the
   * interactive login form.
   */
  autologinPending: boolean;
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
 * patch lifecycle bug (Finding 2). The proactive patch (`installProactiveAuthFetch`)
 * monkey-patches `globalThis.fetch`, so a naive per-mount effect would be unsafe:
 * under React.StrictMode the mount effect runs TWICE, and a second pass could (a)
 * snapshot the ALREADY-PATCHED fetch as if it were pristine, and (b) install a second
 * patch, STACKING two patches that double-handle auth and break plain reads. Two
 * guards make this safe: this auth-runtime singleton (one provider per page) AND
 * `installProactiveAuthFetch`'s OWN once-only guard (one patch + one pristine-fetch
 * capture per page). Hoisting the build+install out of React, behind both guards,
 * makes it run exactly once for the lifetime of the page regardless of how many times
 * the effect mounts.
 */
interface AuthRuntime {
  provider: WebIdDPoPTokenProvider;
  /** The original, un-upgrading fetch captured BEFORE the proactive patch installed. */
  profileFetch: typeof fetch;
  /**
   * The proactive-auth-fetch install handle (the @jeswr/solid-elements seam-based
   * replacement for `ReactiveFetchManager.registerGlobally()`). The SessionProvider
   * calls `setState` on login (probe + establish) / logout to update the live
   * credential boundary (the allowed-origins set + the provider), so the patched global
   * fetch PROACTIVELY attaches the token on the FIRST request to an allowed origin — no
   * per-resource 401-dance — and authenticates NOTHING when logged out.
   */
  fetchInstall: ProactiveFetchInstall;
}

interface AuthRuntimeConfig {
  callbackUri: string;
  clientId: string;
  allowInsecureLoopback: boolean;
  getWebId: () => Promise<string>;
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
 * SINGLE-FLIGHT login (round-4 + the round-4b fix for roborev finding 1). The auth
 * runtime + token provider are a page-lifetime singleton, so the in-flight guard is
 * MODULE-level (matching that model) rather than a per-mount ref: a StrictMode
 * remount's `login()` must observe the SAME in-flight promise.
 *
 * The guard tracks the in-flight WebID ALONGSIDE its promise. While a login is
 * running:
 *  - a second `login()` for the SAME WebID (a double-click / StrictMode remount)
 *    AWAITS the in-flight promise — exactly one login proceeds, the other is a
 *    clean shared await/no-op;
 *  - a second `login()` for a DIFFERENT WebID REJECTS cleanly WITHOUT starting an
 *    overlapping probe. The round-4 design (before finding 1) returned the in-flight
 *    promise unconditionally, so `login("bob")` while `login("alice")` ran resolved
 *    as if BOB had logged in — a false-positive for a different identity. Rejecting
 *    is correct: Bob was never attempted, so his promise must not resolve as success.
 *
 * Either way there is never a SECOND concurrent login, which is what keeps the
 * provider's generation-scoped probe proof collision-free: no second login can
 * overwrite the first's probe registration or upgrade a same-URL request inside the
 * login's generation window.
 */
let inFlight: { id: string; promise: Promise<void> } | null = null;

// ── Autologin (full-page redirect deep-link) ──────────────────────────────────
//
// The Pod Manager deep-links here with `#autologin/<encodeURIComponent(webid)>`.
// Because the user already has a live IdP session at the shared broker AND the app
// was previously authorized, a full-page Solid-OIDC redirect comes straight back
// ALREADY AUTHENTICATED — silent SSO, no credential prompt. (A popup auto-opened on
// load has no user gesture and is browser-blocked, which is why this MUST be a
// full-page redirect — see WebIdDPoPTokenProvider.beginRedirectLogin.)

/** The deep-link fragment prefix that triggers a fresh autologin (Case B). */
const AUTOLOGIN_FRAGMENT_PREFIX = "#autologin/";

/**
 * sessionStorage sentinel key. ONE-SHOT loop guard: set to the WebID the instant a
 * fresh autologin is initiated, and consulted before re-attempting. If the broker
 * bounces back to the app root WITHOUT a `?code` (SSO unavailable / user declined /
 * prior authorization revoked) and the deep-link fragment is somehow seen again,
 * the already-set sentinel makes us fall through to the login screen instead of
 * looping. Cleared on a successful completion, and on a non-code bounce.
 */
const AUTOLOGIN_SENTINEL_KEY = "autologin-attempted";

/** Read the one-shot autologin sentinel (the WebID we last attempted), or null. */
function readAutologinSentinel(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(AUTOLOGIN_SENTINEL_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Set the one-shot autologin sentinel to the WebID being attempted. */
function setAutologinSentinel(webId: string): void {
  try {
    globalThis.sessionStorage?.setItem(AUTOLOGIN_SENTINEL_KEY, webId);
  } catch {
    // sessionStorage unavailable — the fragment-clean + once-guard still prevent loops.
  }
}

/** Clear the one-shot autologin sentinel (idempotent). */
function clearAutologinSentinel(): void {
  try {
    globalThis.sessionStorage?.removeItem(AUTOLOGIN_SENTINEL_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear.
  }
}

/**
 * MODULE-LEVEL once-guard so the autologin mount effect fires its redirect/complete
 * AT MOST ONCE per page, even under React.StrictMode (which double-invokes mount
 * effects in dev). The sentinel + persisted-redirect record are the durable
 * cross-navigation guards; this in-memory latch additionally stops the SAME render
 * pass's double-mount from firing two redirects. Reset only by a full page load
 * (module re-eval).
 */
let autologinEffectRan = false;

/**
 * Parse the WebID out of a `#autologin/<encodeURIComponent(webid)>` fragment.
 * Returns the decoded WebID, or null if the hash is not an autologin deep-link or
 * decoding fails. Pure + exported for unit testing.
 */
export function parseAutologinFragment(hash: string): string | null {
  if (!hash.startsWith(AUTOLOGIN_FRAGMENT_PREFIX)) return null;
  const encoded = hash.slice(AUTOLOGIN_FRAGMENT_PREFIX.length);
  if (!encoded) return null;
  try {
    const webId = decodeURIComponent(encoded);
    return webId.length > 0 ? webId : null;
  } catch {
    return null; // malformed percent-encoding — not a usable deep-link.
  }
}

/** True when the current URL carries an OAuth `?code` AND `?state` (a redirect return). */
export function hasAuthCodeParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") && params.has("state");
}

/**
 * True when the current URL carries an OAuth `?error` AND `?state` (a FAILED redirect
 * return — e.g. `?error=login_required` / `?error=access_denied`: the broker declined
 * silent SSO or the user declined). A redirect ERROR return, as opposed to the success
 * return {@link hasAuthCodeParams} detects. The `state` is required so a stray `error`
 * query unrelated to our flow is not mistaken for a redirect return.
 */
export function hasAuthErrorParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("error") && params.has("state");
}

/**
 * Strip BOTH the query (`?code&state…`) and the fragment from a URL, leaving the
 * path. Used to clean the address bar after a redirect return / before a fresh
 * autologin redirect so a refresh / bounce cannot re-trigger and the WebID is not
 * left on display. Pure + exported for unit testing.
 */
export function cleanedUrl(href: string): string {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Whether THIS `establishSessionFor` is STILL the current login by the time it is ready to
 * arm the AUTHORITATIVE proactive boundary + publish the logged-in UI (roborev HIGH). Pure +
 * exported so the race is unit-testable WITHOUT a React render.
 *
 * `establishSessionFor` awaits the (now-authenticated) profile re-read after snapshotting its
 * generation. A logout()/new login() racing that await advances the provider generation (via
 * reset()) AND clears the boundary. If we re-armed the AUTHORITATIVE boundary + published
 * unconditionally we would re-enable authenticated fetches against a reset/stale provider behind
 * a logged-out UI AND publish a stale session, or — for a NEW login — clobber the new login's
 * freshly-armed boundary. Returns true ONLY when the live generation still equals the snapshot
 * AND the provider's authenticated WebID still equals the requested identity — fail-closed
 * (false) on EITHER mismatch, so the caller bails WITHOUT touching the boundary (clearing it
 * would wipe a newer login's boundary).
 */
export function establishStillCurrent(inputs: {
  establishGeneration: number;
  currentGeneration: number;
  requestedWebId: string;
  currentAuthenticatedWebId: string | undefined;
  webIdsEqual: (a: string | undefined, b: string | undefined) => boolean;
}): boolean {
  return (
    inputs.currentGeneration === inputs.establishGeneration &&
    inputs.webIdsEqual(inputs.currentAuthenticatedWebId, inputs.requestedWebId)
  );
}

/**
 * Build the auth runtime + install the proactive auth-fetch patch EXACTLY ONCE per
 * page. Repeated calls (e.g. a StrictMode double-mount) return the same
 * in-flight/settled promise without re-snapshotting fetch or re-patching the global.
 *
 * The provider is given `getCodeThroughHolder`, NOT a `getCode` bound to one
 * element: the singleton outlives any single <authorization-code-flow> element, so
 * binding the first element here would leave the singleton calling a StrictMode-
 * removed element forever. The holder is updated on every mount; the singleton
 * reads the latest from it at authentication time.
 */
function getAuthRuntime(cfg: AuthRuntimeConfig): Promise<AuthRuntime> {
  if (authRuntimeSingleton) return authRuntimeSingleton;
  authRuntimeSingleton = (async () => {
    // PROACTIVE AUTH FETCH (task #123) — adopt the @jeswr/solid-elements auth seam
    // instead of the raw `ReactiveFetchManager`. `installProactiveAuthFetch` snapshots
    // the pristine global fetch (so `profileFetch` is provably un-upgrading) and patches
    // the global EXACTLY ONCE behind its own once-only guard. Unlike the old reactive
    // manager (token attached only REACTIVELY on a 401, per resource, no origin gate),
    // the patched wrapper PROACTIVELY attaches the DPoP token on the FIRST request to an
    // ALLOWED origin and fail-closes for foreign origins — eliminating the per-resource
    // 401-dance. The credential boundary is provider-less/empty here (everything public)
    // until a login calls `fetchInstall.setState` with the live session + allowed origins
    // (see `establishSessionFor` / the doLogin probe / the logout teardown below).
    const fetchInstall = installProactiveAuthFetch();
    const profileFetch = fetchInstall.pristineFetch;
    // REGISTER the <authorization-code-flow> custom element. Its definition runs as a
    // module SIDE EFFECT of @solid/reactive-authentication (customElements.define in
    // AuthorizationCodeFlow.js). We adopted the proactive seam instead of the package's
    // ReactiveFetchManager (task #123), but the package is STILL the home of the popup
    // element the WebIdDPoPTokenProvider drives via getCode — so we MUST keep a VALUE
    // (side-effect) dynamic import here. A `import type {…}` is erased at compile and would
    // NOT register the element, leaving interactive login hung on `customElements.whenDefined`.
    // The dynamic import keeps the browser-only element OUT of module-eval / SSR (the
    // original Rule 1); we just no longer construct a ReactiveFetchManager from it.
    await import("@solid/reactive-authentication");
    const provider = new WebIdDPoPTokenProvider(
      cfg.callbackUri,
      // getCode reads the CURRENT mounted element from the module-level holder —
      // never a first-mount element a StrictMode remount removed.
      getCodeThroughHolder,
      cfg.getWebId,
      {
        clientId: cfg.clientId,
        allowInsecureLoopback: cfg.allowInsecureLoopback,
        profileFetch,
      },
    );
    return { provider, profileFetch, fetchInstall };
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
  // The original, un-upgrading fetch snapshotted BEFORE the proactive patch installs —
  // used for the pre-popup public profile read so it can never recurse into the
  // provider on a 401.
  const profileFetchRef = useRef<typeof fetch | null>(null);
  // The proactive-auth-fetch install handle (task #123). The session-establish /
  // logout paths call `fetchInstallRef.current.setState(...)` to update the live
  // credential boundary (the allowed-origins set + the provider) so the patched global
  // fetch proactively attaches the token to allowed origins while logged in, and
  // authenticates NOTHING when logged out.
  const fetchInstallRef = useRef<ProactiveFetchInstall | null>(null);
  // localhost / loopback → admit an http:// pod origin into the credential boundary
  // (dev / test only). Computed once (the origin can't change for a page lifetime).
  const allowInsecureLoopbackRef = useRef<boolean>(
    typeof location !== "undefined" && isLoopbackOrigin(location.origin),
  );
  const [ready, setReady] = useState(false);
  const [webId, setWebId] = useState<string | null>(null);
  const [session, setSession] = useState<DerivedSession | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [autologinPending, setAutologinPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acquire the auth runtime, client-side, after the element exists. The runtime
  // is a page-lifetime singleton (getAuthRuntime), so a StrictMode double-mount
  // re-uses it instead of re-patching the global fetch (Finding 2).
  useEffect(() => {
    let cancelled = false;
    const ui = flowRef.current;
    if (!ui) return;
    const origin = location.origin;
    // Publish THIS mount's element to the module-level holder so the page-lifetime
    // singleton's getCode always drives the CURRENT live element. Under StrictMode
    // the first element is unmounted right after this effect runs; the second mount
    // overwrites the holder with its (live) element — so the singleton never ends
    // up bound to a removed element.
    //
    // COLD-START SAFETY (roborev HIGH): @solid/reactive-authentication is loaded by
    // a DYNAMIC import (`getAuthRuntime`), and `customElements.define(
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
    getAuthRuntime({
      callbackUri: new URL("/callback.html", location.href).toString(),
      clientId: new URL("/clientid.jsonld", location.href).toString(),
      // Only a localhost deployment may target an HTTP/loopback issuer.
      allowInsecureLoopback: isLoopbackOrigin(origin),
      // Read the latest pending WebID through the module-level holder (not a
      // per-mount ref the singleton's closure would freeze).
      getWebId: async () => {
        const id = pendingWebIdHolder.current;
        if (!id) throw new Error("No WebID set for login");
        return id;
      },
    })
      .then(({ provider, profileFetch, fetchInstall }) => {
        if (cancelled) return;
        providerRef.current = provider;
        profileFetchRef.current = profileFetch;
        fetchInstallRef.current = fetchInstall;
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

  // PROACTIVE FETCH (task #123): drop the live credential boundary back to "authenticate
  // nothing" (no provider + empty allowed-origins). Called on logout, at the start of an
  // identity-switch login, and on the fail-closed login/autologin failure paths, so a
  // request racing the teardown is fail-closed at the gate (the patched global fetch
  // leaves it unauthenticated). A no-op until the runtime has installed the patch
  // (fetchInstallRef set). Declared BEFORE the doLogin / logout / autologin effect that
  // list it as a dependency, so a deps array never references it before its const
  // initialisation (TDZ).
  const clearProactiveBoundary = useCallback(() => {
    fetchInstallRef.current?.setState({ provider: null, allowedOrigins: new Set() });
  }, []);

  // The SHARED post-authentication step, used by BOTH the popup login (doLogin) and
  // the full-page-redirect autologin completion. By the time this runs the provider
  // has an established, token-attached session whose `authenticatedWebId` is the
  // identity the OP vouched for. We PROVE that matches the WebID the user asked to
  // log in as (never inferring "logged in" from a token being attached — the
  // Finding-1 invariant), then re-read the (now authenticated) profile and derive
  // the session into React state. Throws (fail-closed) on a WebID mismatch.
  const establishSessionFor = useCallback(async (id: string) => {
    const authedWebId = providerRef.current?.authenticatedWebId();
    if (!webIdsEqual(authedWebId, id)) {
      throw new Error(
        "Login did not complete — the identity provider authenticated a " +
          `different WebID (${authedWebId ?? "unknown"}) than the one requested ` +
          `(${id}). For your security you were not logged in.`,
      );
    }
    // GENERATION FENCE (roborev HIGH): snapshot the provider's login generation up front.
    // A logout() / new login() advances it (via reset()), so re-checking it (with the
    // authenticated WebID) before the AUTHORITATIVE boundary arm + the UI publish below lets
    // us BAIL if this establish was superseded MID-FLIGHT (during the profile re-read await).
    // Without the fence a racing logout/new-login could (a) re-arm the boundary against a
    // reset/stale provider behind a logged-out UI, (b) republish a stale webId/session, or
    // (c) — on the superseded path — wipe a NEWER login's boundary. -1 when no provider
    // (defensive). See `establishStillCurrent`.
    const establishGeneration = providerRef.current?.loginGeneration() ?? -1;
    // PROACTIVE FETCH (task #123): arm a PROVISIONAL credential boundary (the WebID
    // origin) BEFORE the authenticated profile re-read below, so that read actually
    // carries the token. An autologin-completion reaches HERE without the popup-login
    // flow's pre-probe arming, so without this the "now authenticated" profile re-read
    // would be UNAUTHENTICATED. The pod-root boundary is the AUTHORITATIVE one re-armed
    // once the profile yields derived.podRoot (below). The popup-login path has already
    // armed an equivalent boundary via the probe; re-arming with the same origins is
    // idempotent. pod-docs' provider exposes no `resolvedIssuer()` accessor (it has no
    // silent-restore), so the issuer origin is omitted — it is NOT needed in the boundary
    // because the OIDC endpoints ride the pristine fetch (the re-entrancy guard). The
    // WebID origin is the load-bearing target for the profile re-read.
    //
    // NO FENCE NEEDED HERE: this provisional arm runs in the SAME synchronous tick as the
    // entry WebID check above — pod-docs has NO async issuer accessor (unlike pod-music's
    // `resolvedIssuer()`), so no `await` separates the check from this arm and a racing
    // logout/new-login cannot win in between. The first `await` is the profile read below;
    // everything AFTER it is fenced.
    fetchInstallRef.current?.setState({
      provider: providerRef.current,
      allowedOrigins: deriveProactiveAllowedOrigins({
        webId: id,
        allowInsecureLoopback: allowInsecureLoopbackRef.current,
      }),
    });
    // Re-read the profile (now authenticated) and derive the session.
    //
    // FENCE THE REJECTION PATH TOO (roborev MEDIUM, 2nd round): `readProfile` is an await,
    // so a logout()/new login() can race it AND the stale read can itself REJECT (a transient
    // blip on the now-superseded attempt's fetch). An unfenced rejection here propagates to
    // doLogin's catch — which `reset()`s the provider, `clearProactiveBoundary()`s, and
    // surfaces an error — all on behalf of an OBSOLETE login attempt. After a racing NEW login
    // (B) that already armed its own boundary + advanced the generation, that clear would WIPE
    // B's boundary (stranding B's logged-in UI making unauthenticated reads) and show a stale
    // error. So catch the rejection and, if THIS establish was superseded, SWALLOW it and
    // return WITHOUT touching the boundary (the superseding actor owns it) — exactly mirroring
    // the superseded SUCCESS path below. If still current, the read genuinely failed: re-throw
    // so the real login failure surfaces as before.
    let derived: DerivedSession;
    try {
      const me = await readProfile(id);
      derived = deriveSession(me);
    } catch (e) {
      if (
        !establishStillCurrent({
          establishGeneration,
          currentGeneration: providerRef.current?.loginGeneration() ?? -1,
          requestedWebId: id,
          currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
          webIdsEqual,
        })
      ) {
        return; // superseded — a racing logout/new-login owns the boundary; do not disturb it.
      }
      throw e; // still current — a genuine profile-read failure; surface it (doLogin's catch).
    }
    // GENERATION FENCE for the AUTHORITATIVE boundary-arm + UI publish (roborev HIGH). The
    // `readProfile` above is an await, during which a logout()/new login() can race: it
    // advances the provider generation (via reset()) AND, for a logout, clears the boundary;
    // a new login clears it then ARMS ITS OWN. Without re-checking, this function would then
    // resume and (a) RE-ARM the boundary against a now-reset/stale provider — re-enabling
    // authenticated fetches behind a logged-out UI — and (b) publish a STALE logged-in session
    // (or clobber a NEWER login's boundary). So before arming the authoritative boundary +
    // publishing, re-check BOTH the generation and the authenticated WebID against this
    // establish's snapshot. On the SUPERSEDED path do NOT clear the boundary — the superseding
    // actor already manages it (a logout cleared it, a new login armed its own); clearing here
    // would wipe the newer login's freshly-armed boundary and strand its logged-in UI making
    // UNAUTHENTICATED reads.
    if (
      !establishStillCurrent({
        establishGeneration,
        currentGeneration: providerRef.current?.loginGeneration() ?? -1,
        requestedWebId: id,
        currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
        webIdsEqual,
      })
    ) {
      return;
    }
    // PROACTIVE FETCH (task #123): now that the session's pod root is known, wire the
    // AUTHORITATIVE credential boundary so the patched global fetch PROACTIVELY attaches
    // the DPoP token to the pod / WebID origins on the FIRST request (no per-resource
    // 401-dance — the DocumentBrowser load no longer pays a wasted 401 per pod document
    // it reads). The pod root is the primary target (a pod on a DIFFERENT host than the
    // WebID is a valid Solid topology and MUST be listed); the WebID origin is folded in
    // by the seam's default. The boundary is https-only (http allowed only for a loopback
    // host under the dev/test opt-in), so the token can never ride cross-origin or over
    // cleartext.
    fetchInstallRef.current?.setState({
      provider: providerRef.current,
      allowedOrigins: deriveProactiveAllowedOrigins({
        podRoot: derived.podRoot,
        webId: id,
        allowInsecureLoopback: allowInsecureLoopbackRef.current,
      }),
    });
    setWebId(id);
    setSession(derived);
  }, []);

  // The actual login body — run AT MOST ONCE concurrently via the module-level
  // single-flight gate in `login` below.
  const doLogin = useCallback(
    async (id: string) => {
      setError(null);
      setLoggingIn(true);
      // IDENTITY CHANGE — drop EVERY trace of any prior identity FIRST (Finding 1):
      //  - reset the provider so its cached issuer, per-issuer sessions (DPoP keys +
      //    access tokens), authenticated-WebID claim, and token-attach count are gone
      //    — a login as a different WebID can never reuse the previous user's session;
      //  - clear session-derived React state (pod root, etc.) so nothing from WebID-A
      //    is rendered while authenticating as WebID-B.
      providerRef.current?.reset();
      // PROACTIVE FETCH (task #123): clear the prior identity's credential boundary too,
      // so a data fetch racing the identity switch (before the probe / establishSessionFor
      // re-arm it for the new WebID) is fail-closed at the gate — WebID-A's token can never
      // ride a request during the switch window.
      clearProactiveBoundary();
      setWebId(null);
      setSession(null);
      pendingWebIdHolder.current = id;
      // Snapshot THIS login's generation immediately AFTER reset() — it equals the
      // generation the probe will run in. Single-flight (the `login` wrapper) means
      // no other login advances the generation between here and the assertion below,
      // so the generation-scoped probe proof is unambiguous for THIS login.
      const loginGeneration = providerRef.current?.loginGeneration() ?? -1;
      try {
        // Read the PUBLIC profile FIRST (pristine fetch) so an unusable WebID errors
        // early — before any popup — and gives us the storage to probe.
        const pub = await readProfile(id, profileFetchRef.current ?? undefined);
        // Defence-in-depth: the provider-wide attach-count delta (per-attempt, not a
        // sticky flag) is kept alongside the per-probe proof below.
        const tokensAttachedBefore = providerRef.current?.tokensAttachedCount() ?? 0;
        // PER-PROBE PROOF (primary): register this probe Request on the provider (by
        // object identity, with a URL+generation single-use fallback) — NOT a network
        // header. The provider records an upgrade in THIS generation iff it actually
        // upgrades THIS probe — so we can prove THIS login's probe was token-upgraded,
        // not merely that "some request" was (a concurrent upgraded request for the
        // SAME WebID can bump the provider-wide count, but cannot satisfy our own
        // generation-scoped probe proof). Putting nothing on the wire keeps the probe
        // a "simple" CORS request, so a cross-origin pod does not reject a preflight
        // before the 401/upgrade path can run.
        //
        // Probe a protected resource via the PATCHED global fetch: a 401 triggers the
        // popup → token mint → retry. The retry's status + whether THIS probe was
        // token-upgraded prove login. A storage root is private on CSS/PSS by default,
        // so it 401s. Build the Request OBJECT first and register it before fetching —
        // the provider matches the id off this exact object (or its url-with-fragment
        // after the manager's re-wrap).
        //
        // FINDING 2 (round-4b): tag the probe URL with a unique unguessable fragment
        // (#probe-<uuid>). It is the UNFORGEABLE in-process marker that lets the
        // provider's URL fallback recognise THIS exact probe and reject an unrelated
        // same-base-URL data fetch — while being stripped on the wire (RFC 3986 §3.5),
        // so the pod still sees a plain GET to the storage root, no custom header, no
        // CORS preflight.
        const probeBase = pub.storages[0] ?? new URL("/", id).toString();
        // PROACTIVE FETCH (task #123) — ARM the credential boundary for the login PROBE.
        // The probe below goes through the PATCHED global fetch and MUST reach
        // `provider.upgrade()` (which drives the popup → token mint) to prove login. The
        // proactive patch only calls `upgrade()` for an ALLOWED origin, so we must admit
        // the probe's origin BEFORE fetching it — otherwise the probe is left
        // unauthenticated, the popup never opens, and login can never complete. We arm
        // from the PUBLIC profile we just read (the WebID + its advertised storages).
        // establishSessionFor RE-arms the authoritative boundary post-login; the catch
        // below clears it on failure. Without this the proactive swap would break
        // interactive login (caught by the 401-budget e2e).
        fetchInstallRef.current?.setState({
          provider: providerRef.current,
          allowedOrigins: deriveProactiveAllowedOrigins({
            podRoot: pub.storages[0],
            webId: id,
            allowInsecureLoopback: allowInsecureLoopbackRef.current,
          }),
        });
        const probeRequest = new Request(withProbeFragment(probeBase), { method: "GET" });
        providerRef.current?.beginLoginProbe(probeRequest);
        let res: Response;
        try {
          res = await fetch(probeRequest);
        } finally {
          // Drop the active probe registration regardless of outcome (e.g. a public
          // 200 with no 401 → no upgrade ran), so a later request can never match it.
          providerRef.current?.endLoginProbe();
        }
        const tokensAttachedAfter = providerRef.current?.tokensAttachedCount() ?? 0;
        const assessment = assessLoginProbe({
          status: res.status,
          tokensAttachedBefore,
          tokensAttachedAfter,
        });
        if (!assessment.ok) throw new Error(assessment.message);
        // The primary, per-probe gate: THIS login's probe must have been token-
        // upgraded IN THIS LOGIN'S GENERATION. A concurrent same-WebID upgrade for a
        // DIFFERENT request cannot satisfy it.
        if (!providerRef.current?.wasLoginProbeUpgraded(loginGeneration)) {
          throw new Error(
            "Login did not complete — no token was attached to this login's own " +
              "request (the probed resource may be public, or a different request " +
              "was upgraded). For your security you were not logged in.",
          );
        }
        // PROVE the session authenticated AS the requested WebID — never infer
        // "logged in" from "a token is attached" (Finding 1) — then re-read the
        // profile and derive the session. Shared with the autologin completion path.
        await establishSessionFor(id);
      } catch (e) {
        // The attempt failed — clear the pending WebID AND drop any partial provider
        // state, so a half-established session can't leak into the next attempt.
        pendingWebIdHolder.current = null;
        providerRef.current?.reset();
        // Drop any credential boundary the probe / a partially-completed
        // establishSessionFor armed, so a failed login never leaves the patched fetch
        // authenticating (task #123).
        clearProactiveBoundary();
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
    },
    [establishSessionFor, clearProactiveBoundary],
  );

  // SINGLE-FLIGHT login, WebID-SCOPED (round-4 + round-4b finding-1 fix). The gate
  // tracks the in-flight WebID alongside its promise:
  //  - SAME WebID in flight (double-click / StrictMode remount) → share the one
  //    in-flight promise; exactly one login proceeds, the other is a clean await.
  //  - DIFFERENT WebID in flight → REJECT cleanly without starting an overlapping
  //    probe. The pre-fix design returned the in-flight (other-WebID) promise, so a
  //    concurrent login for a different identity resolved as if THAT identity had
  //    logged in — a false-positive. Rejecting is the correct guard: this branch
  //    touches NO React state (it does not flip global loggingIn, which belongs to
  //    the in-flight attempt), it just hands back a rejected promise.
  // Either way there is never a second concurrent login, so the provider's
  // generation-scoped probe proof stays collision-free.
  const login = useCallback(
    (id: string): Promise<void> => {
      const existing = inFlight;
      // The WebID-scoped gate decision is a pure, unit-tested helper.
      const decision = decideSingleFlight(existing?.id ?? null, id, webIdsEqual);
      if (decision === "share" && existing) return existing.promise; // same WebID → share.
      if (decision === "reject") {
        // Different WebID → reject without overlapping the in-flight probe. Do NOT
        // touch React state: the in-flight attempt owns loggingIn/error.
        return Promise.reject(
          new Error(
            "A login for a different WebID is already in progress — wait for it to " +
              "finish or log out first.",
          ),
        );
      }
      const run = doLogin(id).finally(() => {
        // Clear the gate only if it still points at THIS run — never strand a later
        // login that already replaced it.
        if (inFlight?.promise === run) inFlight = null;
      });
      inFlight = { id, promise: run };
      return run;
    },
    [doLogin],
  );

  const logout = useCallback(() => {
    // RESET THE PROVIDER, not just React state (Finding 1): the in-memory issuer,
    // per-issuer sessions (DPoP key + access/refresh tokens), authenticated-WebID
    // claim, and token-attach count are all dropped, so a later login as a DIFFERENT
    // WebID cannot reuse this user's token/session and a login probe cannot look
    // authenticated with the stale token.
    providerRef.current?.reset();
    // PROACTIVE FETCH (task #123): drop the credential boundary so the patched global
    // fetch authenticates NOTHING after logout — every request is public again until a
    // new login re-arms it. Belt-and-braces with `provider.reset()` (whose generation
    // fence already makes a racing `upgrade()` reject): clearing the allowed-origins set
    // means a foreign or post-logout request is fail-closed at the gate, never reaching
    // the (now-reset) provider.
    clearProactiveBoundary();
    pendingWebIdHolder.current = null;
    setWebId(null);
    setSession(null);
    setError(null);
  }, [clearProactiveBoundary]);

  // ── AUTOLOGIN mount effect (full-page redirect deep-link / return) ───────────
  //
  // The DECISION (what to do given the URL + persisted/sentinel state + login state)
  // is the PURE `planAutologin`; this effect only EXECUTES the chosen action (URL
  // cleaning, provider calls, navigation). Keeping the decision pure makes the three
  // security-critical scenarios unit-testable with no DOM (autologin-plan.test.ts).
  //
  // It runs AFTER the runtime is `ready`, ONLY when NOT already logged in: a restored
  // / active session WINS — `planAutologin` returns `none` when `loggedIn`, so a
  // pre-set session short-circuits autologin (test (b)). There is no silent-session-
  // restore in this host today (tokens are memory-only); this guard means that IF one
  // is added later — or the user is already logged in — autologin is skipped.
  //
  // StrictMode double-invokes mount effects in dev; the module-level
  // `autologinEffectRan` latch (fed into the plan) + the persisted-redirect record +
  // the sessionStorage sentinel together make the body idempotent so at most one
  // redirect/complete fires.
  useEffect(() => {
    const provider = providerRef.current;
    const action = planAutologin({
      ready,
      hasProvider: provider !== null,
      loggedIn: webId !== null,
      effectAlreadyRan: autologinEffectRan,
      hasPendingRedirect: hasPendingRedirectLogin(),
      pendingRedirectWebId: consumePendingRedirectWebId(),
      hasCodeParams: hasAuthCodeParams(location.search),
      hasErrorParams: hasAuthErrorParams(location.search),
      fragmentWebId: parseAutologinFragment(location.hash),
      sentinel: readAutologinSentinel(),
      // The same WebID equality the rest of the auth seam uses, so a stale sentinel
      // for a DIFFERENT WebID does not swallow a fresh deep-link (Finding 2).
      webIdsEqual,
    });
    if (action.kind === "none" || !provider) return;
    // Any non-`none` action consumes the once-guard so a StrictMode double-mount
    // cannot fire a second redirect/complete.
    autologinEffectRan = true;

    // LOOP GUARD (CASE B repeat): a second `#autologin` for the SAME WebID with the
    // sentinel already set means we bounced back still unauthenticated. Do NOT
    // re-attempt: clear the sentinel + fragment and fall through to the login screen.
    if (action.kind === "clear-sentinel") {
      clearAutologinSentinel();
      history.replaceState(null, "", cleanedUrl(location.href));
      return;
    }

    // ABORT — returning from the full-page redirect with an OAuth ERROR
    // (?error&state: the broker declined silent SSO / the user declined). Without this
    // the error return is ignored and the persisted record + DPoP key + sentinel + the
    // error query all leak, BLOCKING future autologins. Clean EVERYTHING up and surface
    // the error once — do NOT loop, do NOT spew.
    if (action.kind === "abort-redirect") {
      // Pull the OAuth error code BEFORE cleaning the URL, for a useful message.
      const errParams = new URLSearchParams(location.search);
      const oauthError = errParams.get("error");
      // reset() clears the persisted redirect record + the DPoP key material + all
      // in-memory session state; the sentinel is a distinct key, cleared separately.
      provider.reset();
      // PROACTIVE FETCH (task #123): pair the boundary clear with reset() (defence-in-depth
      // — this pre-completion error return never armed the boundary, but every reset path
      // leaves it empty).
      clearProactiveBoundary();
      clearAutologinSentinel();
      pendingWebIdHolder.current = null;
      history.replaceState(null, "", cleanedUrl(location.href));
      setAutologinPending(false);
      setError(
        `Automatic sign-in was declined or unavailable${
          oauthError ? ` (${oauthError})` : ""
        } — please sign in.`,
      );
      return;
    }

    // CASE A — returning from the full-page redirect: complete the persisted login.
    if (action.kind === "complete") {
      const callbackUrl = location.href;
      const targetWebId = action.webId;
      // Clean the URL IMMEDIATELY so a refresh cannot replay the code/state.
      history.replaceState(null, "", cleanedUrl(callbackUrl));
      setAutologinPending(true);
      setError(null);
      provider
        .completeRedirectLogin(callbackUrl)
        .then(async () => {
          // completeRedirectLogin established the session + authenticatedWebId in the
          // provider; reuse the SAME post-login step as doLogin to confirm identity +
          // derive the session. The persisted record told us which WebID to expect.
          const id = targetWebId ?? provider.authenticatedWebId();
          if (!id) throw new Error("Autologin completed without a target WebID.");
          await establishSessionFor(id);
          clearAutologinSentinel(); // success → clean slate for next time.
        })
        .catch((e) => {
          // Failure: drop any persisted record + the sentinel, fall back to the login
          // screen. Do NOT loop, do NOT spew — surface a single error.
          provider.reset(); // clears the persisted record too; leaves reset-clean.
          // PROACTIVE FETCH (task #123): establishSessionFor may have armed a provisional
          // credential boundary before throwing (e.g. its profile re-read failed). Clear
          // it here — mirroring doLogin's failure path — so a failed autologin completion
          // never leaves the patched fetch authenticating after we've fallen back to
          // logged-out.
          clearProactiveBoundary();
          clearAutologinSentinel();
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setAutologinPending(false));
      return;
    }

    // CASE B — fresh autologin deep-link: begin the full-page redirect.
    const targetWebId = action.webId;
    // Clean the URL (strip the fragment) BEFORE doing anything else, so a refresh /
    // redirect-bounce can't re-trigger and the WebID isn't left in the address bar.
    history.replaceState(null, "", cleanedUrl(location.href));
    // Set the one-shot sentinel to the WebID we are about to attempt.
    setAutologinSentinel(targetWebId);
    // Set the pending WebID + reset the provider for the new identity (mirror
    // doLogin's identity-change reset). reset() clears any stale persisted redirect
    // record but NOT the sentinel we just set (distinct keys).
    pendingWebIdHolder.current = targetWebId;
    provider.reset();
    setAutologinPending(true);
    setError(null);

    const redirectReturnUri = new URL("/", location.href).toString();
    provider
      .beginRedirectLogin(redirectReturnUri)
      .then(({ authorizationUrl }) => {
        // Full-page redirect to the broker. Because the IdP session is live + the app
        // is pre-authorized, the broker redirects straight back authenticated.
        location.assign(authorizationUrl);
      })
      .catch((e) => {
        // Any error BEFORE the redirect: clear the sentinel, fall back to login.
        clearAutologinSentinel();
        pendingWebIdHolder.current = null;
        provider.reset();
        // PROACTIVE FETCH (task #123): defence-in-depth — CASE B doesn't arm the boundary
        // (it never reaches establishSessionFor before the redirect), but pair the clear
        // with reset() so every provider-reset failure path leaves the boundary empty too.
        clearProactiveBoundary();
        setAutologinPending(false);
        setError(e instanceof Error ? e.message : String(e));
      });
    // `webId` is a dep so a logout (webId→null) does NOT re-trigger autologin — the
    // once-guard and the cleaned URL (no fragment / no code) keep it inert after the
    // first pass.
  }, [ready, webId, establishSessionFor, clearProactiveBoundary]);

  const value = useMemo<SessionContextValue>(
    () => ({ webId, session, loggingIn, autologinPending, error, ready, login, logout }),
    [webId, session, loggingIn, autologinPending, error, ready, login, logout],
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
