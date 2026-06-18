// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SessionProvider — the ONE place auth is wired for the Pod Mail static host.
// It mounts the browser-only <authorization-code-flow> popup element, builds a
// WebID-driven DPoP token provider bound to THIS origin's static Client
// Identifier Document, and installs the @jeswr/solid-elements PROACTIVE auth-fetch
// patch (`installProactiveAuthFetch`) so EVERY plain `fetch()` (including the ones
// inside @jeswr/fetch-rdf and the @jeswr/pod-mail data layer) PROACTIVELY carries
// the DPoP token on the FIRST request to an allowed origin. The library's `fetch?:`
// seam can then be left as the ambient global — no per-call wiring.
//
// WHY THE SEAM, NOT THE RAW `ReactiveFetchManager` (task #123): the raw upstream
// manager sends every request UNAUTHENTICATED first and attaches the token only
// REACTIVELY on a 401 — per resource, with no origin/storage cache — so every
// distinct pod URL pays a wasted 401 → upgrade → retry (an inbox load paid a wasted
// 401 per pod document it read: the type-index, the inbox folder document, …). The
// seam-based proactive patch attaches up front for an allowed origin (zero wasted
// 401s) AND enforces a real credential boundary (the provider's own `matches()` is
// unconditional; `isOriginAllowed` is the gate), so the token never rides
// cross-origin. The shared, generalized helper lives in @jeswr/solid-elements/auth
// (pod-mail IMPORTS it — it is NOT a per-app copy).
//
// LOAD-BEARING HOUSE RULES (do not "simplify" away):
//  1. @solid/reactive-authentication is pure-ESM + browser-only (custom elements,
//     popups), and the WebIdDPoPTokenProvider builds on it. The provider lives in
//     ./webid-token-provider; the seam primitives are pure + tree-shakeable, so the
//     proactive patch carries no browser-only top-level evaluation (verified by the
//     build gate). The provider's login/restore/logout/DPoP invariants are UNCHANGED
//     by the #123 fetch-layer swap — only HOW the token is attached to fetches moved
//     from reactive (ReactiveFetchManager) to proactive (the seam). The package is
//     still loaded via a DYNAMIC import inside the runtime build so it never evaluates
//     at module-eval / SSR / prerender time (it remains the home of the popup element).
//  2. The proactive patch is installed EXACTLY ONCE per page (its own once-only guard,
//     mirroring this file's auth-runtime singleton): a StrictMode double-mount re-uses
//     the install and never stacks a second patch over the first.
//  3. The client_id is the per-origin static Client Identifier Document at
//     `${origin}/clientid.jsonld` (generated at build by scripts/gen-clientid.mjs),
//     so the OP shows "Pod Mail" on the consent screen instead of a throwaway
//     dynamic registration.
//  4. `allowInsecureLoopback` is enabled ONLY for a localhost origin (dev against
//     a local CSS over HTTP); a deployed HTTPS origin stays strict. It also gates
//     whether the proactive credential boundary admits an http:// loopback pod origin.

import {
  deriveProactiveAllowedOrigins,
  installProactiveAuthFetch,
  type ProactiveFetchInstall,
} from "@jeswr/solid-elements/auth";
import {
  type CredentialPresence,
  decideSilentRestore,
  IndexedDbSessionStore,
  indexedDbAvailable,
  RememberedAccount,
  type SessionStore,
  shouldDropRememberedPointer,
} from "@jeswr/solid-session-restore";
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
  /**
   * True while a SILENT SESSION RESTORE is in flight on page load — i.e.
   * "Restoring…". A returning user who only closed the tab keeps a DPoP-bound
   * refresh token in IndexedDB; on mount we run a refresh-token grant (a fetch, no
   * popup/iframe) to re-establish the session before deciding "logged out". The App
   * shows a brief restoring state instead of the login form while this runs, then
   * lands on the actual page (success) or the login screen (genuine failure).
   */
  restoring: boolean;
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
   * calls `setState` on login / silent-restore / logout to update the live credential
   * boundary (the allowed-origins set + the provider), so the patched global fetch
   * PROACTIVELY attaches the token on the FIRST request to an allowed origin — no
   * per-resource 401-dance — and authenticates NOTHING when logged out.
   */
  fetchInstall: ProactiveFetchInstall;
}

