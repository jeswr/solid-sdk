// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SessionProvider — the ONE place auth is wired for the Pod Money static host.
// It mounts the browser-only <authorization-code-flow> popup element, builds a
// WebID-driven DPoP token provider bound to THIS origin's static Client
// Identifier Document, and installs the @jeswr/solid-elements PROACTIVE auth-fetch
// patch (`installProactiveAuthFetch`) so EVERY plain `fetch()` (including the ones
// inside @jeswr/fetch-rdf and the @jeswr/pod-money data layer) PROACTIVELY carries
// the DPoP token on the FIRST request to an allowed origin. The library's `fetch?:`
// seam can then be left as the ambient global — no per-call wiring.
//
// WHY THE SEAM, NOT THE RAW `ReactiveFetchManager` (task #123): the raw upstream
// manager sends every request UNAUTHENTICATED first and attaches the token only
// REACTIVELY on a 401 — per resource, with no origin/storage cache — so every
// distinct pod URL pays a wasted 401 → upgrade → retry. pod-money pays this on its
// LEDGER-DISCOVERY CHAIN: on login the host re-reads the authenticated profile, then
// runs `MoneyStore.discover` (the public Type Index + a fin:Transaction registration
// doc), then GETs the ledger file — several distinct pod URLs, each of which paid its
// own wasted 401 under the reactive manager. The seam-based proactive patch attaches
// up front for an allowed origin (zero wasted 401s) AND enforces a real credential
// boundary (the provider's own `matches()` is unconditional; `isOriginAllowed` is the
// gate), so the token never rides cross-origin. The shared, generalized helper lives
// in @jeswr/solid-elements/auth (pod-money IMPORTS it — it is NOT a per-app copy).
//
// LOAD-BEARING HOUSE RULES (do not "simplify" away):
//  1. @solid/reactive-authentication is pure-ESM + browser-only (custom elements,
//     popups), and the WebIdDPoPTokenProvider builds on it. The provider lives in
//     ./webid-token-provider; the seam primitives are pure + tree-shakeable, so the
//     proactive patch carries no browser-only top-level evaluation (verified by the
//     build gate). The provider's login/restore/logout/DPoP invariants are UNCHANGED
//     by the #123 fetch-layer swap — only HOW the token is attached to fetches moved
//     from reactive (ReactiveFetchManager) to proactive (the seam).
//  2. The proactive patch is installed EXACTLY ONCE per page (its own once-only guard,
//     mirroring this file's auth-runtime singleton): a StrictMode double-mount re-uses
//     the install and never stacks a second patch over the first.
//  3. The client_id is the per-origin static Client Identifier Document at
//     `${origin}/clientid.jsonld` (generated at build by scripts/gen-clientid.mjs),
//     so the OP shows "Pod Money" on the consent screen instead of a throwaway
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
  type SessionRestoreDecision,
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
  /** The derived session (pod root + finance ledger) once logged in. */
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
   * True while the mount-time SILENT SESSION RESTORE is in flight (a refresh-token
   * grant — a fetch, no popup/iframe). A returning user who only closed the tab
   * keeps a DPoP-bound refresh token persisted in IndexedDB; on reopen this restores
   * the session silently. App/LoginScreen surface a brief "Restoring…" state instead
   * of flashing the login form while this runs, then either land on the session or
   * fall back to login on a genuine restore failure. Distinct from
   * {@link autologinPending} (the Pod-Manager deep-link / redirect-return path).
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

