// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SessionProvider — the ONE place auth is wired for the Pod Drive static host.
// It mounts the browser-only <authorization-code-flow> popup element, builds a
// WebID-driven DPoP token provider bound to THIS origin's static Client
// Identifier Document, and calls registerGlobally() so EVERY plain `fetch()`
// (including the ones inside @jeswr/fetch-rdf and the @jeswr/pod-drive data layer)
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
//     so the OP shows "Pod Drive" on the consent screen instead of a throwaway
//     dynamic registration.
//  4. `allowInsecureLoopback` is enabled ONLY for a localhost origin (dev against
//     a local CSS over HTTP); a deployed HTTPS origin stays strict.

import {
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
  /** True once the auth runtime has loaded and registerGlobally() ran. */
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
   * True while the mount-time SILENT SESSION RESTORE is in flight — i.e.
   * "Restoring your session…". A returning user (a remembered account + a persisted
   * DPoP-bound refresh token) is being silently re-authenticated via a refresh-token
   * grant (no popup/redirect). App/LoginScreen surface a brief restoring state rather
   * than flashing the login form. ONLY ever true when there is a remembered pointer to
   * attempt — a first-time user (no pointer) sees the login form immediately, no flash.
   * Mutually exclusive with {@link autologinPending}: silent restore is skipped when an
   * autologin deep-link (`#autologin/<webid>`) or a `?code`/`?error` redirect return is
   * present (those are owned by the autologin effect).
   */
  restoringSession: boolean;
  /** Begin login for a WebID. Resolves when authenticated, rejects on failure. */
  login: (webId: string) => Promise<void>;
  /**
   * Drop the session: resets in-memory state AND forgets the durable credential +
   * the remembered-account pointer (an explicit logout, unlike a logout-less tab
   * close which keeps the durable credential so silent restore can rebuild it).
   */
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
  /**
   * The durable, WebID/issuer-scoped credential store for silent session restore.
   * `undefined` when IndexedDB is unavailable — the app still works memory-only
   * (login succeeds, just no persistence / no later restore).
   */
  sessionStore?: SessionStore;
}

let authRuntimeSingleton: Promise<AuthRuntime> | null = null;

// ── SILENT SESSION RESTORE singletons (@jeswr/solid-session-restore) ───────────
//
// MODULE-LEVEL (one per page), matching the auth-runtime singleton model, so a
// React.StrictMode double-mount REUSES them rather than constructing a second store /
// pointer per mount. The dbName + remembered key are app-specific (per the package's
// per-app isolation requirement — two apps on a shared origin must NOT share a store).

/**
 * The durable credential store. `null` when IndexedDB is unavailable (private mode /
 * SSR / locked-down env) — the provider then runs memory-only and silent restore is a
 * no-op. Guarded by {@link indexedDbAvailable} so constructing it never throws.
 */
const sessionStore: SessionStore | null = indexedDbAvailable()
  ? new IndexedDbSessionStore({ dbName: "pod-drive:sessions" })
  : null;

/**
 * The credential-FREE WebID→issuer pointer (localStorage-backed) that selects which
 * issuer silent restore runs against on load. Degrades safely when localStorage is
 * unavailable. Holds NO token — only the public WebID + issuer the login resolved.
 */
const remembered = new RememberedAccount("pod-drive:remembered-account");

/**
 * MODULE-LEVEL single-flight latch for the mount-time silent restore: cache the
 * promise so a StrictMode double-mount (or any second mount) runs the restore EXACTLY
 * ONCE per page. Reset only by a full page load (module re-eval). The restore reads
 * the remembered pointer + runs the refresh grant, so running it twice would
 * double-grant; the latch makes it idempotent across mounts.
 */
let silentRestorePromise: Promise<SilentRestoreResult> | null = null;