/**
 * The page-lifetime singleton session store (IndexedDB, origin-scoped) — built
 * ONCE alongside the auth runtime and shared. Holds NO React state. Undefined in
 * SSR / locked-down environments (no IndexedDB), where the provider stays
 * in-memory-only and silent restore is simply unavailable.
 */
let sessionStoreSingleton: SessionStore | undefined;

/**
 * Pod Mail's IndexedDB database name for the durable refresh-token store. The
 * @jeswr/solid-session-restore package makes this INJECTABLE per app (so two apps on
 * a shared origin never share a session store); we supply Pod Mail's EXISTING name
 * verbatim, so the store + every persisted credential is bit-for-bit unchanged from
 * the pre-package copy.
 */
const SESSION_DB_NAME = "pod-mail:sessions";

/**
 * Pod Mail's localStorage key for the credential-free remembered-account pointer
 * (WebID → issuer), now an injectable per-app constructor arg on the package's
 * {@link RememberedAccount}. The EXACT key the pre-package copy used, so an existing
 * returning user's pointer is read unchanged. The instance holds NO credential.
 */
const rememberedAccount = new RememberedAccount("pod-mail.remembered-account");

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

// ── Silent session restore (closed-tab reopen) ───────────────────────────────
//
// A returning user who only closed the tab keeps a DPoP-bound refresh token in
// IndexedDB (WebID-scoped). On mount, BEFORE the login screen, we run a
// refresh-token grant (a fetch, no popup/iframe) to silently re-establish the
// session. This is the suite cross-app UX invariant #1.
//
// PRECEDENCE: a Pod-Manager `#autologin/<webid>` deep-link, a pending redirect
// flow, or an OAuth `?code/?error` redirect return all OUTRANK silent restore —
// those are explicit cross-app hand-offs the autologin effect owns. Silent
// restore is the NO-FRAGMENT returning-user path only.

/**
 * The settled outcome of the one page-lifetime silent restore — what BOTH a
 * StrictMode double-mount apply to their own React state. `restored` carries the
 * derived session so the second mount need not re-run the refresh grant.
 */
type SilentRestoreOutcome =
  | { kind: "restored"; webId: string; session: DerivedSession }
  | { kind: "login" };

/**
 * MODULE-LEVEL shared promise for the ONE silent restore per page (the fix for the
 * roborev StrictMode-deadlock finding). StrictMode double-invokes mount effects in
 * dev: the first run STARTS the restore (this promise); its cleanup marks itself
 * cancelled; the second run does NOT re-run — it AWAITS this same promise and
 * applies the outcome, so `restoring` is always cleared and the result is applied
 * exactly once regardless of how many times the effect mounts. Built once, behind a
 * null check, like {@link getAuthRuntime}. Reset only by a full page load.
 */
let silentRestorePromise: Promise<SilentRestoreOutcome> | null = null;

/**
 * Run the ONE silent restore (refresh-token grant via the provider, then derive
 * the app session), memoised on {@link silentRestorePromise} so a StrictMode
 * remount reuses it instead of re-running the grant. Provider-independent of React
 * state — it returns a pure {@link SilentRestoreOutcome} the effect applies. Never
 * throws (fail-closed to `login`).
 */
/** Parse a remembered issuer string to a URL, or undefined when absent/malformed. */
function parseIssuer(issuer: string | undefined): URL | undefined {
  if (!issuer) return undefined;
  try {
    return new URL(issuer);
  } catch {
    return undefined; // corrupt remembered issuer — unusable.
  }
}

/**
 * The durable-credential presence for a remembered issuer, for the pointer keep/drop
 * decision. A MALFORMED/absent issuer is an unusable pointer → `"absent"` (dropped
 * rather than retried forever — roborev finding). Otherwise delegate to the
 * provider's tri-state read (which returns `"unknown"` on a store-read error so a
 * blip does not orphan the credential).
 */
async function credentialPresenceFor(
  provider: WebIdDPoPTokenProvider,
  issuer: string | undefined,
): Promise<CredentialPresence> {
  const url = parseIssuer(issuer);
  if (!url) return "absent";
  return provider.hasPersisted(url);
}