interface AuthRuntimeConfig {
  callbackUri: string;
  clientId: string;
  allowInsecureLoopback: boolean;
  getWebId: () => Promise<string>;
  /** The durable credential store for silent restore (undefined → in-memory-only). */
  sessionStore: SessionStore | undefined;
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

// ── Silent session restore (closed-tab reopen) ───────────────────────────────
//
// Cross-app UX invariant #1: a returning user who only CLOSED the tab (no logout)
// must be silently re-established on reopen — no popup, no iframe, no login flash —
// by redeeming their persisted, DPoP-sender-constrained refresh token at the token
// endpoint (a plain fetch). The audited core is @jeswr/solid-session-restore; the
// app keeps only this thin wiring (the store/pointer singletons + the mount-time
// runSilentRestore decision + the brief "Restoring…" paint).

/** The IndexedDB DB name for THIS app's durable credential store (unique on a shared origin). */
const SESSION_DB_NAME = "pod-money:sessions";
/** The localStorage key for THIS app's credential-free remembered-account pointer. */
const REMEMBERED_ACCOUNT_KEY = "pod-money:remembered-account";

/**
 * MODULE-LEVEL durable-store singleton — built once, like {@link getAuthRuntime}.
 * `undefined` when IndexedDB is unavailable (private mode / no-DOM test): the
 * provider then stays in-memory-only and silent restore is simply unavailable
 * (no behaviour change, never a hung "Restoring…"). Construct only in the browser.
 */
let sessionStoreSingleton: SessionStore | undefined;

/** The credential-free WebID→issuer pointer (localStorage), keyed per app. */
const rememberedAccount = new RememberedAccount(REMEMBERED_ACCOUNT_KEY);

/**
 * The settled outcome of the ONE page-lifetime silent restore — what BOTH a
 * StrictMode double-mount apply to their own React state. `restored` carries the
 * derived session so the second mount need not re-run the refresh grant.
 */
type SilentRestoreOutcome =
  | { kind: "restored"; webId: string; session: DerivedSession }
  | { kind: "login" };

/**
 * MODULE-LEVEL shared promise for the ONE silent restore per page (the StrictMode
 * single-flight). StrictMode double-invokes mount effects in dev: the first run
 * STARTS the restore (this promise); the second run does NOT re-run — it AWAITS this
 * same promise and applies the outcome, so `restoring` is always cleared and the
 * result applied exactly once regardless of how many times the effect mounts. Built
 * once behind a null check, like {@link getAuthRuntime}. Reset only by a page load.
 */
let silentRestorePromise: Promise<SilentRestoreOutcome> | null = null;

/**
 * On a successful login, decide what to do with the remembered-account pointer given
 * whether a durable credential FOR THIS WebID exists. PURE + exported so the
 * cross-account security rule is unit-testable without a React harness:
 *  - `"present"` (a durable credential exists for this exact WebID) → WRITE this
 *    login's pointer (silent restore is genuinely available next load);
 *  - anything else (`"absent"` / `"unknown"` — no matching durable credential, e.g.
 *    the redirect path, a no-offline-access server, or a store-read error) → CLEAR any
 *    existing pointer. This is the load-bearing guard (roborev HIGH): a STALE pointer
 *    from a PRIOR account must never survive a login as a DIFFERENT WebID that has no
 *    durable credential, or the next reload would silently restore the WRONG account.
 */
export function rememberedPointerAction(
  presence: CredentialPresence | undefined,
): "write" | "clear" {
  return presence === "present" ? "write" : "clear";
}

/**
 * The sentinel `readSessionFenced` returns when this establish was SUPERSEDED during (or after)
 * the awaited profile read — the caller must BAIL silently (touch nothing) on this.
 */
export const SUPERSEDED = Symbol("establish-superseded");

/**
 * Read the (now-authenticated) profile + derive the session, with the FAILURE PATH FENCED against
 * supersession (roborev HIGH). Extracted as a pure, injectable async helper so the
 * profile-read-rejection race is unit-testable WITHOUT a React render / real provider.
 *
 * `establishSessionFor` awaits this profile read; a logout()/new login() can supersede the
 * establish WHILE it is pending, and the read can then REJECT. If the rejection propagated
 * unconditionally, the CALLER's catch (doLogin) would `reset()` the provider + clear the proactive
 * boundary — clobbering the SUPERSEDING login's freshly-armed state on the error path. So on a
 * read failure this re-checks currency: if SUPERSEDED it SWALLOWS the error and returns
 * {@link SUPERSEDED} (the caller bails, touching nothing — the superseder owns the state); if STILL
 * CURRENT it RE-THROWS (a genuine failure for THIS login the caller must surface). On success it
 * returns the derived session (the post-read currency re-check stays at the call site, gating the
 * authoritative arm + publish).
 */
export async function readSessionFenced(deps: {
  readProfile: () => Promise<Awaited<ReturnType<typeof readProfile>>>;
  deriveSession: (profile: Awaited<ReturnType<typeof readProfile>>) => DerivedSession;
  stillCurrent: () => boolean;
}): Promise<DerivedSession | typeof SUPERSEDED> {
  try {
    const me = await deps.readProfile();
    return deps.deriveSession(me);
  } catch (e) {
    // SUPERSEDED during a REJECTING profile read → swallow + signal bail; the caller's catch must
    // not reset/clear the superseding login's state. STILL CURRENT → a genuine failure; re-throw.
    if (!deps.stillCurrent()) return SUPERSEDED;
    throw e;
  }
}

/**
 * The FENCED post-login remembered-POINTER reconciliation, extracted as a pure, injectable
 * async function so the security-critical SUPERSEDE fences (roborev HIGH, back-ported from
 * pod-health becddf5) are unit-testable WITHOUT a React render / real provider — the same
 * extract-as-testable-flow pattern as {@link rememberedPointerAction} / {@link applySilentRestoreDecision}.
 *
 * It awaits the durable-credential presence, then writes/clears the credential-FREE
 * remembered-account pointer, re-checking `stillCurrent()` AFTER the await and BEFORE the
 * (synchronous) pointer side effect. A logout()/new login() racing the presence read supersedes
 * this establish; an unfenced pointer write/clear would clobber the WRONG account's pointer on
 * behalf of a stale login (clearing the NEW login's freshly-written pointer). On supersession this
 * BAILS without touching the pointer. A presence-read THROW falls back to a fenced pointer clear
 * (fail-closed: never leave a possibly-wrong pointer), still skipped when superseded.
 *
 * NO DURABLE-CREDENTIAL DELETE FROM HERE (roborev HIGH — the read-then-delete race). An earlier
 * revision forgot a stale PRIOR account's issuer-keyed durable credential here. But the
 * {@link SessionStore} contract is non-transactional (separate `get`/`delete`), so ANY conditional
 * "delete the slot iff it still belongs to the prior WebID" issued from this supersedable flow has
 * a TOCTOU window: a racing same-issuer NEW login could `put` its credential between our read and
 * delete, and the delete would clobber it. We therefore do NOT touch the durable store here at
 * all. The cross-account orphan it cleaned up is HARMLESS + fail-closed: the credential-free
 * pointer is already cleared/rewritten below (so nothing ever silently restores the orphan — it is
 * never POINTED at), the orphan is a DPoP-bound refresh token useless without its non-extractable
 * key, and it is forgotten RACE-FREELY at the proper points — `logout()` forgets the live issuer,
 * a same-account re-login OVERWRITES the single issuer-keyed slot, and a `webid-mismatch` restore
 * teardown forgets explicitly. (A truly atomic cross-account orphan delete needs a compare-and-
 * delete primitive on `@jeswr/solid-session-restore`'s store — a tracked follow-up, not a thing to
 * fake with a racy get+delete here.)
 *
 * Returns the pointer op it performed (for assertions) and whether it bailed because superseded.
 */
export async function applyFencedLoginPointer(args: {
  thisLogin: { webId: string; issuer: string | undefined };
  /** The durable-credential presence read (awaited — a supersede window). May throw. */
  readPresence: () => Promise<CredentialPresence | undefined>;
  writePointer: (webId: string, issuer: string) => void;
  clearPointer: () => void;
  /** Re-checked AFTER the await + BEFORE the pointer side effect; false ⇒ superseded ⇒ bail. */
  stillCurrent: () => boolean;
}): Promise<{ pointer: "write" | "clear" | "none"; superseded: boolean }> {
  try {
    const presence = await args.readPresence();
    // SUPERSEDE FENCE (roborev HIGH): bail WITHOUT any pointer side effect — the superseder owns
    // the pointer now (its own teardown/establish reconciles it).
    if (!args.stillCurrent()) return { pointer: "none", superseded: true };
    // Write THIS login's pointer iff a durable credential FOR THIS WebID is persisted; otherwise
    // clear any stale pointer (no broken-promise pointer survives). `rememberedPointerAction`
    // maps the tri-state presence to write/clear (a `"present"` credential ⇒ write).
    if (rememberedPointerAction(presence) === "write" && args.thisLogin.issuer !== undefined) {
      args.writePointer(args.thisLogin.webId, args.thisLogin.issuer);
      return { pointer: "write", superseded: false };
    }
    args.clearPointer();
    return { pointer: "clear", superseded: false };
  } catch {
    // A presence-read error must not block the login; on uncertainty DROP the pointer
    // (fail-closed) — but still FENCE the clear: if a logout/new-login superseded us during the
    // failed await, the pointer belongs to the superseder (clearing it would wipe the NEW login's).
    if (!args.stillCurrent()) return { pointer: "none", superseded: true };
    args.clearPointer();
    return { pointer: "clear", superseded: false };
  }
}

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
 * rather than retried forever). Otherwise delegate to the provider's tri-state read
 * (which returns `"unknown"` on a store-read error so a blip does not orphan it).
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
 * The collaborators {@link applySilentRestoreDecision} needs — injected so the
 * security-critical teardown/keep/drop side effects are unit-testable without a React
 * harness or a real provider/IndexedDB/profile fetch.
 */