/** The outcome of {@link runSilentRestore}. */
type SilentRestoreResult =
  | { kind: "restored"; webId: string; issuer: string }
  | { kind: "login" }
  | { kind: "skipped" };

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
 * Build + globally-register the auth runtime EXACTLY ONCE per page. Repeated
 * calls (e.g. a StrictMode double-mount) return the same in-flight/settled
 * promise without re-snapshotting fetch or re-patching the global.
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
    // Snapshot the pristine global fetch BEFORE the manager patches it — captured
    // here, inside the once-only guard, so a second effect pass can never grab the
    // already-patched fetch as the "pristine" baseline.
    const profileFetch = globalThis.fetch.bind(globalThis);
    const { ReactiveFetchManager } = await import("@solid/reactive-authentication");
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
        // The durable credential store — login persists its refresh token + DPoP key
        // here; restoreIssuer rebuilds a session from it. Undefined → memory-only.
        sessionStore: cfg.sessionStore,
      },
    );
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

/**
 * The subset of the token provider the silent-restore logic uses. Restated as a
 * narrow interface so {@link silentRestoreOnce} is unit-testable with a lightweight
 * double (no full {@link WebIdDPoPTokenProvider} / auth runtime needed).
 */
export interface RestoreCapableProvider {
  restoreIssuer(issuer: URL): Promise<{ webId: string } | undefined>;
  reset(): void;
  forgetPersisted(issuer: URL): Promise<void>;
  hasPersisted(issuer: URL): Promise<"present" | "absent" | "unknown">;
}

/** The pointer side {@link silentRestoreOnce} needs (read/write/clear). */
export interface RestorePointer {
  read(): { webId: string; issuer?: string } | null;
  write(webId: string, issuer: string): void;
  clear(): void;
}

/**
 * The SILENT SESSION RESTORE core (dependency-injected + exported for testing).
 * Implements the README's `runSilentRestore`: read the remembered pointer, ask the
 * pure {@link decideSilentRestore} (wired to the provider's
 * {@link WebIdDPoPTokenProvider.restoreIssuer} backed by the durable store, and the
 * SAME `webIdsEqual` the rest of the seam uses); on a `restored` outcome the session
 * is already pinned in the provider; on `login` run the fail-closed keep/drop teardown.
 *
 * Returns `skipped` (so the caller paints NO restoring state — first-time user, no
 * flash) when there is no remembered pointer to attempt.
 *
 * SECURITY (webid-mismatch teardown ORDER is load-bearing): the refresh grant inside
 * `restoreIssuer` pins the session BEFORE returning, so on a mismatch the WRONG
 * identity is already in-memory. We drop it (reset) FIRST, THEN forget the durable
 * credential, THEN clear the pointer — so the wrong identity's token can never satisfy
 * a read between the steps. This ORDER is exactly what the adversarial test asserts.
 */
export async function silentRestoreOnce(
  provider: RestoreCapableProvider,
  pointer: RestorePointer,
): Promise<SilentRestoreResult> {
  const r = pointer.read();
  // No remembered pointer → nothing to attempt. Resolve immediately to "skipped" so
  // a first-time user sees the login form with NO restoring flash.
  if (!r) return { kind: "skipped" };
  const decision = await decideSilentRestore({
    lastActiveWebId: r.webId,
    remembered: [r],
    // The thin per-app wiring: the provider's refresh-grant restore for an issuer.
    restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
    // The app's OWN webIdsEqual (imported from the token provider), so the equality
    // used to match last-active→remembered is identical to the auth-seam's.
    webIdsEqual,
  });
  if (decision.outcome === "restored") {
    pointer.write(decision.webId, decision.issuer); // re-confirm the pointer.
    return { kind: "restored", webId: decision.webId, issuer: decision.issuer };
  }
  // FAIL-CLOSED webid-mismatch teardown — STRICT ORDER (security-critical):
  //  1. reset() drops the WRONG in-memory session FIRST (restoreSession pinned it
  //     one layer down, inside provider.restoreIssuer);
  //  2. forgetPersisted drops the durable credential for the remembered issuer;
  //  3. clear the remembered pointer.
  // Doing (1) before (2) guarantees the wrong identity's token can never leak into a
  // read between the two steps.
  if (decision.reason === "webid-mismatch") {
    provider.reset();
    if (r.issuer) await provider.forgetPersisted(new URL(r.issuer));
    pointer.clear();
    return { kind: "login" };
  }
  // Otherwise: keep/drop the remembered pointer per the pure matrix + tri-state
  // presence. A definitive invalid_grant cleared the credential (presence "absent")
  // → drop the pointer; a transient failure preserved it ("present"/"unknown") →
  // KEEP it for a retry on the next load.
  const presence = r.issuer ? await provider.hasPersisted(new URL(r.issuer)) : "absent";
  if (shouldDropRememberedPointer(decision.reason, presence)) pointer.clear();
  return { kind: "login" };
}