/**
 * PROACTIVE FETCH (task #123): arm the credential boundary for a SILENTLY-RESTORED
 * session. The restore path NEVER runs the login flow's pre-probe arming, so without
 * this the restored session's reads — the cosmetic profile re-read inside this function
 * AND the first library read after the effect publishes the session — would all be
 * UNAUTHENTICATED (the boundary is empty until armed), and the restored user would face
 * the 401-dance the proactive patch exists to kill. The SessionProvider passes a closure
 * (it holds the install handle + the loopback opt-in); a missing closure (a unit test
 * that does not exercise the proactive layer) is a no-op. The OIDC endpoints ride the
 * pristine fetch (the re-entrancy guard), so they do not depend on this boundary.
 */
type ArmRestoreBoundary = (args: { webId: string; issuer: string; podRoot?: string }) => void;

function runSilentRestore(
  provider: WebIdDPoPTokenProvider,
  armBoundary?: ArmRestoreBoundary,
  // Drop the proactive credential boundary back to "authenticate nothing". Called on the
  // unexpected-error catch path (roborev HIGH): a wiring fault could throw AFTER
  // armBoundary armed the boundary AND restoreIssuer pinned the restored token — so the
  // provider could still upgrade + the patched global fetch could still authenticate while
  // the UI falls back to logged-out. Pairing reset() + this clear there is fail-closed.
  clearBoundary?: () => void,
): Promise<SilentRestoreOutcome> {
  if (silentRestorePromise) return silentRestorePromise;
  silentRestorePromise = (async (): Promise<SilentRestoreOutcome> => {
    const remembered = rememberedAccount.read();
    const decision = await decideSilentRestore({
      lastActiveWebId: remembered?.webId,
      remembered: remembered ? [remembered] : [],
      // The one fetch: a refresh-token grant for the remembered issuer. Never throws
      // for the expired/revoked case (the provider returns undefined and clears the
      // dead entry); a thrown error is unexpected and decideSilentRestore treats it
      // as "login" (fail-closed).
      restoreIssuer: async (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual,
    });
    if (decision.outcome !== "restored") {
      // SECURITY (roborev finding) — a `webid-mismatch` means restoreIssuer ALREADY
      // succeeded one layer down: it pinned an in-memory session AND persisted a
      // rotated credential for the WRONG (mismatched) WebID before the
      // last-active-WebID check up here failed it. So FULLY tear it down, fail-closed:
      //  1. reset() SYNCHRONOUSLY FIRST — drops the pinned in-memory session +
      //     re-fences in-flight work IMMEDIATELY, so no patched fetch can upgrade as
      //     the wrong WebID during the (awaited) IndexedDB delete window below
      //     (closing the timing gap a delete-then-reset ordering left open).
      //  2. THEN forget the persisted credential (async) so the orphaned durable
      //     token for the wrong WebID is removed, and clear the pointer.
      if (decision.reason === "webid-mismatch") {
        const issuer = parseIssuer(remembered?.issuer);
        provider.reset();
        if (issuer) await provider.forgetPersisted(issuer);
        rememberedAccount.clear();
        return { kind: "login" };
      }
      // Otherwise: fall back to login. The keep/drop-pointer decision is the PURE
      // shouldDropRememberedPointer, driven by the REASON + (for restore-failed)
      // whether the durable credential survived (do NOT wipe the pointer on a
      // transient blip / an unreadable store). The issuer is validated as a URL
      // first — a malformed remembered issuer is an unusable pointer (credential
      // `absent`), so it gets dropped rather than retried forever.
      const credential = await credentialPresenceFor(provider, remembered?.issuer);
      if (shouldDropRememberedPointer(decision.reason, credential)) rememberedAccount.clear();
      return { kind: "login" };
    }
    // PROACTIVE FETCH (task #123): arm a PROVISIONAL credential boundary (the WebID +
    // the restored session's issuer origins) BEFORE the cosmetic profile re-read below,
    // so that (now-authenticated) read carries the token. The AUTHORITATIVE pod-root
    // boundary is re-armed once the session derives its podRoot (below).
    armBoundary?.({ webId: decision.webId, issuer: decision.issuer });
    // The refresh grant rebuilt a live session in the provider (issuer pinned,
    // session cached). Per the cross-app invariant, a RESTORED token means
    // logged-in even if the cosmetic profile read degrades: read the (now
    // authenticated) profile to derive pod root / display name, but fall back to a
    // WebID-origin-derived session rather than bouncing a fully-restored user to
    // login on a transient profile blip.
    let session: DerivedSession;
    try {
      session = deriveSession(await readProfile(decision.webId));
    } catch {
      session = deriveSession({
        webId: decision.webId,
        name: decision.webId,
        storages: [],
        oidcIssuers: [decision.issuer],
      });
    }
    // Re-arm with the AUTHORITATIVE pod-root boundary now the session is known, so the
    // FIRST library read after restore is pre-authenticated — no per-resource 401-dance
    // after a silent restore either.
    armBoundary?.({ webId: decision.webId, issuer: decision.issuer, podRoot: session.podRoot });
    // Refresh the remembered pointer (issuer re-confirmed) so the NEXT reload
    // restores from the current credential.
    rememberedAccount.write(decision.webId, decision.issuer);
    return { kind: "restored", webId: decision.webId, session };
  })().catch(() => {
    // Any UNEXPECTED error in the restore wiring → fall back to login, fail-closed.
    // PROACTIVE FETCH (task #123, roborev HIGH): a wiring fault can throw AFTER the
    // restored token was pinned in the provider AND armBoundary armed the credential
    // boundary (e.g. between the two arm calls). Returning `login` alone would leave the
    // provider able to upgrade + the patched global fetch authenticating while the UI is
    // logged-out. So TEAR DOWN FAIL-CLOSED here: reset() the in-memory session (drops the
    // pinned restored token + re-fences in-flight work) and clear the proactive boundary,
    // exactly mirroring the doLogin / webid-mismatch teardown. Deliberately do NOT clear
    // the remembered pointer: decideSilentRestore / restoreIssuer don't throw (the normal
    // outcomes are handled above), so reaching here means a wiring fault — and
    // over-clearing a pointer whose credential may still be valid would reintroduce the
    // transient-wipe bug. A kept pointer at worst costs one extra doomed restore next load,
    // which then re-clears cleanly.
    provider.reset();
    clearBoundary?.();
    return { kind: "login" } as const;
  });
  return silentRestorePromise;
}

/**
 * Whether a silent restore is even worth attempting on THIS load — used to decide
 * the initial `restoring` paint so the login form does not flash before the
 * refresh-grant runs. TRUE iff: a remembered account exists AND no autologin URL
 * takes precedence (no `#autologin/…` fragment, no pending redirect record, no
 * `?code`/`?error` redirect return). Cheap + synchronous (reads localStorage +
 * the URL only) so it is safe in a `useState` initialiser. Conservative: any
 * unavailable storage → false (→ login), never a hung "Restoring…".
 */
function shouldAttemptSilentRestore(): boolean {
  // Not in a browser (SSR/test pre-DOM) → nothing to restore.
  if (typeof location === "undefined") return false;
  // Autologin precedence: a deep-link / pending redirect / redirect return wins.
  if (
    parseAutologinFragment(location.hash) !== null ||
    hasPendingRedirectLogin() ||
    hasAuthCodeParams(location.search) ||
    hasAuthErrorParams(location.search)
  ) {
    return false;
  }
  return rememberedAccount.read() !== null;
}

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
 * arm the authoritative proactive boundary, write the remembered pointer, and publish the
 * logged-in UI (roborev HIGH). Pure + exported so the race is unit-testable WITHOUT a React render.
 *
 * `establishSessionFor` awaits `readProfile(id)` after snapshotting its generation. A
 * logout()/new login() racing that await advances the provider generation (via reset()) AND
 * clears the boundary. If we re-armed + wrote the pointer + published UNCONDITIONALLY we would
 * (a) re-enable authenticated fetches against a reset/stale provider behind a logged-out UI,
 * (b) republish a stale session, or (c) RESURRECT the remembered pointer for an already-
 * logged-out / different-identity session (a spurious silent restore next load). Returns true
 * ONLY when the live generation still equals the snapshot AND the provider's authenticated
 * WebID still equals the requested identity — fail-closed (false) on EITHER mismatch, so the
 * caller bails WITHOUT touching the boundary or the pointer (clearing the boundary would wipe a
 * newer login's freshly-armed one). NOTE the provider's own `#persist` is already
 * generation-fenced internally, so the durable CREDENTIAL is safe; this fences the SessionProvider
 * side effects (boundary + the localStorage pointer + the UI publish).
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
    // until a login / silent-restore calls `fetchInstall.setState` with the live session
    // + allowed origins (see `establishSessionFor` / the logout teardown below).
    const fetchInstall = installProactiveAuthFetch();
    const profileFetch = fetchInstall.pristineFetch;
    // REGISTER the <authorization-code-flow> custom element. Its definition runs as a
    // module SIDE EFFECT of @solid/reactive-authentication (customElements.define in
    // AuthorizationCodeFlow.js). We adopted the proactive seam instead of the package's
    // ReactiveFetchManager (task #123), but the package is STILL the home of the popup
    // element the WebIdDPoPTokenProvider drives via getCode — so we MUST keep a VALUE
    // (side-effect) dynamic import here. A `import type {…}` is erased at compile and would
    // NOT register the element, leaving interactive login hung on `customElements.whenDefined`
    // (the roborev HIGH finding + the cause the e2e popup never opened). The dynamic import
    // keeps the browser-only element OUT of module-eval / SSR (the original Rule 1); we just
    // no longer construct a ReactiveFetchManager from it.
    await import("@solid/reactive-authentication");
    // Durable, origin-scoped DPoP-bound refresh-token store (silent restore on a
    // closed-tab reopen). Undefined in SSR / locked-down envs → in-memory-only.
    sessionStoreSingleton = indexedDbAvailable()
      ? new IndexedDbSessionStore({ dbName: SESSION_DB_NAME })
      : undefined;
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
        sessionStore: sessionStoreSingleton,
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
  // True while the mount-time silent restore is in flight (refresh-token grant).
  // Initialised TRUE so the very first paint (before the restore effect runs) shows
  // the brief "Restoring…" state rather than flashing the login form — but ONLY
  // when there is a remembered account to attempt AND no autologin URL takes
  // precedence; otherwise it starts false (nothing to restore → straight to login).
  const [restoring, setRestoring] = useState<boolean>(() => shouldAttemptSilentRestore());
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
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          // Runtime init FAILED → `ready` never flips true, so the silent-restore
          // effect (gated on `ready`) would never clear `restoring` and the UI would
          // be STUCK on "Restoring…", hiding the login screen + this error (roborev
          // MEDIUM). Clear it here so the LoginScreen (with the error) is shown.
          setRestoring(false);
        }
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
  // identity-switch login, and on the fail-closed restore/autologin failure paths, so a
  // request racing the teardown is fail-closed at the gate (the patched global fetch
  // leaves it unauthenticated). A no-op until the runtime has installed the patch
  // (fetchInstallRef set). Declared BEFORE the silent-restore effect that lists it as a
  // dependency, so the deps array does not reference it before its const initialisation.
  const clearProactiveBoundary = useCallback(() => {
    fetchInstallRef.current?.setState({ provider: null, allowedOrigins: new Set() });
  }, []);

  // ── SILENT SESSION RESTORE mount effect (closed-tab reopen) ──────────────────
  //
  // Runs ONCE per page, after the runtime is `ready`, ONLY when not already logged
  // in AND no autologin URL takes precedence (the no-fragment returning-user path).
  // It runs a refresh-token grant (a fetch, NO popup/iframe) via the provider's
  // `restoreIssuer`, driven by the PURE `decideSilentRestore` — so the
  // security-critical branch table (no account / no issuer / restored / failed) is
  // unit-tested without a browser. On `restored` we derive + set the session; on
  // `login` we just stop the restoring state and fall through to the login screen.
  //
  // PRECEDENCE: the `restoring` initial state already excluded the autologin URLs
  // (shouldAttemptSilentRestore), and this effect re-checks them, so a deep-link /
  // redirect return is left entirely to the autologin effect. A `webId` already set
  // (e.g. autologin completed first) also short-circuits to `none` here.
  useEffect(() => {
    const provider = providerRef.current;
    if (!ready || !provider) return;
    // Don't restore when a session already exists, or an autologin URL outranks us.
    // (Re-checked here, not just in the initial `restoring` paint, so a deep-link /
    // redirect return is left entirely to the autologin effect.)
    if (webId !== null || !shouldAttemptSilentRestore()) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    setRestoring(true);
    setError(null);
    // PROACTIVE FETCH (task #123): the boundary-arming closure runSilentRestore calls on
    // a `restored` outcome — provisionally (WebID + issuer) before the cosmetic profile
    // re-read, then authoritatively (adding the pod root) before the session is published
    // — so the restored session's reads are pre-authenticated (no 401-dance after a
    // silent restore). Reads the stable refs; never an effect dependency.
    const armBoundary: ArmRestoreBoundary = ({ webId: rwid, issuer, podRoot }) => {
      fetchInstallRef.current?.setState({
        provider: providerRef.current,
        allowedOrigins: deriveProactiveAllowedOrigins({
          ...(podRoot !== undefined ? { podRoot } : {}),
          webId: rwid,
          issuer,
          allowInsecureLoopback: allowInsecureLoopbackRef.current,
        }),
      });
    };
    // Await the ONE page-lifetime restore (memoised), so a StrictMode remount reuses
    // the same operation rather than re-running the grant — and ALWAYS clears its own
    // `restoring` when it settles (the deadlock fix: the terminal state writes are
    // guarded by the per-mount `cancelled`, but the SECOND mount runs this same await
    // and clears its OWN restoring). runSilentRestore never throws. The third arg is the
    // fail-closed boundary-clear runSilentRestore calls on its unexpected-error catch
    // (roborev HIGH) so a wiring fault can't leave the patched fetch authenticating.
    runSilentRestore(provider, armBoundary, clearProactiveBoundary).then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "restored") {
        setWebId(outcome.webId);
        setSession(outcome.session);
      }
      setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, webId, clearProactiveBoundary]);

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
    // GENERATION FENCE (roborev HIGH): snapshot the provider's login generation up front. A
    // logout() / new login() advances it (via reset()), so re-checking it (with the
    // authenticated WebID) before the durable pointer write + the authoritative boundary arm +
    // the UI publish below lets us BAIL if this establish was superseded MID-FLIGHT (during the
    // `readProfile` await). Without the fence a racing logout/new-login could (a) re-arm the
    // boundary against a reset/stale provider behind a logged-out UI, (b) republish a stale
    // webId/session, or (c) RESURRECT the remembered pointer for an already-logged-out / wrong
    // identity. The provider's own `#persist` is already generation-fenced internally, so the
    // durable CREDENTIAL is safe; this fences the SessionProvider-side effects. -1 when no
    // provider (defensive). See `establishStillCurrent`.
    const establishGeneration = providerRef.current?.loginGeneration() ?? -1;
    // PROACTIVE FETCH (task #123): arm a PROVISIONAL credential boundary (the WebID +
    // the resolved issuer origins) BEFORE the authenticated profile re-read below, so
    // that read actually carries the token. An autologin-completion reaches HERE without
    // the popup-login flow's pre-probe arming, so without this the "now authenticated"
    // profile re-read would be UNAUTHENTICATED: a private profile would fail (or, for a
    // WebID whose storage lives on another origin, degrade to the wrong fallback pod root
    // and restore a wrong session shape). The pod-root boundary is the AUTHORITATIVE one
    // re-armed once the profile yields derived.podRoot (below). The popup-login path has
    // already armed an equivalent boundary via the probe; re-arming with the same origins
    // is idempotent. The issuer is folded in from the provider's already-resolved issuer
    // (pod-mail's provider exposes it SYNCHRONOUSLY via `resolvedIssuer()` — no await, so
    // unlike pod-music there is no race window BEFORE this provisional arm; it runs in the
    // same synchronous tick as the entry WebID check above). It is best-effort — the WebID
    // origin is the load-bearing target for the profile re-read; the OIDC endpoints ride the
    // pristine fetch (the re-entrancy guard), so they do not depend on this boundary.
    const provisionalIssuer = providerRef.current?.resolvedIssuer();
    fetchInstallRef.current?.setState({
      provider: providerRef.current,
      allowedOrigins: deriveProactiveAllowedOrigins({
        webId: id,
        issuer: provisionalIssuer,
        allowInsecureLoopback: allowInsecureLoopbackRef.current,
      }),
    });
    // Re-read the profile (now authenticated) and derive the session.
    const me = await readProfile(id);
    const derived = deriveSession(me);
    // GENERATION FENCE for the durable pointer write + AUTHORITATIVE boundary-arm + UI publish
    // (roborev HIGH). `readProfile` above is an await, during which a logout()/new login() can
    // race: it advances the provider generation (via reset()) AND, for a logout, clears the
    // boundary; a new login clears it then ARMS ITS OWN. Without re-checking, this function
    // would then resume and (a) RE-ARM the boundary against a now-reset/stale provider —
    // re-enabling authenticated fetches behind a logged-out UI, (b) publish a STALE logged-in
    // session, or (c) re-write `rememberedAccount` for the superseded session — resurrecting a
    // silent-restore pointer the logout just cleared / pointing at the wrong identity. So
    // before the pointer write + authoritative arm + publish, re-check BOTH the generation and
    // the authenticated WebID against this establish's snapshot. On the SUPERSEDED path do NOT
    // clear the boundary — the superseding actor already manages it (a logout cleared it, a new
    // login armed its own); clearing here would wipe the newer login's freshly-armed boundary
    // and strand its logged-in UI making UNAUTHENTICATED reads.
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
    // REMEMBER this account (WebID + the issuer it authenticated against) so a
    // later page load can attempt a silent refresh-token restore. The provider
    // persisted the DPoP-bound refresh token + key in IndexedDB during the login;
    // this localStorage pointer just records WHICH issuer to restore. Only when the
    // provider knows the resolved issuer (it always does after a successful login).
    const issuer = providerRef.current?.resolvedIssuer();
    if (issuer) rememberedAccount.write(id, issuer);
    // PROACTIVE FETCH (task #123): now that the session's pod root + issuer are known,
    // wire the AUTHORITATIVE credential boundary so the patched global fetch PROACTIVELY
    // attaches the DPoP token to the pod / WebID / issuer origins on the FIRST request
    // (no per-resource 401-dance — the inbox load no longer pays a wasted 401 per pod
    // document it reads). The pod root is the primary target (a pod on a DIFFERENT host
    // than the WebID is a valid Solid topology and MUST be listed); the WebID + issuer
    // origins are folded in by the seam's default. The boundary is https-only (http
    // allowed only for a loopback host under the dev/test opt-in), so the token can never
    // ride cross-origin or over cleartext.
    fetchInstallRef.current?.setState({
      provider: providerRef.current,
      allowedOrigins: deriveProactiveAllowedOrigins({
        podRoot: derived.podRoot,
        webId: id,
        issuer,
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
        // from the PUBLIC profile we just read (the WebID + its advertised storages); the
        // issuer is folded in once resolved. establishSessionFor RE-arms the authoritative
        // boundary post-login; the catch below clears it on failure. Without this the
        // proactive swap would break interactive login (caught by the e2e).
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
    // FORGET THE DURABLE CREDENTIAL FIRST so a sign-out cannot be silently revived
    // on the next load: drop the persisted DPoP-bound refresh token + key for the
    // issuer this session authenticated against (IndexedDB), and the
    // remembered-account pointer (localStorage). reset() (below) only clears
    // IN-MEMORY state — it deliberately does NOT wipe the durable store (so a
    // re-login need not), so logout MUST clear it here. Read the issuer BEFORE
    // reset() (which clears it). forgetPersisted is fire-and-forget + best-effort.
    const issuer = providerRef.current?.resolvedIssuer();
    if (issuer) void providerRef.current?.forgetPersisted(new URL(issuer)).catch(() => {});
    rememberedAccount.clear();
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
    // Clear the module-level silent-restore single-flight cache (roborev MEDIUM): it may
    // hold a settled `{ kind: "restored" }` from this page's load. Without clearing it, a
    // later remount of SessionProvider in the SAME page lifetime would reuse that cached
    // result and re-apply the restored session — RESURRECTING the session we just logged
    // out of (the pointer was cleared, but the cache is independent). Null it so any future
    // restore re-decides from scratch (and finds no pointer → login).
    silentRestorePromise = null;
    setWebId(null);
    setSession(null);
    setError(null);
    setRestoring(false);
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
          // PROACTIVE FETCH (task #123, roborev MEDIUM): establishSessionFor may have armed
          // a provisional credential boundary before throwing (e.g. its profile re-read
          // failed). Clear it here — mirroring doLogin's failure path — so a failed
          // autologin completion never leaves the patched fetch authenticating after we've
          // fallen back to logged-out.
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
    () => ({ webId, session, loggingIn, autologinPending, restoring, error, ready, login, logout }),
    [webId, session, loggingIn, autologinPending, restoring, error, ready, login, logout],
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
