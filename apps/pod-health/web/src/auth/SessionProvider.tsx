// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SessionProvider — the ONE place auth is wired for the Pod Health static host.
// It mounts the browser-only <authorization-code-flow> popup element, builds a
// WebID-driven DPoP token provider bound to THIS origin's static Client
// Identifier Document, and calls registerGlobally() so EVERY plain `fetch()`
// (including the ones inside @jeswr/fetch-rdf and the pod-health data layer)
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
//     so the OP shows "Pod Health" on the consent screen instead of a throwaway
//     dynamic registration.
//  4. `allowInsecureLoopback` is enabled ONLY for a localhost origin (dev against
//     a local CSS over HTTP); a deployed HTTPS origin stays strict.

import {
  decideSilentRestore,
  forgetPersisted,
  hasPersisted,
  webIdsEqual as packageWebIdsEqual,
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
  clearPendingRedirectLogin,
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
   * True while SILENT SESSION RESTORE is in flight on load — the returning user's
   * persisted refresh token is being redeemed (a refresh-grant fetch) before we
   * decide "logged out". App/LoginScreen surface a brief "Restoring…" state rather
   * than flashing the login form; we fall back to login only on a genuine restore
   * failure. Distinct from {@link autologinPending} (an explicit deep-link/redirect).
   */
  restorePending: boolean;
  /** Begin login for a WebID. Resolves when authenticated, rejects on failure. */
  login: (webId: string) => Promise<void>;
  /**
   * Sign out: clear the in-memory session AND the durable restorable credential +
   * remembered pointer. Resolves once the durable IndexedDB credential delete has
   * committed (awaited so a fast tab-close after sign-out cannot leave it behind).
   */
  logout: () => Promise<void>;
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

/**
 * SINGLE-FLIGHT logout (roborev HIGH). logout's teardown is `capture issuer → reset
 * in-memory → AWAIT durable delete → publish logged-out`. Without single-flight, a SECOND
 * concurrent `logout()` (double-click / a re-render) runs AFTER the first's `reset()` has
 * already cleared `#issuer`, so it captures NO issuer, SKIPS the durable delete, and
 * publishes the logged-out UI IMMEDIATELY — potentially BEFORE the first call's IndexedDB
 * delete has committed. A fast tab-close right after that early second publish could then
 * leave the refresh credential on disk. Module-level (matching the page-lifetime provider
 * singleton + the login `inFlight` gate) so every concurrent caller awaits the SAME
 * teardown — the durable delete is awaited exactly once, before any caller resolves.
 */
let logoutInFlight: Promise<void> | null = null;

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

// ── Silent session restore (the @jeswr/solid-session-restore thin wiring) ───────
//
// Cross-app UX invariant #1: a returning user who closed the tab (without logging
// out) and reopens the app is silently re-signed-in from their persisted DPoP-bound
// refresh token (a refresh-grant FETCH — no popup, no iframe, no flash of the login
// form). The DURABLE credential lives in the provider's audited IndexedDB store; the
// credential-FREE remembered-account pointer (which issuer to restore against) lives
// in localStorage under this app-specific key. On a plain load with no explicit
// deep-link/redirect-return in flight, `runSilentRestore` runs ONCE and, on success,
// sets webId so the autologin effect's `loggedIn` guard short-circuits.

/**
 * The app-specific localStorage key for the credential-free remembered-account pointer.
 * Namespaced under `pod-health:` (same prefix as the session-store DB name) so two apps
 * on a shared origin never collide on the pointer.
 */
export const REMEMBERED_ACCOUNT_KEY = "pod-health:remembered-account";

/**
 * The credential-free WebID→issuer pointer. MODULE-LEVEL (like the file's other
 * singletons) so a React.StrictMode remount reads the SAME instance — the pointer
 * is page-lifetime, not per-mount.
 */
const remembered = new RememberedAccount(REMEMBERED_ACCOUNT_KEY);

/**
 * SINGLE-FLIGHT silent restore. The mount effect double-fires under StrictMode and
 * the runtime resolves asynchronously, so the restore promise is cached MODULE-level
 * (matching the page-lifetime singleton model): the SECOND mount AWAITS the same
 * promise rather than running a second refresh-grant. Holds the decided outcome so the
 * effect can act on it (set webId / fall to login) regardless of which mount started it.
 */
type RestoreOutcome =
  | { kind: "restored"; webId: string; issuer: string }
  | { kind: "login" }
  | { kind: "skipped" };
/**
 * The single-flight latch — SCOPED TO THE PROVIDER INSTANCE that created it (roborev
 * Medium). The cached promise pins its restored session into THAT provider; if the
 * page-lifetime provider singleton were ever rebuilt while a restore is in flight, a later
 * mount reusing a promise bound to the OLD provider would then `establishSessionFor` against
 * the NEW provider (whose `authenticatedWebId()` is unset) and wrongly fall back to login
 * despite a valid restore. Keying by provider makes a provider change start a FRESH restore.
 */
let restoreInFlight: { provider: WebIdDPoPTokenProvider; promise: Promise<RestoreOutcome> } | null =
  null;

/**
 * A pending-redirect record is STALE when one exists but the URL carries NEITHER
 * `?code` NOR `?error` — i.e. a full-page-redirect login persisted its record and
 * navigated to the broker, but the tab was reopened on a plain URL without ever
 * returning from the broker (the redirect never completed). The record now points at
 * no in-flight flow: the planner waits forever for a `code`/`error` that never arrives
 * AND — the bug this guards — it makes {@link explicitFlowInProgress} suppress silent
 * restore from a valid persisted refresh credential indefinitely in the tab. Pure so
 * the staleness decision is unit-testable (roborev finding; same class as #74).
 */
export function isStalePendingRedirect(inputs: {
  hasCodeParams: boolean;
  hasErrorParams: boolean;
  hasPendingRedirect: boolean;
}): boolean {
  return inputs.hasPendingRedirect && !inputs.hasCodeParams && !inputs.hasErrorParams;
}

/**
 * Whether an EXPLICIT login flow owns this page load (an `#autologin/<webid>`
 * deep-link, OUR `?code&state` / `?error&state` redirect return, or a pending
 * persisted redirect flow). Silent restore is SKIPPED in those cases — the explicit
 * path takes precedence over a stale remembered pointer. Pure given the URL pieces +
 * the persisted-redirect probe, so the gate is testable.
 *
 * `?code&state` / `?error&state` count ONLY when PAIRED WITH a pending redirect record
 * (roborev): OUR full-page-redirect login always persists a record BEFORE navigating to
 * the broker, so a code/error return that belongs to us always has one. An ORPHANED OAuth
 * callback URL (a stray bookmark / a callback that is not ours, with NO pending record)
 * must NOT suppress silent restore indefinitely — without this pairing it would leave a
 * valid persisted session unused forever. (`completeRedirectLogin` reads that same record,
 * so a code/error with no record could not complete an autologin anyway.)
 *
 * NOTE: a pending-redirect that is {@link isStalePendingRedirect} (no `?code`/`?error`)
 * must NOT count as an explicit flow — the caller CLEARS the stale record first and
 * passes `hasPendingRedirect: false`, so a stale record can never suppress restore.
 */
export function explicitFlowInProgress(inputs: {
  hasCodeParams: boolean;
  hasErrorParams: boolean;
  fragmentWebId: string | null;
  hasPendingRedirect: boolean;
}): boolean {
  // A code/error return is OUR explicit flow only when a pending redirect record backs it.
  const ourRedirectReturn =
    (inputs.hasCodeParams || inputs.hasErrorParams) && inputs.hasPendingRedirect;
  return ourRedirectReturn || inputs.fragmentWebId !== null || inputs.hasPendingRedirect;
}

/**
 * Run the silent-restore decision ONCE and return the outcome (single-flighted via
 * {@link restoreInFlight}). Implements the package README's `runSilentRestore`: read
 * the remembered pointer, run `decideSilentRestore` (its `restoreIssuer` drives the
 * provider's refresh-grant), and on a `webid-mismatch` tear down FAIL-CLOSED in the
 * exact order provider-reset → forgetPersisted → pointer-clear; for the other login
 * reasons use the tri-state `hasPersisted` + `shouldDropRememberedPointer` to decide
 * whether to drop the pointer. The provider's `restoreIssuer` has already pinned the
 * restored session in-memory, so a `restored` outcome means the caller can derive the
 * session from `provider.authenticatedWebId()`.
 */
function runSilentRestore(
  provider: WebIdDPoPTokenProvider,
  store: SessionStore | undefined,
): Promise<RestoreOutcome> {
  // SHARE the in-flight promise ONLY when it belongs to the SAME provider instance that
  // created it (roborev Medium). A promise from a since-replaced provider pinned its restore
  // into the OLD provider, so reusing it here would establishSessionFor against the NEW one
  // and wrongly fall to login — start a fresh restore instead.
  if (restoreInFlight && restoreInFlight.provider === provider) return restoreInFlight.promise;
  const promise = (async (): Promise<RestoreOutcome> => {
    const r = remembered.read();
    const decision = await decideSilentRestore({
      lastActiveWebId: r?.webId,
      remembered: r ? [r] : [],
      // The one fetch: the provider's thin restoreIssuer wrapper runs the refresh grant
      // and pins the rebuilt session in-memory (under its own generation fence).
      restoreIssuer: (issuer) => provider.restoreIssuer(new URL(issuer)),
      // Use the PACKAGE's webIdsEqual for the decision (identical fail-closed semantics
      // to the provider's own — see the README).
      webIdsEqual: packageWebIdsEqual,
    });
    if (decision.outcome === "restored") {
      // The restore SUCCEEDED — restoreIssuer has pinned the session in-memory. Re-confirm
      // the pointer (issuer may have been canonicalised by the grant), but BEST-EFFORT: a
      // pointer-write failure must NOT throw away a genuinely-restored session (roborev
      // Medium). If this threw and we fell to the outer catch returning `login`, the
      // provider would stay authenticated behind a logged-out UI. Swallow + keep restored.
      try {
        remembered.write(decision.webId, decision.issuer);
      } catch {
        // pointer rewrite failed — the in-memory restore still stands; next load retries.
      }
      return { kind: "restored", webId: decision.webId, issuer: decision.issuer };
    }
    // FAIL-CLOSED webid-mismatch teardown, IN ORDER: the provider's restoreIssuer (one
    // layer down) already pinned the WRONG-WebID session in-memory, so (1) reset() drops
    // that in-memory session FIRST, (2) forgetPersisted drops the durable credential,
    // (3) clear the pointer. Without (1) a wrong-WebID session would linger in-memory.
    if (decision.reason === "webid-mismatch") {
      provider.reset();
      if (store && r?.issuer) await forgetPersisted(store, new URL(r.issuer)); // durable first.
      // The pointer is credential-free localStorage — guard its clear so a storage throw can
      // never reject this teardown (the durable credential is already forgotten above).
      try {
        remembered.clear();
      } catch {
        // pointer clear failed — non-fatal; the credential is already gone.
      }
      return { kind: "login" };
    }
    // Other login reasons: keep the pointer iff the credential might still be there
    // (tri-state) so a transient blip retries next load; drop a definitively-dead one.
    const presence = store && r?.issuer ? await hasPersisted(store, new URL(r.issuer)) : "absent";
    if (shouldDropRememberedPointer(decision.reason, presence)) {
      try {
        remembered.clear();
      } catch {
        // best-effort pointer clear — non-fatal.
      }
    }
    return { kind: "login" };
  })().catch(() => {
    // decideSilentRestore never throws, but fail-closed defensively: any unexpected
    // error means "could not restore" → fall back to login. Do NOT poison the
    // singleton with a rejected promise the next mount would re-await; resolve to login.
    // DEFENCE-IN-DEPTH (roborev Medium): if restoreIssuer had already PINNED an in-memory
    // session before the throw, falling back to login WITHOUT resetting would leave the
    // patched global fetch authenticating reads behind a logged-out UI. So reset the
    // provider here when it is authenticated — no authenticated behaviour may survive a
    // login fallback. (The durable credential is intentionally KEPT: the restore grant
    // itself succeeded; only the in-memory pinned session is dropped, so the next load can
    // restore again. The webid-mismatch path above already resets + forgets explicitly.)
    if (provider.authenticatedWebId() !== undefined) provider.reset();
    return { kind: "login" } as RestoreOutcome;
  });
  restoreInFlight = { provider, promise };
  return promise;
}

/**
 * The ORDERED logout teardown — extracted as a pure orchestration so the
 * security-critical ORDER is unit-testable without rendering React (same pattern as
 * `runSilentRestore`/`planAutologin`). The caller injects the side effects; this
 * function only sequences them.
 *
 * HEALTH-SENSITIVE INVARIANT (roborev finding): the durable refresh credential MUST be
 * deleted BEFORE the logged-out UI is published, so a user who closes/navigates the
 * instant they see "signed out" can never leave the credential on disk. The order is:
 *  1. `captureIssuer()` — read the authenticated issuer BEFORE reset() clears it (we
 *     delete the durable entry keyed by issuer).
 *  2. `resetInMemory()` — drop the in-memory provider session + remembered pointer +
 *     restore single-flight latch, so no authenticated fetch lingers and a same-tick
 *     re-run cannot silently restore.
 *  3. `await forgetDurable(issuer)` — AWAIT the IndexedDB delete. This is BEFORE step 4.
 *  4. `publishLoggedOut()` — only now flip the React UI to logged-out (logout resolves).
 *
 * `forgetDurable` is best-effort (its caller's `forgetPersisted` swallows store errors),
 * so even a store failure still reaches `publishLoggedOut` — but ONLY after the delete
 * has been awaited. Returns a promise that resolves when (and only when) the logged-out
 * state has been published, i.e. logout is observably complete.
 */
export async function runLogoutTeardown(steps: {
  captureIssuer: () => Promise<string | undefined>;
  resetInMemory: () => void;
  forgetDurable: (issuer: string) => Promise<void>;
  publishLoggedOut: () => void;
}): Promise<void> {
  const issuer = await steps.captureIssuer();
  steps.resetInMemory();
  if (issuer) await steps.forgetDurable(issuer); // AWAITED before the UI flip below.
  steps.publishLoggedOut();
}

/**
 * The action `establishSessionFor` should take to reconcile the durable remembered
 * pointer (and any stale issuer credential) after a login — a pure, unit-testable
 * decision (roborev Mediums).
 *
 *  - `"write"`  — write the pointer (WebID → issuer): the login is current AND either a
 *                 restorable credential FOR THIS WebID is on disk, OR the store read failed
 *                 transiently (we still know THIS login's identity, so we overwrite any
 *                 stale pointer with it rather than risk keeping a prior account's).
 *  - `"clear"`  — clear the pointer AND forget the issuer credential: the login is
 *                 current but NOT restorable as this WebID — either no credential is
 *                 stored, OR (the issuer-keyed-store cross-account case) the stored
 *                 credential belongs to a DIFFERENT account on the SAME issuer. Both the
 *                 stale pointer AND the stale credential must go, or the next load would
 *                 silently restore the WRONG account.
 *  - `"noop"`   — do nothing: the establish was SUPERSEDED (a racing logout/new-login
 *                 advanced the generation / changed the in-memory identity); that flow
 *                 owns the pointer + credential, so touching them here would clobber it.
 */
export type RememberedPointerAction = "write" | "clear" | "noop";

/**
 * Decide the remembered-pointer reconciliation. `storedWebId` is the WebID of the
 * credential CURRENTLY in the (issuer-keyed) store for this issuer — `undefined` when
 * none — and is the load-bearing input: `hasPersisted`-style presence is NOT enough,
 * because the store is keyed by ISSUER, so a "present" credential on a shared issuer may
 * belong to a PRIOR account, not this login. We require the stored credential's WebID to
 * equal the requested WebID before trusting it as this login's restorable session.
 */
export function reconcileRememberedPointer(inputs: {
  /** The stored credential's WebID for this issuer, or undefined when none is stored. */
  storedWebId: string | undefined;
  /** The store read threw (transient) — distinguish from "definitely no credential". */
  storeReadFailed: boolean;
  requestedWebId: string;
  establishGeneration: number;
  currentGeneration: number;
  currentAuthenticatedWebId: string | undefined;
  webIdsEqual: (a: string | undefined, b: string | undefined) => boolean;
}): RememberedPointerAction {
  // SUPERSEDED fence: a logout/new-login advanced the generation or changed identity.
  if (
    inputs.currentGeneration !== inputs.establishGeneration ||
    !inputs.webIdsEqual(inputs.currentAuthenticatedWebId, inputs.requestedWebId)
  ) {
    return "noop";
  }
  // TRANSIENT store-read failure (roborev Medium): we could NOT read the stored credential,
  // but we DO know — by the confirmed fail-closed identity guard above — that THIS login is
  // `requestedWebId` at this issuer. Returning "keep" here would leave any EXISTING pointer
  // untouched, and that pointer may name a PRIOR / DIFFERENT account (kept after an earlier
  // restore failure); the next load would then try to restore the wrong account. So WRITE
  // the current login's pointer instead — it always names the just-authenticated identity
  // and REPLACES any stale one. (If the credential genuinely isn't on disk, the next load's
  // restore fails closed to the login form — never to the wrong account.)
  if (inputs.storeReadFailed) return "write";
  // Write ONLY when the stored credential is genuinely THIS login's (issuer-keyed store →
  // verify the WebID, not just presence). Otherwise (no credential, or a different
  // account's on this shared issuer) the login is not restorable as `id`: clear + forget.
  return inputs.webIdsEqual(inputs.storedWebId, inputs.requestedWebId) ? "write" : "clear";
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
  // Start TRUE so the very first paint (before the runtime is ready / the restore
  // decision lands) shows the "Restoring…" state, not a flash of the login form — we
  // only know whether there is a session to restore after the mount effect runs. It is
  // cleared once restore resolves (or once we determine no restore can run).
  const [restorePending, setRestorePending] = useState(true);
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
      .then(({ provider, profileFetch }) => {
        if (cancelled) return;
        providerRef.current = provider;
        profileFetchRef.current = profileFetch;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          // The runtime failed to load → `ready` never flips, so the silent-restore
          // effect can never run. Clear the restoring state so the user sees the login
          // form (with the error), not a stuck "Restoring…" screen.
          setRestorePending(false);
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
    // GENERATION FENCE for the durable-pointer write (roborev Medium): snapshot the
    // provider's login generation up front. A logout() / new login() advances it (via
    // reset()), so a re-check before remembered.write() below lets us SKIP the pointer
    // write if this establish was superseded MID-FLIGHT (during the persist/hasPersisted
    // awaits) — otherwise a logout racing those awaits would clear the pointer, then this
    // function would resume and re-write a STALE pointer for an already-logged-out session
    // (causing a spurious restore attempt next load). -1 when no provider (defensive).
    const establishGeneration = providerRef.current?.loginGeneration() ?? -1;
    // Re-read the profile (now authenticated) and derive the session.
    const me = await readProfile(id);
    const derived = deriveSession(me);
    setWebId(id);
    setSession(derived);
    // PERSIST THE POPUP LOGIN'S RESTORABLE CREDENTIAL — only NOW, AFTER the fail-closed
    // webIdsEqual guard above has confirmed the OP authenticated AS `id`. The popup login
    // requests `offline_access` and stashes the minted refresh token on the in-memory
    // session; this confirms-then-persists it (the provider re-checks the match too). The
    // redirect/autologin + restore paths already persisted inline (their guards run lower
    // down), so this is a no-op for them (no stashed `pendingRestorable`). Best-effort.
    await providerRef.current?.persistRestorableSessionFor(id);
    // SILENT-RESTORE POINTER + STALE-CREDENTIAL reconciliation (roborev Mediums): now that
    // THIS identity is confirmed logged in, reconcile the credential-free remembered
    // pointer (WebID → resolved issuer) against what is ACTUALLY in the durable store.
    // The store is keyed by ISSUER, so a "present" credential on a SHARED issuer may
    // belong to a PRIOR account — `hasPersisted` presence is NOT enough. We read the
    // stored session and require its WebID to equal `id` before trusting it as THIS
    // login's restorable session. The pure `reconcileRememberedPointer` returns the
    // action; `establishGeneration`/the current identity fence out a racing logout.
    const issuer = await providerRef.current?.authenticatedIssuer();
    const store = providerRef.current?.sessionStore;
    let storedWebId: string | undefined;
    let storeReadFailed = false;
    if (issuer && store) {
      try {
        storedWebId = (await store.get(new URL(issuer).href))?.webId;
      } catch {
        storeReadFailed = true; // transient → keep existing pointer/credential, retry next load.
      }
    }
    const action = reconcileRememberedPointer({
      storedWebId,
      storeReadFailed,
      requestedWebId: id,
      establishGeneration,
      currentGeneration: providerRef.current?.loginGeneration() ?? -1,
      currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
      webIdsEqual,
    });
    // "noop" (a racing logout/new-login owns the state) leaves everything as-is. A transient
    // store-read failure now yields "write" (overwrite with THIS login's pointer), never a
    // blind keep of a possibly-stale other-account pointer (roborev Medium). The pointer is
    // credential-free localStorage; its read/write/clear are BEST-EFFORT + GUARDED (roborev
    // Medium): a storage throw must NOT reject an otherwise-successful login/restore AFTER
    // setWebId/setSession already ran, and on the `"clear"` path the security-critical
    // durable `forgetPersisted` MUST still run even if clearing the pointer throws.
    if (action === "write" && issuer) {
      // This login's restorable credential FOR THIS WebID is on disk — write the
      // credential-free pointer. `remembered.write` REPLACES any prior pointer.
      try {
        remembered.write(id, issuer);
      } catch {
        // pointer write failed (storage unavailable) — non-fatal; the durable credential is
        // already persisted, so next load can still restore (it just re-reads the pointer).
      }
    } else if (action === "clear") {
      // Current login but NOT restorable as `id` (no credential, or a DIFFERENT account's
      // on this shared issuer). Drop the pointer AND forget the stale issuer credential so
      // the next load cannot silently restore the WRONG / a dead account. Guard the pointer
      // clear so a localStorage throw never skips the durable forget below.
      try {
        remembered.clear();
      } catch {
        // pointer clear failed (storage unavailable) — non-fatal; the durable forget is what
        // actually prevents restoring the wrong/dead account, and it still runs next.
      }
      if (issuer && store) await forgetPersisted(store, new URL(issuer));
    }
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

  const logout = useCallback((): Promise<void> => {
    // SINGLE-FLIGHT (roborev HIGH): a second concurrent logout() must AWAIT the first's
    // teardown, never run its own — otherwise it would see the provider already reset,
    // capture no issuer, skip the durable delete, and publish logged-out BEFORE the first
    // call's IndexedDB delete commits (a fast tab-close could then orphan the credential).
    if (logoutInFlight) return logoutInFlight;
    // RESET THE PROVIDER, not just React state (Finding 1): the in-memory issuer,
    // per-issuer sessions (DPoP key + access/refresh tokens), authenticated-WebID
    // claim, and token-attach count are all dropped, so a later login as a DIFFERENT
    // WebID cannot reuse this user's token/session and a login probe cannot look
    // authenticated with the stale token.
    const provider = providerRef.current;
    const store = provider?.sessionStore;
    // DURABLE-CREDENTIAL TEARDOWN — ORDERED + AWAITED (roborev finding, HEALTH-SENSITIVE).
    // logout is the ONE place that drops the persisted restorable credential + the
    // remembered pointer (reset() deliberately does NOT touch the durable store — it runs
    // mid-login too). The ORDER is load-bearing and lives in the pure, testable
    // `runLogoutTeardown`: capture issuer → reset in-memory → AWAIT durable delete →
    // publish logged-out. The durable refresh credential is gone BEFORE the logged-out UI
    // is published, so a user who closes/navigates the instant they see "signed out" can
    // never leave it on disk (a same-tick reload could otherwise silently restore).
    const run = runLogoutTeardown({
      // 1. Capture the issuer BEFORE reset() clears #issuer (we delete by issuer).
      captureIssuer: () =>
        provider?.authenticatedIssuer().catch(() => undefined) ?? Promise.resolve(undefined),
      // 2. Drop the in-memory provider + remembered pointer + restore single-flight latch
      //    so no authenticated fetch lingers and a same-tick re-run cannot silently restore.
      resetInMemory: () => {
        // SECURITY-CRITICAL FIRST (roborev): drop the in-memory session + invalidate the
        // restore latch BEFORE the best-effort pointer clear. The remembered pointer is
        // credential-free and lives in localStorage, which CAN throw (private mode / quota /
        // disabled). If `remembered.clear()` ran first and threw, it would abort logout
        // before reset() + the durable delete — leaving an authenticated in-memory session
        // AND the durable credential behind. Order + guard so the security-critical steps
        // always run and the durable delete (step 3) is always reached.
        provider?.reset();
        pendingWebIdHolder.current = null;
        // INVALIDATE THE SILENT-RESTORE SINGLE-FLIGHT (roborev finding): the restore effect
        // has `webId` as a dependency, so logout (webId→null) RE-RUNS it. Without this, it
        // would re-await the module-level `restoreInFlight` promise still holding a stale
        // `{ kind: "restored" }` from the pre-logout restore and call establishSessionFor on
        // a now-RESET provider — the webIdsEqual guard fails closed (no stale session is
        // re-established — it is NOT a security hole), but it surfaces a spurious post-logout
        // error. Pin the latch to THIS provider with a settled `login` outcome so the re-run
        // is a clean no-op fall-through to the login form (no second grant). (A fresh full
        // page load re-evaluates the module and gets a null latch, so genuine next-load
        // restore is unaffected.)
        if (provider) {
          restoreInFlight = { provider, promise: Promise.resolve({ kind: "login" }) };
        } else {
          restoreInFlight = null;
        }
        // Best-effort pointer clear LAST + guarded: a localStorage throw here must never
        // abort the (already-completed) in-memory teardown or the pending durable delete.
        try {
          remembered.clear();
        } catch {
          // pointer clear failed (storage unavailable) — non-fatal; the credential-free
          // pointer is harmless, and the durable credential is still deleted in step 3.
        }
      },
      // 3. AWAIT the durable IndexedDB delete BEFORE the logged-out UI is published.
      forgetDurable: (issuer) =>
        store ? forgetPersisted(store, new URL(issuer)) : Promise.resolve(),
      // 4. Only now — the durable credential is gone — flip the UI to logged-out.
      publishLoggedOut: () => {
        setWebId(null);
        setSession(null);
        setError(null);
      },
    }).finally(() => {
      // Clear the gate only if it still points at THIS run — never strand a later logout.
      if (logoutInFlight === run) logoutInFlight = null;
    });
    logoutInFlight = run;
    return run;
  }, []);

  // ── SILENT SESSION RESTORE mount effect (cross-app UX invariant #1) ──────────
  //
  // On a PLAIN load (no explicit deep-link / redirect-return in flight) of a returning
  // user, redeem their persisted DPoP-bound refresh token to silently re-establish the
  // session — no popup, no iframe, no flash of the login form. Runs AFTER the runtime
  // is `ready`, ONLY when NOT already logged in, and ONLY when no explicit flow owns the
  // page (an `#autologin/<webid>` deep-link, a `?code&state` / `?error&state` redirect
  // return, or a pending persisted redirect flow ALL take precedence — they own the
  // load). On a successful restore we set webId, so the autologin effect's `loggedIn`
  // guard short-circuits (no double login). On failure / no-account we clear the
  // restoring state and fall through to the login form. Single-flighted at module level
  // so a StrictMode double-mount runs the refresh grant once.
  useEffect(() => {
    const provider = providerRef.current;
    if (!ready || !provider) return; // wait for the runtime; restorePending stays true.
    if (webId !== null) {
      // Already logged in (an autologin completed first, say) — nothing to restore.
      setRestorePending(false);
      return;
    }
    const hasCodeParams = hasAuthCodeParams(location.search);
    const hasErrorParams = hasAuthErrorParams(location.search);
    let hasPendingRedirect = hasPendingRedirectLogin();
    // STALE PENDING-REDIRECT CLEANUP (roborev finding): a pending-redirect record with
    // NO `?code`/`?error` means the redirect never completed (the tab was reopened on a
    // plain URL). Left in place it would make the gate below SUPPRESS silent restore from
    // a valid persisted refresh credential indefinitely. CLEAR the stale record and treat
    // it as absent so restore PROCEEDS. (A genuine in-flight return — code/error present —
    // is NOT stale and still owns the load via the gate. A fragment deep-link, if present,
    // still wins via `fragmentWebId` below even after this clear.)
    if (isStalePendingRedirect({ hasCodeParams, hasErrorParams, hasPendingRedirect })) {
      clearPendingRedirectLogin();
      hasPendingRedirect = false;
    }
    // GATE: an explicit login flow owns this load → skip silent restore entirely.
    if (
      explicitFlowInProgress({
        hasCodeParams,
        hasErrorParams,
        fragmentWebId: parseAutologinFragment(location.hash),
        hasPendingRedirect,
      })
    ) {
      setRestorePending(false);
      return;
    }
    let cancelled = false;
    runSilentRestore(provider, provider.sessionStore)
      .then(async (outcome) => {
        if (cancelled) return;
        if (outcome.kind === "restored") {
          // restoreIssuer already pinned the session + authenticatedWebId in the
          // provider; reuse the SAME post-login step as doLogin/autologin to confirm
          // identity (defence-in-depth webIdsEqual) + derive the session into state.
          try {
            await establishSessionFor(outcome.webId);
          } catch (e) {
            // PROFILE-READ FAILED AFTER A SUCCESSFUL RESTORE (roborev finding): the
            // provider has already PINNED a token-attached session in-memory, so falling
            // back to the login form WITHOUT resetting would leave the (patched) global
            // fetch authenticating reads while the UI shows logged-out — an authenticated/
            // logged-out mismatch. RESET the provider FIRST so no authenticated fetch
            // behaviour survives behind the login screen, then surface the error. The
            // durable credential is intentionally KEPT (the restore itself succeeded — a
            // cosmetic profile-read blip must not force a re-login next load); only the
            // in-memory pinned session is dropped, so the next load can restore again.
            provider.reset();
            if (!cancelled) {
              setWebId(null);
              setSession(null);
              setError(e instanceof Error ? e.message : String(e));
            }
          }
        }
        // restored or login: the restoring phase is over either way.
        if (!cancelled) setRestorePending(false);
      })
      .catch(() => {
        if (!cancelled) setRestorePending(false);
      });
    return () => {
      cancelled = true;
    };
    // `webId` is a dep so a logout (webId→null) does NOT re-trigger restore — the
    // module-level single-flight promise is already settled, so re-running the effect
    // re-awaits the SAME (login/restored) outcome and does not run a second grant.
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
  // `runSilentRestore` effect above) is the durable-credential path: on a plain load it
  // can set `webId` from the persisted DPoP-bound refresh token, after which this
  // autologin effect's `loggedIn` guard short-circuits. An EXPLICIT `#autologin/<webid>`
  // deep-link / `?code&state` return is mutually exclusive with restore (restore is
  // gated off by `explicitFlowInProgress`), so the two effects never both act.
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
      restorePending,
      error,
      ready,
      login,
      logout,
    }),
    [webId, session, loggingIn, autologinPending, restorePending, error, ready, login, logout],
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