/**
 * The mount-time SILENT SESSION RESTORE — run EXACTLY ONCE per page via the
 * module-level {@link silentRestorePromise} latch, supplying the module singletons
 * ({@link silentRestoreOnce} holds the actual logic).
 *
 * MUTUAL EXCLUSION with autologin (load-bearing): the caller only invokes this when
 * NEITHER an `#autologin/<webid>` deep-link NOR a `?code`/`?error` redirect return is
 * present (those are owned by the autologin effect). So on any given load, silent
 * restore and autologin never both run — they are mutually exclusive by URL.
 */
// Exported so the latch-freshness test can drive the EXACT production single-flight
// latch (prime it, invalidate it, prove a fresh promise is minted). The parameter is
// the narrow {@link RestoreCapableProvider} (which WebIdDPoPTokenProvider satisfies)
// so the test needs no full auth runtime; the production call site passes the real
// provider unchanged.
export function runSilentRestore(provider: RestoreCapableProvider): Promise<SilentRestoreResult> {
  if (silentRestorePromise) return silentRestorePromise;
  silentRestorePromise = silentRestoreOnce(provider, remembered);
  return silentRestorePromise;
}

/**
 * Invalidate the module-level silent-restore latch (FINDING 3). The latch caches the
 * restore RESULT promise for the page lifetime so a StrictMode double-mount runs the
 * (refresh-granting) restore exactly once. On LOGOUT this MUST be nulled: logout sets
 * `webId=null`, which re-runs the restore mount effect, and a cached `{kind:"restored"}`
 * (or a stale teardown) would otherwise be REPLAYED against the now-logged-out state —
 * a spurious post-logout error / wrong state. Exported as a named module-level function
 * (rather than an inline `silentRestorePromise = null` in `logout`) so a test can
 * exercise the EXACT production guard: prime the latch via {@link runSilentRestore},
 * call this, and assert a subsequent {@link runSilentRestore} mints a FRESH promise
 * (proving the stale one was cleared). Removing this call from `logout` — or emptying
 * its body — must make that test fail.
 */
export function invalidateSilentRestoreLatch(): void {
  silentRestorePromise = null;
}

/**
 * The actions a runtime-init FAILURE (the `getAuthRuntime().catch`) must perform
 * (FINDING 4). Pure data — the effect applies it. The load-bearing field is
 * `setRestoringFalse`: when `getAuthRuntime` REJECTS, `ready` stays false so the
 * silent-restore effect (gated on `ready`) never runs and never flips
 * `restoringSession → false` — the UI would hang forever on "Restoring your session…",
 * hiding the login/error path. So the catch must ALSO clear `restoringSession`.
 * Extracted + exported (rather than left inline in the catch) so a test asserts the
 * production decision genuinely includes clearing the restoring flag — removing
 * `setRestoringFalse` here (or the effect's use of it) must fail that test.
 */
export interface RuntimeInitFailureAction {
  /** Surface the build error to the UI (always). */
  setError: true;
  /** Clear `restoringSession` so the UI does not hang on "Restoring…" (the fix). */
  setRestoringFalse: true;
}