export interface SilentRestoreDeps {
  /** Drops the provider's in-memory session + re-fences in-flight work (logout). */
  reset(): void;
  /** Drops the durable credential for an issuer (the orphaned wrong-WebID token). */
  forgetPersisted(issuer: URL): Promise<void>;
  /** The durable-credential presence for the remembered issuer (keep/drop matrix). */
  credentialPresence(issuer: string | undefined): Promise<CredentialPresence>;
  /** The credential-free pointer (write on confirmed restore / clear on teardown). */
  pointer: {
    write(webId: string, issuer: string): void;
    clear(): void;
  };
  /** Derive the app session for a restored WebID (profile read may degrade). */
  deriveSessionFor(webId: string, issuer: string): Promise<DerivedSession>;
}

/**
 * Apply a {@link SessionRestoreDecision} to the durable + in-memory + pointer state
 * and produce the {@link SilentRestoreOutcome} the effect renders. PURE over its
 * injected {@link SilentRestoreDeps} (no module globals), so the THREE
 * security-critical branches are exhaustively unit-testable:
 *  - `restored`       → pointer re-written, outcome `restored` (logged in);
 *  - `webid-mismatch` → FAIL-CLOSED teardown IN ORDER (reset() FIRST, THEN
 *                        forgetPersisted, THEN clear pointer) — the wrong-WebID
 *                        credential restoreSession already pinned+persisted one layer
 *                        down is fully removed; outcome `login`;
 *  - other `login`    → keep/drop the pointer per the pure shouldDropRememberedPointer
 *                        matrix + the tri-state presence (never wipe on a transient
 *                        blip / unreadable store); outcome `login`.
 * Never throws (the caller wraps it in a fail-closed catch anyway).
 */
export async function applySilentRestoreDecision(
  decision: SessionRestoreDecision,
  remembered: { webId: string; issuer?: string } | null,
  deps: SilentRestoreDeps,
): Promise<SilentRestoreOutcome> {
  if (decision.outcome !== "restored") {
    if (decision.reason === "webid-mismatch") {
      // restoreIssuer ALREADY pinned an in-memory session AND re-persisted a rotated
      // credential for the WRONG WebID before the last-active check failed it. Tear it
      // down IN ORDER: reset() FIRST (drop the pin + re-fence so no patched fetch can
      // upgrade as the wrong WebID during the awaited delete), THEN forget the durable
      // credential, THEN clear the pointer.
      const issuer = parseIssuer(remembered?.issuer);
      deps.reset();
      if (issuer) await deps.forgetPersisted(issuer);
      deps.pointer.clear();
      return { kind: "login" };
    }
    // Otherwise fall back to login; keep/drop the pointer per the PURE matrix driven by
    // the reason + (for restore-failed) whether the durable credential survived.
    const credential = await deps.credentialPresence(remembered?.issuer);
    if (shouldDropRememberedPointer(decision.reason, credential)) deps.pointer.clear();
    return { kind: "login" };
  }
  // RESTORED: the provider rebuilt + pinned a live session. Derive the app session
  // (profile read may degrade to a WebID-origin fallback), re-confirm the pointer.
  const session = await deps.deriveSessionFor(decision.webId, decision.issuer);
  deps.pointer.write(decision.webId, decision.issuer);
  return { kind: "restored", webId: decision.webId, session };
}

/**
 * Arm the proactive credential boundary for a restored session — provisional (WebID +
 * issuer) BEFORE a read, then authoritative (adding the pod root) once derived. Injected
 * into {@link runSilentRestore} by the SessionProvider effect (task #123); `undefined` in
 * the unit harness (no fetch patch → nothing to arm), so the security-critical decision
 * stays testable without a React/patch harness.
 */
export type ArmProactiveBoundary = (input: {
  webId: string;
  issuer?: string;
  podRoot?: string;
}) => void;