/** Decide what the runtime-init `.catch` must do — see {@link RuntimeInitFailureAction}. */
export function decideRuntimeInitFailure(): RuntimeInitFailureAction {
  return { setError: true, setRestoringFalse: true };
}

/**
 * The action the mount-time SILENT SESSION RESTORE effect should take, computed from
 * the page state at effect time. Pure — the effect performs the side effects (clearing
 * `restoringSession`, running the restore). Mirrors `planAutologin` / `decideSingleFlight`
 * (the established extracted-decider pattern) so this decision is genuinely unit-tested
 * against production code rather than a re-implementation:
 *  - `"skip-not-ready"` — the runtime is not ready yet OR no provider OR already logged
 *    in: do nothing this pass (the effect just returns; it does NOT touch
 *    `restoringSession` — a later pass with `ready` true owns that).
 *  - `"skip-autologin-url"` — an `#autologin`/`?code`/`?error` marker is present: this
 *    load is the autologin effect's job. Clear `restoringSession` and return.
 *  - `"skip-no-pointer"` — there is NO remembered pointer NOW (FINDING 3's restore-effect
 *    half: logout cleared it, this effect re-ran because logout set `webId=null`). Bail
 *    to a clean logged-out state WITHOUT consulting / awaiting the cached
 *    `silentRestorePromise`, so a stale `{kind:"restored"}` can never be replayed. Clear
 *    `restoringSession` and return.
 *  - `"run"` — a returning user with a remembered pointer and no autologin marker: run
 *    the silent restore.
 */
export type RestoreEffectAction =
  | "skip-not-ready"
  | "skip-logged-in"
  | "skip-autologin-url"
  | "skip-no-pointer"
  | "run";

export interface RestoreEffectInputs {
  /** The auth runtime is loaded + registerGlobally() has run. */
  ready: boolean;
  /** The token provider singleton has resolved (mount wired providerRef). */
  hasProvider: boolean;
  /** Already authenticated (e.g. a re-render after restore set webId). */
  loggedIn: boolean;
  /** This load carries an `#autologin`/`?code`/`?error` marker (autologin's job). */
  isAutologinUrl: boolean;
  /** A remembered WebID→issuer pointer exists NOW (re-read at effect time). */
  hasRememberedPointer: boolean;
}

/**
 * Decide what the silent-restore mount effect should do. Pure — no I/O, no mutation.
 *
 * GUARDS in order: not ready / no provider / already logged in → skip (the not-ready
 * skips DON'T clear `restoringSession`; the logged-in skip does — see below); an
 * autologin-URL load → `skip-autologin-url`; no remembered pointer → `skip-no-pointer`
 * (the FINDING-3 load-bearing case); otherwise → `run`.
 *
 * The `skip-no-pointer` branch is the one finding 3 (restore-effect half) depends on:
 * if it is removed (i.e. the effect runs `runSilentRestore` even with no pointer), the
 * post-logout latch replay reappears. The load-bearing test asserts this branch.
 */