/**
 * Whether THIS `establishSessionFor` is STILL the current login by the time it is ready to
 * (re-)arm the AUTHORITATIVE proactive boundary + publish the logged-in UI (roborev HIGH,
 * back-ported from pod-health becddf5). Pure + exported so the race is unit-testable WITHOUT
 * a React render / auth runtime (the same testable-decision pattern as
 * `rememberedPointerAction` / `single-flight`).
 *
 * `establishSessionFor` awaits several steps (`readProfile`, `hasPersistedForWebId`) after
 * snapshotting its generation. A logout()/new login() racing those awaits advances the
 * provider generation (via reset()) AND clears the boundary (logout) / arms its OWN (a new
 * login). If we re-armed + published UNCONDITIONALLY we would re-enable authenticated fetches
 * against a reset/stale provider behind a logged-out UI AND publish a stale webId/session — or
 * clobber a NEWER login's freshly-armed boundary. Returns true ONLY when the live generation
 * still equals the snapshot AND the provider's authenticated WebID still equals the requested
 * identity — fail-closed (false) on either mismatch, so the caller BAILS (it does NOT clear the
 * boundary on the superseded path: whoever superseded us — a logout that cleared it, or a new
 * login that armed its own — owns it now, so touching it here would strand them).
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
 * Whether the provider's login generation has ADVANCED past the owning flow's snapshot — i.e. a
 * logout()/new login() has superseded this establish (roborev HIGH). Pure + exported. Used at the
 * FIRST identity guard of `establishSessionFor`, where the WebID-arm of {@link establishStillCurrent}
 * cannot be used (it would always fail on the very mismatch being triaged): a GENERATION advance is
 * the unambiguous supersede signal, distinguishing "a racing logout/new-login changed the identity"
 * (bail silently) from "the OP genuinely authenticated a different WebID for THIS login" (throw).
 * Fail-OPEN to "not superseded" when the live generation is unreadable (undefined) so a genuine
 * mismatch is never silently swallowed.
 */
export function establishGenerationSuperseded(
  establishGeneration: number,
  currentGeneration: number | undefined,
): boolean {
  if (currentGeneration === undefined) return false;
  return currentGeneration !== establishGeneration;
}

/**
 * The explicit OUTCOME of `establishSessionFor` (roborev Medium). A silent `return` on
 * supersession must NOT be mistaken by the caller for a SUCCESS — `login()`'s contract is
 * "resolves when authenticated", and a superseded establish published NO session for this login.
 * The caller (doLogin) inspects this to skip the destructive reset/clear (the superseder owns the
 * state) WITHOUT reporting success:
 *  - `"established"` — the session for THIS login was armed + published; login truly succeeded.
 *  - `"superseded"`  — a racing logout/new-login won; nothing was published for this login. The
 *                       superseder owns the provider/boundary, so the caller must touch NOTHING.
 */
export type EstablishOutcome = "established" | "superseded";

/**
 * A BRANDED error thrown by `doLogin` when its `establishSessionFor` returned `"superseded"`
 * (roborev Medium). It signals "this login was CANCELLED by a racing logout/new-login — it did
 * NOT authenticate, but its failure is NOT a real error and the superseder owns the provider +
 * boundary". `login()` still REJECTS with it (honouring "resolves only when authenticated"), but
 * `doLogin`'s catch recognises it and SKIPS the destructive reset()/clearProactiveBoundary (which
 * would clobber the superseding flow's freshly-armed state) and the user-facing error surface.
 */
export class SupersededLoginError extends Error {
  readonly superseded = true as const;
  constructor() {
    super("Login was superseded by a newer sign-in or sign-out.");
    this.name = "SupersededLoginError";
  }
}

/**
 * Run the ONE silent restore (a refresh-token grant via the provider, then derive
 * the app session), memoised on {@link silentRestorePromise} so a StrictMode remount
 * reuses it. Delegates the decision side effects to the unit-tested
 * {@link applySilentRestoreDecision}. Never throws (fail-closed to `login`).
 *
 * PROACTIVE FETCH (task #123): `armBoundary` (injected by the effect) is called inside
 * `deriveSessionFor` — provisionally (WebID + issuer) BEFORE the cosmetic profile read so
 * THAT read carries the token, then authoritatively (adding the resolved pod root) so the
 * FIRST post-restore data read (the ledger-discovery chain) is pre-authenticated. Without
 * it a restored session's reads would all be UNAUTHENTICATED and pay the 401-dance.
 */
function runSilentRestore(
  provider: WebIdDPoPTokenProvider,
  armBoundary?: ArmProactiveBoundary,
): Promise<SilentRestoreOutcome> {
  if (silentRestorePromise) return silentRestorePromise;
  silentRestorePromise = (async (): Promise<SilentRestoreOutcome> => {
    const remembered = rememberedAccount.read();
    const decision = await decideSilentRestore({
      lastActiveWebId: remembered?.webId,
      remembered: remembered ? [remembered] : [],
      // The one fetch: a refresh-token grant for the remembered issuer. Never throws
      // for the expired/revoked case (the provider returns undefined and clears the
      // dead entry); a thrown error is treated as "login" (fail-closed).
      restoreIssuer: async (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual,
    });
    return applySilentRestoreDecision(decision, remembered, {
      reset: () => provider.reset(),
      forgetPersisted: (issuer) => provider.forgetPersisted(issuer),
      credentialPresence: (issuer) => credentialPresenceFor(provider, issuer),
      pointer: {
        write: (webId, issuer) => rememberedAccount.write(webId, issuer),
        clear: () => rememberedAccount.clear(),
      },
      // A RESTORED token means logged-in even if the cosmetic profile read degrades:
      // read the (now authenticated) profile to derive pod root / display name, else
      // fall back to a WebID-origin-derived session rather than bouncing a fully-
      // restored user to login on a transient profile blip.
      deriveSessionFor: async (webId, issuer) => {
        // PROACTIVE FETCH (task #123): arm a PROVISIONAL boundary (WebID + issuer) so the
        // (now-authenticated) cosmetic profile read carries the token.
        armBoundary?.({ webId, issuer });
        try {
          const derived = deriveSession(await readProfile(webId));
          // Re-arm AUTHORITATIVELY now the pod root is known, so the first post-restore
          // data read (the ledger-discovery chain) is pre-authenticated.
          armBoundary?.({ webId, issuer, podRoot: derived.podRoot });
          return derived;
        } catch {
          // Cosmetic profile read failed — keep the user logged in with a WebID-origin
          // session. The provisional WebID+issuer boundary already covers the WebID-origin
          // fallback pod root, so reads to it stay authenticated.
          return deriveSession({ webId, name: webId, storages: [], oidcIssuers: [issuer] });
        }
      },
    });
  })().catch(() => {
    // Any UNEXPECTED error in the restore wiring → fall back to login, fail-closed.
    // Deliberately do NOT clear the remembered pointer here: decideSilentRestore /
    // restoreIssuer / applySilentRestoreDecision don't throw for the normal outcomes
    // (handled above), so reaching here is a wiring fault — over-clearing a pointer
    // whose credential may still be valid would reintroduce the transient-wipe bug. A
    // kept pointer at worst costs one extra doomed restore next load, which re-clears.
    return { kind: "login" } as const;
  });
  return silentRestorePromise;
}

/**
 * Whether a silent restore is even worth attempting on THIS load — used to decide the
 * INITIAL `restoring` paint so the login form does not flash before the refresh-grant
 * runs. TRUE iff: a remembered account exists AND no autologin URL takes precedence
 * (no `#autologin/…` fragment, no pending redirect record, no `?code`/`?error`
 * redirect return). Cheap + synchronous (reads localStorage + the URL only) so it is
 * safe in a `useState` initialiser. Conservative: any unavailable storage → false
 * (→ login), never a hung "Restoring…".
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
        sessionStore: cfg.sessionStore,
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
  // Paint "Restoring…" from the FIRST render when a silent restore is worth trying,
  // so the login form never flashes before the refresh grant runs (computed once,
  // synchronously — reads localStorage + the URL only).
  const [restoring, setRestoring] = useState<boolean>(shouldAttemptSilentRestore);

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
    // Build the durable credential store ONCE, in the browser, behind the availability
    // guard (private mode / no IndexedDB → undefined → in-memory-only, no restore).
    if (sessionStoreSingleton === undefined && indexedDbAvailable()) {
      sessionStoreSingleton = new IndexedDbSessionStore({ dbName: SESSION_DB_NAME });
    }
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
      sessionStore: sessionStoreSingleton,
    })
      .then(({ provider, profileFetch, fetchInstall }) => {
        if (cancelled) return;
        providerRef.current = provider;
        profileFetchRef.current = profileFetch;
        fetchInstallRef.current = fetchInstall;
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        // The runtime never came up → there is no provider to restore through. Clear
        // the initial `restoring` paint (it was set true when a remembered pointer
        // existed) so the app shows the error/login UI instead of hanging forever on
        // "Restoring your session…" (roborev finding).
        setRestoring(false);
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
  // nothing" (no provider + empty allowed-origins). Called on logout and at the start of
  // an identity-switch login / autologin, so a request racing the teardown is fail-closed
  // at the gate (the patched global fetch leaves it unauthenticated). A no-op until the
  // runtime has installed the patch (fetchInstallRef set).
  const clearProactiveBoundary = useCallback(() => {
    fetchInstallRef.current?.setState({ provider: null, allowedOrigins: new Set() });
  }, []);

  // PROACTIVE FETCH (task #123): arm the live credential boundary so the patched global
  // fetch PROACTIVELY attaches the DPoP token to the session's pod / WebID / issuer
  // origins on the FIRST request (no per-resource 401-dance — pod-money's ledger-discovery
  // chain no longer pays a wasted 401 per distinct pod URL). The boundary is https-only
  // (http allowed only for a loopback host under the dev/test opt-in), so the token can
  // never ride cross-origin or over cleartext. `podRoot` is folded in once known (a pod on
  // a DIFFERENT host than the WebID is a valid Solid topology and MUST be listed); the
  // WebID + issuer origins are folded in by the seam's default. A no-op until the runtime
  // installed the patch.
  const armProactiveBoundary = useCallback(
    (input: { webId: string; issuer?: string; podRoot?: string }) => {
      fetchInstallRef.current?.setState({
        provider: providerRef.current,
        allowedOrigins: deriveProactiveAllowedOrigins({
          ...(input.podRoot !== undefined ? { podRoot: input.podRoot } : {}),
          webId: input.webId,
          ...(input.issuer !== undefined ? { issuer: input.issuer } : {}),
          allowInsecureLoopback: allowInsecureLoopbackRef.current,
        }),
      });
    },
    [],
  );

  // ── SILENT SESSION RESTORE mount effect (closed-tab reopen) ──────────────────
  //
  // Runs ONCE the runtime is `ready`, before the app settles on "logged out". An
  // explicit autologin (a `#autologin/…` deep-link, a pending redirect, or a
  // `?code`/`?error` redirect return) OUTRANKS silent restore — `shouldAttemptSilent
  // Restore` returns false in those cases, so the autologin effect owns the flow and
  // this one stays inert (the `restoring` paint was likewise false from first render).
  // It is single-flighted at module level (`runSilentRestore`), so a StrictMode
  // double-mount runs the refresh grant exactly once and both mounts apply the one
  // outcome. A restored session wins; any other outcome falls back to login (and the
  // pure decision already cleared/kept the durable credential + pointer fail-closed).
  useEffect(() => {
    if (!ready) return;
    const provider = providerRef.current;
    // Already logged in, no provider, or no restore worth attempting → nothing to do.
    if (!provider || webId !== null || !shouldAttemptSilentRestore()) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    setRestoring(true);
    setError(null);
    // PROACTIVE FETCH (task #123): the silent-restore path NEVER runs the login flow's
    // pre-probe arming, so the boundary is still empty when restore's cosmetic profile
    // read + the post-restore data reads fire. Inject `armProactiveBoundary` so
    // runSilentRestore arms the boundary (provisional WebID+issuer before the profile
    // read, authoritative pod-root after) — without it a restored session's first reads
    // would all be UNAUTHENTICATED and the restored user would face the 401-dance the
    // proactive patch exists to kill. A `login` outcome arms nothing (stays public).
    runSilentRestore(provider, armProactiveBoundary)
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.kind === "restored") {
          setWebId(outcome.webId);
          setSession(outcome.session);
        }
        // `login` outcome: leave webId null; the LoginScreen shows once restoring clears.
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // `webId` is a dep so a logout (webId→null) does not re-trigger a restore: the
    // memoised promise is reset on logout AND `shouldAttemptSilentRestore` is false
    // once the pointer is cleared — so the guard above returns early.
  }, [ready, webId, armProactiveBoundary]);

  // The SHARED post-authentication step, used by BOTH the popup login (doLogin) and
  // the full-page-redirect autologin completion. By the time this runs the provider
  // has an established, token-attached session whose `authenticatedWebId` is the
  // identity the OP vouched for. We PROVE that matches the WebID the user asked to
  // log in as (never inferring "logged in" from a token being attached — the
  // Finding-1 invariant), then re-read the (now authenticated) profile and derive
  // the session into React state. Throws (fail-closed) on a WebID mismatch.
  const establishSessionFor = useCallback(
    async (id: string, expectedGeneration?: number): Promise<EstablishOutcome> => {
      // GENERATION FENCE (roborev HIGH, back-ported from pod-health becddf5). The OWNING FLOW
      // (doLogin / autologin-complete) snapshots its `loginGeneration()` right after its own
      // reset() and passes it as `expectedGeneration`. `establishSessionFor` is entered AFTER the
      // caller's awaits (the probe / completeRedirectLogin), so a logout()/new login() can ALREADY
      // have superseded this establish before the very first guard below — advancing the
      // generation (via reset()) and replacing `authenticatedWebId`. Snapshot the live generation
      // up front so the first identity guard can DISTINGUISH "superseded" from "the OP genuinely
      // authenticated a different WebID". Falls back to the live generation when the caller passes
      // none (defensive — then the first-guard supersede check is a no-op equality).
      const establishGeneration =
        expectedGeneration ?? providerRef.current?.loginGeneration() ?? -1;
      const authedWebId = providerRef.current?.authenticatedWebId();
      if (!webIdsEqual(authedWebId, id)) {
        // SUPERSEDE-vs-MISMATCH (roborev HIGH): if the generation has ALREADY advanced past the
        // owning flow's snapshot, a logout/new-login superseded us before entry — the identity no
        // longer matching `id` is EXPECTED, not a security failure. BAIL SILENTLY: throwing here
        // would reach the caller's catch (doLogin / autologin-complete) which reset()s the provider
        // + clears the proactive boundary, clobbering the SUPERSEDING flow's freshly-armed state.
        // The check is GENERATION-ONLY here (NOT establishStillCurrent, whose WebID arm would always
        // fail on this very mismatch path): a generation advance is the unambiguous supersede signal.
        // Only when the generation is UNCHANGED is a WebID mismatch a genuine "OP authenticated a
        // different WebID" security failure — then throw (fail-closed) as before.
        if (
          establishGenerationSuperseded(establishGeneration, providerRef.current?.loginGeneration())
        ) {
          return "superseded"; // touch nothing; the superseder owns the provider/boundary.
        }
        throw new Error(
          "Login did not complete — the identity provider authenticated a " +
            `different WebID (${authedWebId ?? "unknown"}) than the one requested ` +
            `(${id}). For your security you were not logged in.`,
        );
      }
      // PROACTIVE FETCH (task #123): arm a PROVISIONAL credential boundary (the WebID + the
      // resolved issuer origins) BEFORE the authenticated profile re-read below, so that read
      // actually carries the token. The AUTOLOGIN-completion path reaches here WITHOUT the
      // popup login's pre-probe arming, so without this the "now authenticated" profile
      // re-read would be UNAUTHENTICATED: a private profile would fail (or, for a WebID whose
      // storage lives on another origin, degrade to the wrong fallback pod root and restore a
      // wrong session shape). The pod-root boundary is the AUTHORITATIVE one re-armed once the
      // profile yields derived.podRoot (below). The popup-login path has already armed an
      // equivalent boundary via the probe; re-arming with the same origins is idempotent.
      // pod-money's provider exposes its issuer SYNCHRONOUSLY (resolvedIssuer(): string |
      // undefined — no async accessor as in pod-music), so no await is needed. It is
      // best-effort — the WebID origin is the load-bearing target for the profile re-read; the
      // OIDC endpoints ride the pristine fetch (the re-entrancy guard), so they do not depend
      // on this boundary.
      const provisionalIssuer = providerRef.current?.resolvedIssuer();
      // FENCE the PROVISIONAL arm too (roborev HIGH). Even though pod-money's `resolvedIssuer()`
      // is SYNC (no await inside this function before this point), `establishSessionFor` is
      // entered AFTER the CALLER's awaits (the autologin-completion / silent-restore paths await
      // a refresh grant before calling here), so a logout/new-login can already have superseded
      // this establish by the time it runs. Arming the provisional boundary unconditionally would
      // set origins for THIS (now-stale) WebID against the CURRENT provider — which, after a new
      // login, belongs to a DIFFERENT user (so the new user's token could ride the OLD user's
      // origin) or, after a logout, re-enable authenticated fetches behind a logged-out UI. If
      // superseded, BAIL without arming + without reading a stale profile (the superseder already
      // cleared / armed its own boundary — clearing here would wipe the newer login's).
      if (
        !establishStillCurrent({
          establishGeneration,
          currentGeneration: providerRef.current?.loginGeneration() ?? -1,
          requestedWebId: id,
          currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
          webIdsEqual,
        })
      ) {
        return "superseded";
      }
      armProactiveBoundary({ webId: id, issuer: provisionalIssuer });
      // Re-read the profile (now authenticated) and derive the session, with the FAILURE PATH
      // FENCED against supersession (roborev HIGH). A logout()/new login() can supersede this
      // establish WHILE `readProfile` is pending and that read can then REJECT; an unconditionally
      // propagated rejection would make the caller's catch (doLogin) reset() the provider + clear
      // the boundary — clobbering the SUPERSEDING login's freshly-armed state on the error path.
      // `readSessionFenced` swallows the error + returns SUPERSEDED when we've been superseded
      // (we BAIL, touching nothing), and re-throws only when the failure is still genuinely OURS.
      const readResult = await readSessionFenced({
        readProfile: () => readProfile(id),
        deriveSession,
        stillCurrent: () =>
          establishStillCurrent({
            establishGeneration,
            currentGeneration: providerRef.current?.loginGeneration() ?? -1,
            requestedWebId: id,
            currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
            webIdsEqual,
          }),
      });
      if (readResult === SUPERSEDED) return "superseded"; // superseder owns it — touch nothing.
      const derived = readResult;
      // GENERATION FENCE for the AUTHORITATIVE boundary-arm + UI publish (roborev HIGH). The
      // `await readProfile(id)` above (and the `hasPersistedForWebId` await below) give a
      // racing logout()/new login() a window: it advances the provider generation (via reset())
      // AND, for a logout, clears the boundary; a new login clears it then ARMS ITS OWN +
      // becomes the authenticated identity. Without re-checking, this function would resume and
      // (a) RE-ARM the authoritative boundary against a now-reset/stale provider — re-enabling
      // authenticated fetches behind a logged-out UI, or clobbering a newer login's boundary —
      // and (b) publish a STALE logged-in session (setWebId/setSession below). So before arming
      // the authoritative boundary + the persist/pointer reconciliation + publish, re-check BOTH
      // the generation and the authenticated WebID against this establish's snapshot. On the
      // SUPERSEDED path BAIL WITHOUT clearing the boundary — the superseding actor (a logout that
      // cleared it, a new login that armed its own) owns it now; clearing here would wipe the
      // newer login's freshly-armed boundary and strand its logged-in UI making unauthenticated
      // reads. We never armed the AUTHORITATIVE boundary on this resumed path (the provisional one
      // was superseded by the racer's own clear/arm), so there is nothing of OURS to tear down.
      if (
        !establishStillCurrent({
          establishGeneration,
          currentGeneration: providerRef.current?.loginGeneration() ?? -1,
          requestedWebId: id,
          currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
          webIdsEqual,
        })
      ) {
        return "superseded";
      }
      // PROACTIVE FETCH (task #123): now that the session's pod root is known, wire the
      // AUTHORITATIVE boundary so the patched global fetch PROACTIVELY attaches the DPoP token
      // to the pod / WebID / issuer origins on the FIRST request — pod-money's ledger-discovery
      // chain (profile re-read → MoneyStore.discover → ledger GET) no longer pays a wasted 401
      // per distinct pod URL. Armed BEFORE publishing the logged-in UI (setWebId/setSession
      // below) so the first library read is authenticated.
      armProactiveBoundary({ webId: id, issuer: provisionalIssuer, podRoot: derived.podRoot });
      // B7P ORDERING (task #91 / #123): pod-money's provider PERSISTS the DPoP-bound refresh
      // credential to durable storage INTERNALLY during `upgrade()`/`#authenticate()` (the
      // login probe's upgrade, which runs in doLogin BEFORE this function) — not via a
      // SessionProvider-driven persistSession() as in pod-music. So by the time we reach here
      // the credential is already durably written, and the remembered-account POINTER is
      // written below BEFORE the logged-in UI is published (setWebId/setSession). A tab-close
      // racing this step therefore can never leave a PUBLISHED-but-UNPERSISTED session.
      // REMEMBER this account (WebID + the issuer it authenticated against) so a later
      // page load can attempt a silent refresh-token restore — but ONLY when the
      // provider actually has a durable credential FOR THIS WebID to restore from
      // (roborev finding): a remembered pointer with no matching persisted refresh token
      // is a broken promise (the user "should" silently restore but cannot), and — since
      // the store is keyed by ISSUER — a credential left by a PRIOR account on the SAME
      // issuer must NOT be mis-claimed for this login. The popup login persists when the
      // server granted offline_access; the autologin REDIRECT path mints an extractable
      // key it deliberately does NOT persist, so it leaves no durable credential — and
      // must therefore NOT write a pointer. Gate the WRITE on
      // hasPersistedForWebId === "present" (a durable credential exists AND belongs to
      // THIS WebID).
      //
      // CRUCIAL (roborev HIGH): when we are NOT writing a pointer for THIS login (no
      // matching durable credential), we must also CLEAR any EXISTING pointer — else a
      // STALE pointer from a PRIOR account (e.g. Alice, whose restore transiently failed
      // so her pointer was kept) survives a login as a DIFFERENT WebID (Bob) that has no
      // durable credential, and the NEXT reload would silently restore ALICE instead of
      // Bob. So: write Bob's pointer on "present", otherwise drop whatever pointer exists.
      //
      // We do NOT forget a stale PRIOR account's DURABLE credential from here (roborev HIGH —
      // the read-then-delete race). The SessionStore contract is non-transactional, so a
      // conditional issuer-keyed delete issued from this supersedable flow has a TOCTOU window
      // that could clobber a racing same-issuer NEW login's just-persisted credential. The orphan
      // is harmless + fail-closed (never POINTED at — the pointer is cleared/rewritten below) and
      // is forgotten RACE-FREELY at logout / same-account re-login / webid-mismatch restore. See
      // applyFencedLoginPointer's doc for the full reasoning + the atomic-CAS follow-up.
      // Best-effort; never blocks landing the (already-established) session.
      const issuer = providerRef.current?.resolvedIssuer();
      // A local re-check of THIS establish's currency, used to fence the pointer SIDE EFFECT
      // below (roborev HIGH). The reconciliation awaits `hasPersistedForWebId`, and a
      // logout()/new login() racing that await supersedes this establish — an unfenced pointer
      // write/clear would then clobber the WRONG account's pointer. The fenced, EXTRACTED
      // `applyFencedLoginPointer` re-checks AFTER the await + BEFORE the side effect and bails
      // when superseded.
      const stillCurrent = () =>
        establishStillCurrent({
          establishGeneration,
          currentGeneration: providerRef.current?.loginGeneration() ?? -1,
          requestedWebId: id,
          currentAuthenticatedWebId: providerRef.current?.authenticatedWebId(),
          webIdsEqual,
        });
      await applyFencedLoginPointer({
        thisLogin: { webId: id, issuer },
        readPresence: () =>
          issuer
            ? (providerRef.current?.hasPersistedForWebId(new URL(issuer), id) ??
              Promise.resolve("absent" as const))
            : Promise.resolve("absent" as const),
        writePointer: (webId, iss) => rememberedAccount.write(webId, iss),
        clearPointer: () => rememberedAccount.clear(),
        stillCurrent,
      });
      // GENERATION FENCE for the UI PUBLISH (roborev HIGH). The pointer-reconciliation block
      // above awaits AGAIN (`hasPersistedForWebId`), opening one more window in which a
      // logout()/new login() can supersede this establish. Re-check before publishing so a
      // superseded establish never flips the React UI to a STALE logged-in webId/session (which a
      // logout had just cleared, or a new login had just replaced). On the SUPERSEDED path BAIL
      // WITHOUT touching the boundary — the superseder owns it (see the authoritative arm fence
      // above) — and (per the fenced pointer side effect above) without touching the pointer
      // either. The load-bearing guard is not republishing a stale SESSION behind a logged-out /
      // different-user UI.
      if (!stillCurrent()) return "superseded";
      setWebId(id);
      setSession(derived);
      return "established";
    },
    [armProactiveBoundary],
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
        // proactive patch only calls `upgrade()` for an ALLOWED origin, so we must admit the
        // probe's origin BEFORE fetching it — otherwise the probe is left unauthenticated,
        // the popup never opens, and login can never complete. We arm from the PUBLIC profile
        // we just read (the WebID + its advertised storages); the issuer is folded in once
        // resolved. establishSessionFor RE-arms the authoritative boundary post-login; the
        // catch below clears it on failure. Without this the proactive swap would break
        // interactive login (caught by the e2e).
        armProactiveBoundary({ webId: id, podRoot: pub.storages[0] });
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
        // Pass THIS login's generation snapshot so establishSessionFor's first identity guard
        // can tell a racing-logout/new-login supersede (silent bail) from a genuine OP mismatch.
        const outcome = await establishSessionFor(id, loginGeneration);
        // SUPERSEDED (roborev Medium): establishSessionFor published NO session for THIS login (a
        // racing logout/new-login won + owns the provider + boundary). We must NOT resolve `login()`
        // as success — its contract is "resolves only when authenticated" — so throw a BRANDED
        // SupersededLoginError. The catch below recognises it and SKIPS the destructive reset/clear
        // (which would clobber the superseder) + the user-facing error surface.
        if (outcome === "superseded") throw new SupersededLoginError();
      } catch (e) {
        // The attempt failed — clear the pending WebID AND drop any partial provider state, so a
        // half-established session can't leak into the next attempt. BUT if we were SUPERSEDED (a
        // branded SupersededLoginError), the superseding flow OWNS the provider + boundary: running
        // reset()/clearProactiveBoundary here would clobber its freshly-armed state, and there is
        // no user-facing error to show. So skip the destructive cleanup + the error surface and
        // just propagate so `login()` rejects (it was not authenticated).
        if (e instanceof SupersededLoginError) {
          // Touch NOTHING — the superseder owns pendingWebIdHolder (it set its own), the provider,
          // and the boundary. Just propagate so `login()` rejects (this login was not authenticated).
          throw e;
        }
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
    [establishSessionFor, armProactiveBoundary, clearProactiveBoundary],
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
    // Capture the issuer to forget BEFORE reset() (which clears resolvedIssuer) —
    // prefer the provider's resolved issuer, falling back to the remembered pointer
    // (so a logout without an active in-memory session still wipes the durable one).
    const issuer =
      parseIssuer(providerRef.current?.resolvedIssuer()) ??
      parseIssuer(rememberedAccount.read()?.issuer);
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
    // SIGN-OUT MUST drop the DURABLE credential + the remembered pointer too —
    // otherwise the signed-out account would be silently REVIVED by the silent restore
    // on the next load (reset() only clears IN-MEMORY state). forgetPersisted is async
    // and best-effort; clear the pointer synchronously so this load is immediately
    // logged-out. Also drop the page-lifetime restore memo so a restore already in
    // flight cannot re-land this just-cleared account.
    silentRestorePromise = null;
    rememberedAccount.clear();
    if (issuer) void providerRef.current?.forgetPersisted(issuer);
    setWebId(null);
    setSession(null);
    setRestoring(false);
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
      clearProactiveBoundary(); // task #123: never leave the fetch authenticating.
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
          // Snapshot the generation NOW (the redirect login just established the session) so
          // establishSessionFor's first identity guard can distinguish a racing-logout/new-login
          // supersede (silent bail) from a genuine OP mismatch — same as the doLogin path.
          const outcome = await establishSessionFor(id, provider.loginGeneration());
          // SUPERSEDED: a racing logout/new-login owns the flow now — DON'T clear the sentinel (the
          // superseder may still need it) and don't treat this as a completed autologin.
          if (outcome === "established") clearAutologinSentinel(); // success → clean slate.
        })
        .catch((e) => {
          // Failure: drop any persisted record + the sentinel, fall back to the login
          // screen. Do NOT loop, do NOT spew — surface a single error.
          provider.reset(); // clears the persisted record too; leaves reset-clean.
          clearProactiveBoundary(); // task #123: never leave the fetch authenticating.
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
    clearProactiveBoundary(); // task #123: identity switch — drop the prior boundary.
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
        clearProactiveBoundary(); // task #123: never leave the fetch authenticating.
        setAutologinPending(false);
        setError(e instanceof Error ? e.message : String(e));
      });
    // `webId` is a dep so a logout (webId→null) does NOT re-trigger autologin — the
    // once-guard and the cleaned URL (no fragment / no code) keep it inert after the
    // first pass.
  }, [ready, webId, establishSessionFor, clearProactiveBoundary]);

  const value = useMemo<SessionContextValue>(
    () => ({
      webId,
      session,
      loggingIn,
      autologinPending,
      restoring,
      error,
      ready,
      login,
      logout,
    }),
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