export function decideRestoreEffect(inputs: RestoreEffectInputs): RestoreEffectAction {
  if (!inputs.ready || !inputs.hasProvider) return "skip-not-ready";
  if (inputs.loggedIn) return "skip-logged-in";
  if (inputs.isAutologinUrl) return "skip-autologin-url";
  if (!inputs.hasRememberedPointer) return "skip-no-pointer";
  return "run";
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
  const [autologinPending, setAutologinPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paint a brief "Restoring your session…" state ONLY when a silent restore will
  // actually run AND has something to attempt — i.e. there IS a remembered pointer
  // AND this load is not an autologin deep-link / redirect return (those are mutually
  // exclusive with restore). A lazy initializer (computed once on mount) so a
  // first-time user — no pointer — sees the login form immediately with NO flash. The
  // restore effect flips this to false when it resolves.
  const [restoringSession, setRestoringSession] = useState<boolean>(() => {
    if (typeof location === "undefined") return false;
    // Autologin / redirect-return load → restore is skipped; never paint restoring.
    if (
      hasAuthCodeParams(location.search) ||
      hasAuthErrorParams(location.search) ||
      parseAutologinFragment(location.hash) !== null
    ) {
      return false;
    }
    // Only restoring if there is a remembered pointer to attempt.
    return remembered.read() !== null;
  });

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
      // The module-level durable store (or undefined when IndexedDB is unavailable).
      sessionStore: sessionStore ?? undefined,
    })
      .then(({ provider, profileFetch }) => {
        if (cancelled) return;
        providerRef.current = provider;
        profileFetchRef.current = profileFetch;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) {
          // FINDING 4: a runtime-init REJECTION leaves `ready` false, so the silent-
          // restore effect (which is gated on `ready`) never runs and never flips
          // `restoringSession` to false — the UI would be stuck forever on "Restoring
          // your session…", hiding the login/error path. The actions to take are the
          // exported, separately-tested `decideRuntimeInitFailure()` decision: surface
          // the error AND clear restoringSession. Driving the catch off the decider
          // means a test of the decider genuinely guards the "clear restoring" fix.
          const onFail = decideRuntimeInitFailure();
          if (onFail.setError) setError(e instanceof Error ? e.message : String(e));
          if (onFail.setRestoringFalse) setRestoringSession(false);
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

  // The SHARED post-authentication step, used by the popup login (doLogin), the
  // full-page-redirect autologin completion, AND the silent session restore. By the
  // time this runs the provider has an established, token-attached session whose
  // `authenticatedWebId` is the identity the OP vouched for. We PROVE that matches the
  // WebID the user asked to log in as (never inferring "logged in" from a token being
  // attached — the Finding-1 invariant), then re-read the (now authenticated) profile
  // and derive the session into React state. Throws (fail-closed) on a WebID mismatch.
  //
  // On success we also write the remembered-account pointer (the WebID + the issuer
  // the provider resolved) so a later tab-reopen can attempt a silent restore against
  // that issuer.
  //
  // `profileMayDegrade` (silent-restore path only): a RESTORED token means logged-in
  // even if the now-authenticated profile re-read fails — the WebID-mismatch check is
  // the genuine security guard and always throws, but a transient profile-read failure
  // must NOT fail an otherwise-valid restore. When true, a profile-read failure falls
  // back to a derived session computed from the WebID alone (the same fallback
  // deriveSession applies when a profile advertises no storage). The popup/autologin
  // paths keep the strict behaviour (throw on profile failure).
  const establishSessionFor = useCallback(
    async (id: string, opts?: { profileMayDegrade?: boolean }) => {
      const authedWebId = providerRef.current?.authenticatedWebId();
      if (!webIdsEqual(authedWebId, id)) {
        throw new Error(
          "Login did not complete — the identity provider authenticated a " +
            `different WebID (${authedWebId ?? "unknown"}) than the one requested ` +
            `(${id}). For your security you were not logged in.`,
        );
      }
      // Re-read the profile (now authenticated) and derive the session.
      let derived: DerivedSession;
      try {
        derived = deriveSession(await readProfile(id));
      } catch (e) {
        if (!opts?.profileMayDegrade) throw e;
        // RESTORED-BUT-PROFILE-DEGRADED: the token is valid (the WebID check above
        // passed); a transient profile-read failure must not fail the restore. Derive
        // a session from the WebID alone (the no-storage fallback path of deriveSession).
        derived = deriveSession({
          webId: id,
          name: id,
          storages: [],
          oidcIssuers: [],
        });
      }
      setWebId(id);
      setSession(derived);
      // Remember this now-active account → its resolved issuer, for a later silent
      // restore. Best-effort: a storage fault degrades to in-memory-only (never a
      // failed login). The issuer is the one the provider just resolved/pinned.
      const issuer = providerRef.current?.currentIssuer();
      if (issuer) remembered.write(id, issuer);
    },
    [],
  );

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
    [establishSessionFor],
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
    // Capture the issuer to forget BEFORE reset() clears it — fall back to the
    // remembered pointer's issuer if the provider has already lost it. An EXPLICIT
    // logout must drop the durable credential (unlike a logout-less tab close, which
    // keeps it so silent restore can rebuild the session).
    const issuerHref = providerRef.current?.currentIssuer() ?? remembered.read()?.issuer;
    // RESET THE PROVIDER, not just React state (Finding 1): the in-memory issuer,
    // per-issuer sessions (DPoP key + access/refresh tokens), authenticated-WebID
    // claim, and token-attach count are all dropped, so a later login as a DIFFERENT
    // WebID cannot reuse this user's token/session and a login probe cannot look
    // authenticated with the stale token. (reset() does NOT touch the durable store.)
    providerRef.current?.reset();
    pendingWebIdHolder.current = null;
    // FINDING 3: invalidate the module-level silent-restore latch on logout via the
    // exported helper. The latch caches the restore RESULT for the page lifetime; logout
    // sets webId=null which re-runs the restore mount effect, and a cached
    // `{kind:"restored"}` (or a stale teardown) would otherwise be replayed against the
    // now-logged-out state — a spurious post-logout error / wrong state. Clearing it
    // means a future restore starts clean. The mount effect ALSO re-reads the pointer
    // and bails (decideRestoreEffect → "skip-no-pointer") when it is now null
    // (belt-and-braces). Calling the named helper (not an inline `= null`) lets a test
    // exercise the exact production guard — see invalidateSilentRestoreLatch.
    invalidateSilentRestoreLatch();
    setWebId(null);
    setSession(null);
    setError(null);
    // DURABLE forget (best-effort, fire-and-forget — logout is synchronous): drop the
    // persisted refresh credential for this issuer AND the remembered pointer, so the
    // next load shows the login screen rather than silently restoring.
    if (issuerHref) {
      try {
        // forgetPersisted swallows store errors internally; guard only the sync
        // URL parse + attach a no-op catch so a stray rejection is never unhandled.
        void providerRef.current?.forgetPersisted(new URL(issuerHref)).catch(() => {});
      } catch {
        // An unparseable issuer href — nothing to forget; the pointer clear below
        // still prevents a restore attempt next load.
      }
    }
    remembered.clear();
  }, []);

  // ── SILENT SESSION RESTORE mount effect (#69 P0) ─────────────────────────────
  //
  // Runs ONCE on mount, AFTER the runtime is `ready`, to silently re-authenticate a
  // returning user from their persisted DPoP-bound refresh token — BEFORE the app
  // decides "logged out". Gated so an explicit autologin deep-link / `?code`/`?error`
  // redirect return takes precedence (those are owned by the autologin effect): we do
  // NOT run silent restore when any of those URL markers is present. Since silent
  // restore runs only when NONE are present, and autologin runs ONLY on those, the two
  // are MUTUALLY EXCLUSIVE on any given load — a restored session and an autologin can
  // never both fire. (And a restored session also short-circuits autologin via
  // planAutologin's `loggedIn → none`, belt-and-braces.)
  //
  // Single-flighted by the module-level `silentRestorePromise` latch so a StrictMode
  // double-mount runs the (refresh-granting) restore exactly once.
  useEffect(() => {
    const provider = providerRef.current;
    // The skip/run decision is the PURE, exported, separately-tested decider
    // `decideRestoreEffect` (mirrors planAutologin / decideSingleFlight) — so the
    // load-bearing `skip-no-pointer` guard (FINDING 3's restore-effect half) is
    // genuinely tested against production code, not a re-implementation.
    const action = decideRestoreEffect({
      ready,
      hasProvider: provider !== null,
      loggedIn: webId !== null,
      // Mutual exclusion with autologin: a deep-link / redirect-return load is the
      // autologin effect's job (and the initial restoringSession was already false for
      // these loads, so no flash).
      isAutologinUrl:
        hasAuthCodeParams(location.search) ||
        hasAuthErrorParams(location.search) ||
        parseAutologinFragment(location.hash) !== null,
      // Re-read the pointer NOW: logout clears it and re-runs this effect (it set
      // webId=null). FINDING 3 (belt-and-braces with the logout latch-null): if there
      // is NO remembered pointer, bail WITHOUT consulting / awaiting the cached
      // `silentRestorePromise`, so a stale `{kind:"restored"}` can never be replayed.
      // On a LEGITIMATE first load the pointer is non-null (a returning user), so this
      // does NOT fire and StrictMode single-flight via runSilentRestore's latch is
      // fully preserved.
      hasRememberedPointer: remembered.read() !== null,
    });
    // skip-not-ready: a later pass with `ready` true owns restoringSession — leave it.
    if (action === "skip-not-ready" || !provider) return;
    // The remaining skips are terminal for THIS load: there is nothing to restore, so
    // clear the restoring flag and let the login/already-logged-in UI render.
    if (action !== "run") {
      setRestoringSession(false);
      return;
    }
    let cancelled = false;
    runSilentRestore(provider)
      .then(async (result) => {
        if (cancelled) return;
        if (result.kind === "restored") {
          // restoreIssuer already pinned the provider; confirm identity + derive the
          // session into React state (profile read may degrade — a valid token still
          // means logged-in). establishSessionFor re-confirms the remembered pointer.
          try {
            await establishSessionFor(result.webId, { profileMayDegrade: true });
          } catch (e) {
            // The WebID-mismatch guard inside establishSessionFor is the ONLY throw
            // here (profile failures degrade) — a genuine mismatch between the restored
            // session's WebID and itself should be impossible, but fail closed: drop
            // the session + fall back to login.
            if (!cancelled) {
              provider.reset();
              setError(e instanceof Error ? e.message : String(e));
            }
          }
        }
        // result.kind === "login" / "skipped" → fall through to the login screen.
      })
      .catch(() => {
        // runSilentRestore never throws (decideSilentRestore is fail-closed), but be
        // defensive: any unexpected error → fall back to the login screen.
      })
      .finally(() => {
        if (!cancelled) setRestoringSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, webId, establishSessionFor]);

  // ── AUTOLOGIN mount effect (full-page redirect deep-link / return) ───────────
  //
  // The DECISION (what to do given the URL + persisted/sentinel state + login state)
  // is the PURE `planAutologin`; this effect only EXECUTES the chosen action (URL
  // cleaning, provider calls, navigation). Keeping the decision pure makes the three
  // security-critical scenarios unit-testable with no DOM (autologin-plan.test.ts).
  //
  // It runs AFTER the runtime is `ready`, ONLY when NOT already logged in: a restored
  // / active session WINS — `planAutologin` returns `none` when `loggedIn`, so a
  // pre-set session short-circuits autologin (test (b)). Silent session restore (the
  // effect above) and autologin are MUTUALLY EXCLUSIVE on any given load: restore runs
  // only when NO `#autologin`/`?code`/`?error` marker is present, and autologin runs
  // ONLY on those markers — so they never both fire. A restored session (webId set)
  // additionally short-circuits autologin here via `planAutologin → none`.
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
        setAutologinPending(false);
        setError(e instanceof Error ? e.message : String(e));
      });
    // `webId` is a dep so a logout (webId→null) does NOT re-trigger autologin — the
    // once-guard and the cleaned URL (no fragment / no code) keep it inert after the
    // first pass.
  }, [ready, webId, establishSessionFor]);

  const value = useMemo<SessionContextValue>(
    () => ({
      webId,
      session,
      loggingIn,
      autologinPending,
      restoringSession,
      error,
      ready,
      login,
      logout,
    }),
    [webId, session, loggingIn, autologinPending, restoringSession, error, ready, login, logout],
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
