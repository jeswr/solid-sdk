/**
 * webid-token-provider.ts — a custom @solid/reactive-authentication `TokenProvider`
 * whose OIDC issuer is resolved from the user's WebID profile (via callbacks),
 * instead of the published `DPoPTokenProvider`'s hard-coded host map.
 *
 * Ported from the published `DPoPTokenProvider` (v0.1.2), preserving its
 * authorization-code + PKCE + DPoP flow and its `prompt=none` silent-retry
 * behaviour. The ONE structural change: `#resolveIssuer()` dereferences the
 * WebID and reads `solid:oidcIssuer`, then asks `chooseIssuer` when several are
 * advertised — never silently the first.
 *
 * APP-SPECIFIC divergence (candidate for upstream): {@link WebIdDPoPTokenProvider.login}
 * goes INTERACTIVE-FIRST by default. An app-initiated login is explicit user
 * intent with (usually) no IdP session, so the upstream silent-first pattern
 * (PR #13) makes the user watch the popup bounce authorize →
 * callback.html?error=login_required → authorize before the login page.
 * Background paths (401 upgrade/renewal) keep silent-first: there the IdP
 * cookie usually lives and `prompt=none` succeeds without bothering the user.
 *
 * A second APP-SPECIFIC divergence (also a candidate for upstream):
 * {@link WebIdDPoPTokenProvider.canRenewWithoutInteraction} — a SYNCHRONOUS
 * probe the click handler consults BEFORE `window.open`, so no popup flashes
 * open when a cached session (or its refresh token) can complete the login
 * with fetches alone.
 *
 * Two app-supplied callbacks drive identity:
 *  - `getWebId()`   — how the app states whose WebID a 401-upgrade is for
 *                     (the Pod Manager seeds it from its login/restore state).
 *  - `getCode(uri)` — drives the user through the authorization endpoint
 *                     (the app-owned popup in `src/lib/popup-login.ts`).
 *
 * App-initiated logins with a KNOWN issuer (provider picker, bare-issuer
 * input) skip both via {@link WebIdDPoPTokenProvider.login}.
 *
 * `allowInsecureLoopback` is what makes LOCAL CSS work: it flips oauth4webapi's
 * `allowInsecureRequests` ONLY for `localhost`/`127.0.0.1` issuers, so the HTTP
 * issuer of a dev CSS is accepted while remote HTTPS issuers stay strict.
 */
import * as oauth from "oauth4webapi";
import * as DPoP from "dpop";
import type { GetCodeCallback } from "@solid/reactive-authentication";
import { freshRdf } from "./rdf-read.js";
import { resolveIssuers, validateWebId } from "./login-ux.js";
import type { PersistedSession, SessionStore } from "./session-persistence.js";

/**
 * The library's TokenProvider interface. @solid/reactive-authentication 0.1.2
 * does NOT re-export the `TokenProvider` type from its package entrypoint (only
 * the concrete providers), so we restate the (tiny, stable) structural contract
 * here. `ReactiveFetchManager` accepts any `Iterable<TokenProvider>`, and
 * matches structurally — this is the exact shape from the package's
 * `TokenProvider.d.ts`.
 */
export interface TokenProvider {
  matches(request: Request): Promise<boolean>;
  upgrade(request: Request): Promise<Request>;
  /**
   * Optional (upstream PR #14): called by `ReactiveFetchManager` when a request
   * this provider upgraded was STILL rejected with 401, so cached credentials
   * can be marked stale before the manager's single retry.
   */
  invalidate?(request: Request): Promise<void>;
}

/** Ask the user for their WebID. Resolves to the WebID string, or rejects/cancels. */
export type GetWebIdCallback = () => Promise<string>;

/**
 * Choose one issuer from several advertised on the profile. The default policy
 * is: a single issuer is used directly; more than one is an error (no callback =
 * no UI to choose, and silently picking the first is wrong). Apps that surface a
 * picker pass their own `chooseIssuer`.
 */
export type ChooseIssuerCallback = (issuers: string[]) => Promise<string>;

export interface WebIdDPoPTokenProviderOptions {
  /**
   * A **Solid-OIDC Client Identifier Document** URL. When set, the provider
   * SKIPS dynamic client registration and authenticates as a public client whose
   * `client_id` IS this URL (the spec's "Client Identifier" — a dereferenceable
   * JSON-LD document; see https://solidproject.org/TR/oidc#clientids). The OP
   * dereferences the URL and matches the redirect_uri against the document's
   * `redirect_uris`, so the document MUST list the {@link callbackUri} passed to
   * the constructor. With `none` token-endpoint auth (a public browser client),
   * no client secret is involved.
   *
   * The URL string MUST equal the document's `client_id` field byte-for-byte;
   * a trailing-slash or scheme/port mismatch makes the OP reject it.
   *
   * When ABSENT (default), the provider falls back to **dynamic client
   * registration** — convenient for local dev, but yields a throwaway client
   * with no stable name on the consent screen.
   */
  clientId?: string;
  /**
   * Pick one issuer when the profile advertises several. Defaults to a policy
   * that throws on ambiguity (see {@link AmbiguousIssuerError}). It is always
   * called with ≥ 1 issuer; with exactly one, the default returns it.
   */
  chooseIssuer?: ChooseIssuerCallback;
  /**
   * Enable oauth4webapi's `allowInsecureRequests` for `localhost` / `127.0.0.1`
   * issuers only (dev CSS over HTTP). Remote HTTPS issuers are unaffected, and
   * non-loopback HTTP issuers are never allowed. Default `false`.
   */
  allowInsecureLoopback?: boolean;
  /**
   * Override the fetch used to dereference the public WebID profile. Defaults to
   * the `globalThis.fetch` captured at CONSTRUCTION time (before
   * {@link https://github.com/solid-contrib/reactive-authentication ReactiveFetchManager}
   * patches the global) — see the recursion note in the class docs. Test-only.
   */
  profileFetch?: typeof fetch;
  /**
   * Durable store for the DPoP-bound refresh-token session (see
   * {@link ./session-persistence.ts}). When supplied, a successful login/refresh
   * PERSISTS its rotated refresh token + DPoP key, and {@link
   * WebIdDPoPTokenProvider.attemptRestore} can rebuild a returning user's session
   * via a `refresh_token` grant — a token-endpoint FETCH, no popup/iframe.
   * Absent (default): tokens stay in-memory only, the original behaviour.
   */
  sessionStore?: SessionStore;
  /**
   * Enable PROACTIVE background refresh: when a session carries `expires_in`,
   * schedule a refresh-token grant at a safe fraction of the lifetime (see
   * {@link proactiveRefreshAt}) so the cached session stays continuously fresh
   * and `upgrade()`/`fetch` never hits an expired token mid-flow. Off by default
   * — the lazy renew-on-401 / renew-on-expiry paths remain the only triggers.
   *
   * N/A without a refresh token (the server issued none): nothing is scheduled,
   * the lazy path stays in charge.
   */
  proactiveRefresh?: boolean;
  /**
   * Page-lifecycle surface for proactive scheduling (visibility + focus). Only
   * consulted when {@link proactiveRefresh} is on. Defaults to
   * {@link domVisibilityLifecycle} in a browser, and to a no-op (always-visible,
   * no events) under SSR/node — where there are no timers to leak anyway.
   * Injectable for tests.
   */
  visibilityLifecycle?: VisibilityLifecycle;
  /**
   * Timer surface for proactive scheduling. Defaults to `globalThis.setTimeout`/
   * `clearTimeout`. Injectable so tests can drive it with vitest fake timers
   * (which patch the globals — this just captures them) or a manual double.
   * @internal
   */
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Observe completion after refresh, persistence and scheduler cleanup have settled. */
  onProactiveRefreshSettled?: (issuer: URL, outcome: "refreshed" | "forgotten" | "failed") => void;
}

/** A {@link VisibilityLifecycle} that reports always-visible and never fires (SSR/node). */
const noopVisibilityLifecycle: VisibilityLifecycle = {
  isVisible: () => true,
  onResume: () => () => {},
  onHide: () => () => {},
};

/** A WebID advertises several issuers but no `chooseIssuer` was supplied. */
export class AmbiguousIssuerError extends Error {
  readonly webId: string;
  readonly issuers: string[];
  constructor(webId: string, issuers: string[]) {
    super(
      `This WebID advertises ${issuers.length} OIDC issuers — the app must supply ` +
        `a 'chooseIssuer' callback so the user can pick one (${webId}).`,
    );
    this.name = "AmbiguousIssuerError";
    this.webId = webId;
    this.issuers = issuers;
  }
}

/**
 * An in-flight login/refresh/restore settled AFTER its issuer was forgotten
 * (logout, or an account switch on the same issuer). Its result is discarded:
 * never cached, persisted or rescheduled, so a logged-out credential cannot be
 * revived by work that started before the logout.
 */
export class IssuerForgottenError extends Error {
  constructor(issuer: string) {
    super(`The session for ${issuer} was signed out while it was being established.`);
    this.name = "IssuerForgottenError";
  }
}

/** Background authentication requires a known, unchanged account. */
export class SessionIdentityChangedError extends Error {
  constructor(issuer: string) {
    super(`Sign in explicitly to establish or confirm your account at ${issuer}.`);
    this.name = "SessionIdentityChangedError";
  }
}

/** The default issuer policy: single → it; several → throw (never pick silently). */
function defaultChooseIssuer(webId: string): ChooseIssuerCallback {
  return async (issuers: string[]) => {
    if (issuers.length === 1) return issuers[0];
    throw new AmbiguousIssuerError(webId, issuers);
  };
}

/** Per-issuer session state cached so repeat upgrades don't re-prompt. */
interface IssuerSession {
  authorizationServer: oauth.AuthorizationServer;
  clientRegistration: oauth.Client;
  dpopKey: CryptoKeyPair;
  /**
   * The oauth4webapi DPoP handle for token-endpoint requests. Reused for the
   * refresh grant so refreshed access tokens stay bound to the same key
   * (RFC 9449 §4.3) and server-provided DPoP nonces are remembered.
   */
  dpopHandle: oauth.DPoPHandle;
  accessToken: string;
  /**
   * The refresh token (RFC 6749 §6), when the server issued one. Replaced in
   * the renewed session whenever the server rotates it (RFC 9700 §4.14.2).
   */
  refreshToken: string | undefined;
  /**
   * Epoch ms after which the access token counts as expired (server-reported
   * `expires_in` minus a skew allowance), or undefined when none was reported.
   *
   * MIRRORS upstream reactive-authentication PR #11/#12 (session cache +
   * refresh tokens in `DPoPTokenProvider`) — delete this port when a release
   * containing them is published and this app moves back to the upstream
   * provider plus a `GetIssuerCallback`.
   */
  expiresAt: number | undefined;
  /**
   * The authenticated WebID, from the ID token's `webid` claim (Solid-OIDC
   * §5; `sub` accepted as a fallback when it is an http(s) URL, the NSS
   * convention). What lets an ISSUER-FIRST login (the user picked a provider,
   * no WebID typed) learn who just signed in. `undefined` when the ID token
   * carries neither.
   */
  webId: string | undefined;
}

/** Per-issuer proactive-refresh scheduler bookkeeping. */
interface IssuerScheduler {
  /** The pending refresh timer, or undefined when none is armed (hidden tab). */
  timer?: ReturnType<typeof setTimeout>;
  /** Consecutive transient-failure retries already spent for the current cycle. */
  retries: number;
  /**
   * The scheduled-for instant (epoch ms) the armed `timer` targets — so a
   * visibility resume can decide whether to refresh-now vs let the timer run.
   */
  fireAt?: number;
}

/**
 * Whether a code flow tries `prompt=none` before the interactive request.
 *
 * - `"silent-first"` — the upstream PR #13 pattern: try `prompt=none`; on
 *   `login_required` / `interaction_required` / `consent_required` retry
 *   interactively in the same popup. Right for BACKGROUND re-auth (the 401
 *   upgrade/renewal path), where the IdP cookie usually lives and the user
 *   should not see a login page they don't need.
 * - `"interactive"` — skip the doomed silent attempt and navigate the popup
 *   straight to the interactive authorize URL (still `prompt=consent` when
 *   opting into offline_access, OIDC Core §11). Right for EXPLICIT
 *   user-initiated logins, where there is (almost always) no IdP session and
 *   the silent hop is just a visible callback.html flash before the login page.
 */
type AuthorizeMode = "silent-first" | "interactive";

export interface LoginOptions {
  /**
   * Try `prompt=none` before the interactive request. Default `false`:
   * an app-initiated {@link WebIdDPoPTokenProvider.login} is explicit user
   * intent, so the popup goes straight to the login page. Pass `true` for
   * one-click re-login surfaces (e.g. a recent-account chip) where a live IdP
   * session is likely and silent success means zero typing.
   */
  silentFirst?: boolean;
  /**
   * The WebID the user asked to sign in as, when the app knows it (a typed
   * WebID or a recent-account chip). A cached session for the same issuer that
   * belongs to a DIFFERENT WebID is discarded and the code flow runs, so an
   * account switch never silently reuses the previous account's tokens.
   */
  expectedWebId?: string;
}

/** Refresh this much before the reported expiry to absorb clock skew. */
const EXPIRY_SKEW_MS = 30_000;

function expiresAt(token: oauth.TokenEndpointResponse): number | undefined {
  return token.expires_in === undefined
    ? undefined
    : Date.now() + token.expires_in * 1000 - EXPIRY_SKEW_MS;
}

function hasExpired(session: IssuerSession): boolean {
  return session.expiresAt !== undefined && Date.now() >= session.expiresAt;
}

// ── Proactive-refresh scheduling policy ──────────────────────────────────────
//
// The lazy paths (upgrade()-on-expiry and renew-on-rejected-token) only renew
// AFTER a token is already stale, so a long import or an idle→active session
// can hit a momentary expired-token request before the lazy renewal completes.
// Proactive refresh keeps the cached session continuously fresh by running the
// refresh grant in the background BEFORE expiry.
//
// MIRRORS-CANDIDATE: this whole block is a strong upstream addition to
// reactive-authentication's DPoPTokenProvider (alongside the PR #11/#12 session
// cache + refresh tokens it builds on). Keep these comments when porting.

/**
 * Refresh at most this long before the (skew-adjusted) expiry, even for very
 * long-lived tokens — a multi-hour token still refreshes within a bounded
 * window of expiry rather than hours early (pointless churn).
 */
const PROACTIVE_MAX_LEAD_MS = 5 * 60_000;
/**
 * Refresh at least this long before expiry, even for very short-lived tokens,
 * so the grant's own round-trip completes with margin to spare.
 */
const PROACTIVE_MIN_LEAD_MS = 30_000;
/** Never schedule a timer shorter than this — coalesce near-immediate fires. */
const PROACTIVE_MIN_DELAY_MS = 1_000;
/** Bounded retries for transient/network refresh failures before giving up. */
const PROACTIVE_MAX_RETRIES = 3;
/** Base backoff between transient-failure retries (doubled each attempt). */
const PROACTIVE_RETRY_BASE_MS = 2_000;

/**
 * When (epoch ms) to PROACTIVELY refresh a session whose access token expires
 * at `expiresAt`. Policy: fire at ~75% of the lifetime elapsed, OR
 * `expiresAt - max(30s, 10% of lifetime)`, whichever is SOONER — then clamp the
 * lead time into [30s, 5min] so very short tokens still refresh early enough and
 * very long ones don't churn hours ahead. `expiresAt` here is the provider's
 * skew-adjusted expiry (already 30s before the server's), so the schedule sits a
 * little further still inside the real lifetime — exactly the safety we want.
 *
 * Returns `undefined` when the token has no reported lifetime (nothing to
 * schedule against) — the lazy path remains the only renewal trigger.
 */
function proactiveRefreshAt(
  session: IssuerSession,
  now: number = Date.now(),
): number | undefined {
  if (session.expiresAt === undefined) return undefined;
  const remaining = session.expiresAt - now;
  // The lifetime as the provider sees it (skew already removed in expiresAt()).
  const lifetime = Math.max(remaining, 0);
  // "75% elapsed" measured from NOW over the remaining window.
  const at75 = now + remaining * 0.75;
  // expiresAt - max(30s, 10% of lifetime).
  const leadFromTenth = Math.max(PROACTIVE_MIN_LEAD_MS, lifetime * 0.1);
  const atLead = session.expiresAt - leadFromTenth;
  // Whichever is SOONER.
  let fireAt = Math.min(at75, atLead);
  // Clamp the LEAD (expiresAt - fireAt) into [MIN, MAX].
  const lead = session.expiresAt - fireAt;
  if (lead < PROACTIVE_MIN_LEAD_MS) fireAt = session.expiresAt - PROACTIVE_MIN_LEAD_MS;
  else if (lead > PROACTIVE_MAX_LEAD_MS) fireAt = session.expiresAt - PROACTIVE_MAX_LEAD_MS;
  return fireAt;
}

/**
 * The page-lifecycle surface proactive scheduling consults — injectable so the
 * provider can be driven in node tests and degrade to a no-op under SSR. Models
 * just the slice we need of the Page Visibility API + window focus.
 *
 * Production wires {@link domVisibilityLifecycle} (document/window). When
 * `undefined` (SSR/node), scheduling treats the page as always-visible and skips
 * the visibility gating — fine for non-browser callers, which have no timers to
 * leak anyway.
 */
export interface VisibilityLifecycle {
  /** Is the page currently visible? (`document.visibilityState === "visible"`.) */
  isVisible(): boolean;
  /**
   * Subscribe to "page became visible OR window regained focus". Called when the
   * user returns to a backgrounded tab — the cue to re-evaluate expiry (timers
   * may have been throttled/dropped while hidden or during OS sleep). Returns an
   * unsubscribe function.
   */
  onResume(listener: () => void): () => void;
  /**
   * Subscribe to "page became hidden". Returns an unsubscribe function. Used to
   * stop firing timers in a backgrounded tab (battery + pointless token churn).
   */
  onHide(listener: () => void): () => void;
}

/**
 * The production {@link VisibilityLifecycle}: the Page Visibility API
 * (`visibilitychange`) plus a window `focus`/`blur` pair (focus catches the
 * alt-tab-back case some browsers report only as focus, not visibilitychange).
 * Construct only in the browser.
 */
export function domVisibilityLifecycle(
  doc: Document = document,
  win: Window = window,
): VisibilityLifecycle {
  return {
    isVisible: () => doc.visibilityState === "visible",
    onResume(listener) {
      const onVis = () => {
        if (doc.visibilityState === "visible") listener();
      };
      doc.addEventListener("visibilitychange", onVis);
      win.addEventListener("focus", listener);
      return () => {
        doc.removeEventListener("visibilitychange", onVis);
        win.removeEventListener("focus", listener);
      };
    },
    onHide(listener) {
      const onVis = () => {
        if (doc.visibilityState === "hidden") listener();
      };
      doc.addEventListener("visibilitychange", onVis);
      return () => doc.removeEventListener("visibilitychange", onVis);
    },
  };
}

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

export class WebIdDPoPTokenProvider implements TokenProvider {
  readonly #callbackUri: string;
  readonly #getCode: GetCodeCallback;
  readonly #getWebId: GetWebIdCallback;
  readonly #clientId?: string;
  readonly #chooseIssuer?: ChooseIssuerCallback;
  readonly #allowInsecureLoopback: boolean;
  /**
   * Durable refresh-token-session store, when persistence is enabled. The whole
   * raison d'être of {@link attemptRestore}: a returning user (in-memory state
   * gone) is restored from here via a refresh grant, no window. `undefined`
   * keeps the in-memory-only behaviour.
   */
  readonly #sessionStore?: SessionStore;
  /**
   * The profile is PUBLIC, so reading it needs no auth. We must not read it
   * through the patched global fetch in a way that recurses back into this
   * provider on a 401. We snapshot `globalThis.fetch` at construction — the
   * provider is built BEFORE `new ReactiveFetchManager([provider])` patches the
   * global, so this snapshot is the original, un-upgrading fetch. (A public
   * profile won't 401 anyway, but this keeps the read provably out of the
   * reactive loop regardless of access-control surprises.)
   */
  readonly #profileFetch: typeof fetch;
  /**
   * Memoised issuer resolution: the user is asked for their WebID ONCE per
   * provider instance, not on every 401 — and concurrent 401s share the same
   * in-flight prompt (single-flight). Cleared on failure so a cancelled or
   * failed prompt can be retried.
   */
  #issuer?: Promise<URL>;
  /** The href {@link #issuer} resolved to, so a logout can unpin it synchronously. */
  #pinnedIssuerHref?: string;
  /**
   * Per-issuer generation and cancellation, replaced by every forget. Auth
   * work records the generation it started in and may only publish, persist or
   * reschedule while it is still current (see {@link #begin}).
   */
  readonly #generations = new Map<string, { id: number; abort: AbortController }>();
  // Explicit login and logout invalidate older pin attempts.
  #pinGeneration = 0;
  #issuerResolutionAbort = new AbortController();
  // A pending session has no token WebID yet; remember who started it to guard joins.
  readonly #pendingOwners = new Map<string, string | undefined>();
  // Account continuity survives eviction of dead tokens.
  readonly #confirmedOwners = new Map<string, string | undefined>();
  // Ordered writes prevent an old put reviving logout or an old delete erasing login.
  #storeMutations: Promise<void> = Promise.resolve();
  readonly #onProactiveRefreshSettled?: WebIdDPoPTokenProviderOptions["onProactiveRefreshSettled"];
  /** Single-flight session per issuer: parallel 401s share one login flow. */
  readonly #sessions = new Map<string, Promise<IssuerSession>>();
  /**
   * The last SETTLED session per issuer — a synchronous snapshot beside the
   * promise map above, kept solely so {@link canRenewWithoutInteraction} can
   * answer without awaiting anything (a click handler must decide whether to
   * `window.open` BEFORE its user activation is consumed by an await). Also
   * used to check account ownership; `#sessions` stays the single-flight truth.
   */
  readonly #settledSessions = new Map<string, IssuerSession>();
  /** Whether proactive background refresh is enabled (opt-in). */
  readonly #proactiveRefresh: boolean;
  /** Page-lifecycle surface (visibility/focus) for proactive scheduling. */
  readonly #visibility: VisibilityLifecycle;
  readonly #setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly #clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  /**
   * Per-issuer proactive-refresh scheduler state. An entry exists only while an
   * issuer is being kept fresh; cleared on logout, teardown, dead refresh token,
   * or a no-refresh-token session. See {@link #scheduleProactive}.
   */
  readonly #schedulers = new Map<string, IssuerScheduler>();
  /** Unsubscribe handles for the (single, shared) visibility listeners. */
  #visibilityUnsub?: () => void;
  /** Set by {@link teardown}; stops all future scheduling permanently. */
  #destroyed = false;

  constructor(
    callbackUri: string,
    getCode: GetCodeCallback,
    getWebId: GetWebIdCallback,
    options: WebIdDPoPTokenProviderOptions = {},
  ) {
    this.#callbackUri = callbackUri;
    this.#getCode = getCode;
    this.#getWebId = getWebId;
    this.#clientId = options.clientId;
    this.#chooseIssuer = options.chooseIssuer;
    this.#allowInsecureLoopback = options.allowInsecureLoopback ?? false;
    this.#profileFetch =
      options.profileFetch ?? globalThis.fetch.bind(globalThis);
    this.#sessionStore = options.sessionStore;
    this.#onProactiveRefreshSettled = options.onProactiveRefreshSettled;
    this.#proactiveRefresh = options.proactiveRefresh ?? false;
    this.#visibility =
      options.visibilityLifecycle ??
      (this.#proactiveRefresh && typeof document !== "undefined"
        ? domVisibilityLifecycle()
        : noopVisibilityLifecycle);
    this.#setTimeout =
      options.setTimeoutFn ??
      ((handler, ms) => setTimeout(handler, ms));
    this.#clearTimeout = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  }

  /** oauth4webapi request options, enabling insecure loopback per the policy. */
  #httpOptions(
    issuer: URL,
    signal: AbortSignal,
  ): { signal: AbortSignal; [oauth.allowInsecureRequests]?: true } {
    if (this.#allowInsecureLoopback && isLoopback(issuer.hostname)) {
      return { signal, [oauth.allowInsecureRequests]: true };
    }
    return { signal };
  }

  /**
   * WebID-driven issuer resolution — the one structural change from the
   * published provider. Ask the app for a WebID, validate it, dereference its
   * public profile (out-of-loop fetch), read every `solid:oidcIssuer`, then let
   * the app choose when several are advertised.
   */
  async #resolveIssuer(signal: AbortSignal): Promise<URL> {
    const webId = validateWebId(await this.#getWebId());
    signal.throwIfAborted();
    const { dataset } = await freshRdf(webId, this.#profileFetch);
    // A forgotten profile read must not open an issuer picker afterwards.
    signal.throwIfAborted();
    const issuers = resolveIssuers(webId, dataset);
    const choose = this.#chooseIssuer ?? defaultChooseIssuer(webId);
    const chosen = await choose(issuers);
    signal.throwIfAborted();
    return new URL(chosen);
  }

  async matches(): Promise<boolean> {
    return true;
  }

  /**
   * App-initiated login against a KNOWN issuer — the entry point for the
   * first-party login UI (provider picker / bare-issuer input), where the
   * app resolved the issuer itself and a WebID may not exist yet.
   *
   * Pins the provider's issuer (subsequent 401 upgrades reuse it without
   * prompting), drives the code flow through the cached-session machinery
   * (instant when a fresh session exists; popup otherwise), and reports the
   * authenticated WebID from the ID token when the server states one.
   *
   * INTERACTIVE-FIRST by default (app-specific divergence from the upstream
   * silent-first pattern; see the module docs): the silent `prompt=none`
   * attempt is skipped unless {@link LoginOptions.silentFirst} asks for it.
   */
  async login(
    issuer: URL,
    options: LoginOptions = {},
  ): Promise<{ webId: string | undefined; ownership: number }> {
    this.#invalidatePin();
    this.#pin(issuer);
    if (this.#belongsToAnotherWebId(issuer, options.expectedWebId)) {
      this.#forgetInMemory(issuer.href);
      // Delete even when the replacement receives no durable credential.
      void this.#clearPersisted(issuer);
    } else if (!this.#pendingOwners.has(issuer.href)) {
      // A new explicit attempt owns validation, even when reusing fresh tokens.
      const old = this.#generationOf(issuer.href);
      this.#generations.set(issuer.href, { id: old.id + 1, abort: new AbortController() });
      old.abort.abort(new IssuerForgottenError(issuer.href));
    }
    const mode: AuthorizeMode =
      options.silentFirst === true ? "silent-first" : "interactive";
    const generation = this.#generationOf(issuer.href).id;
    const session = await this.#getSession(issuer, generation, mode, options.expectedWebId, true);
    await this.#storeMutations;
    this.#assertGeneration(issuer.href, generation);
    return { webId: session.webId, ownership: generation };
  }

  /**
   * SYNCHRONOUS probe: would {@link login} for this issuer complete without
   * any authorize navigation? True when the last settled session is still
   * fresh (within the expiry skew) OR carries a refresh token — the refresh
   * grant (RFC 6749 §6) is a plain fetch, no popup. False when nothing is
   * cached, the cached state is unusable, or a first login is still in
   * flight (unknown ≠ yes).
   *
   * The click handler uses this to decide whether to `window.open` while the
   * user activation is live (`openPopupUnlessRenewable` in popup-login.ts).
   * A YES can still be wrong — the server may reject the refresh grant — in
   * which case {@link #renew} drops the dead token (keeping this probe honest
   * for the next click) and the code-flow fallback recovers via the popup
   * controller's `onBlocked` affordance, never a raw unactivated open.
   *
   * APP-SPECIFIC (candidate for upstream alongside the PR #11/#12 session
   * cache): upstream's DPoPTokenProvider exposes no popup-avoidance probe.
   */
  canRenewWithoutInteraction(issuer: URL, expectedWebId?: string): boolean {
    const session = this.#settledSessions.get(issuer.href);
    if (session === undefined) return false;
    if (expectedWebId !== undefined && session.webId !== expectedWebId) return false;
    return !hasExpired(session) || session.refreshToken !== undefined;
  }

  async upgrade(request: Request): Promise<Request> {
    const pinGeneration = this.#pinGeneration;
    if (this.#issuer === undefined) {
      const resolving: Promise<URL> = this.#resolveIssuer(this.#issuerResolutionAbort.signal).then(
        (resolved) => {
          if (this.#pinGeneration !== pinGeneration) throw new IssuerForgottenError(resolved.href);
          if (this.#issuer === resolving) this.#pinnedIssuerHref = resolved.href;
          return resolved;
        },
        (e) => {
          if (this.#issuer === resolving) this.#issuer = undefined;
          if (this.#pinGeneration !== pinGeneration) throw new IssuerForgottenError("pending issuer");
          throw e;
        },
      );
      this.#issuer = resolving;
    }
    const issuer = await this.#issuer;
    const generation = this.#generationOf(issuer.href).id;
    const assertCurrent = () => {
      if (this.#pinGeneration !== pinGeneration) throw new IssuerForgottenError(issuer.href);
      this.#assertGeneration(issuer.href, generation);
    };
    assertCurrent();
    const session = await this.#getSession(issuer, generation);
    assertCurrent();
    const headers = new Headers(request.headers);
    headers.set(
      "DPoP",
      await DPoP.generateProof(
        session.dpopKey,
        request.url,
        request.method,
        undefined,
        session.accessToken,
      ),
    );
    // Signing can outlive logout even when the cached session was already fenced.
    assertCurrent();
    headers.set("Authorization", ["DPoP", session.accessToken].join(" "));
    assertCurrent();
    return new Request(request, { headers });
  }

  /**
   * Marks the cached session stale when the access token attached to the
   * request was rejected by the resource server (still 401 after an upgrade):
   * revoked, invalidated early, or expired without a server-reported lifetime.
   * The next upgrade then renews the session — refresh grant first, popup flow
   * as fallback — instead of replaying the rejected token.
   *
   * MIRRORS upstream reactive-authentication PR #14 (`TokenProvider.invalidate`
   * + the manager's 401-once retry) — delete with the rest of this port when a
   * release containing it is published.
   */
  async invalidate(request: Request): Promise<void> {
    const issuer = await this.#issuer?.catch(() => undefined);
    if (issuer === undefined) return;
    const pending = this.#sessions.get(issuer.href);
    if (pending === undefined) return;

    const session = await pending.catch(() => undefined);

    // Only when the rejected token is still the cached one — a concurrent
    // renewal may already have replaced it.
    if (
      session !== undefined &&
      request.headers.get("Authorization") === `DPoP ${session.accessToken}`
    ) {
      session.expiresAt = 0;
    }
  }

  /**
   * Reuse the (possibly in-flight) session for the issuer; renew an expired one
   * (transparently via the refresh-token grant where possible); else run the
   * code flow once, with `mode` deciding whether that flow tries `prompt=none`
   * first (background re-auth) or goes straight to the login page (explicit
   * login). Background calls require an established authenticated WebID.
   */
  async #getSession(
    issuer: URL,
    generation: number,
    mode: AuthorizeMode = "silent-first",
    expectedWebId?: string,
    explicitLogin = false,
  ): Promise<IssuerSession> {
    this.#assertGeneration(issuer.href, generation);
    const cached = this.#sessions.get(issuer.href);
    if (cached === undefined) {
      const establishedWebId = this.#confirmedOwners.get(issuer.href);
      if (!explicitLogin && establishedWebId === undefined) {
        throw new SessionIdentityChangedError(issuer.href);
      }
      return this.#begin(issuer, generation,
        (signal) => this.#authenticate(issuer, signal, mode), expectedWebId,
        explicitLogin ? undefined : establishedWebId);
    }

    const session = await cached;
    // A waiter must never renew or recurse into the generation created by logout.
    this.#assertGeneration(issuer.href, generation);
    if (!explicitLogin && session.webId === undefined) throw new SessionIdentityChangedError(issuer.href);
    if (!hasExpired(session)) return session;

    if (this.#sessions.get(issuer.href) === cached) {
      return this.#begin(issuer, generation,
        (signal) => this.#renew(issuer, session, signal, mode, generation), session.webId,
        explicitLogin ? undefined : session.webId);
    }
    return this.#getSession(issuer, generation, mode, expectedWebId, explicitLogin);
  }

  /** Cache the fenced promise so every joined caller observes the same ownership checks. */
  #begin(
    issuer: URL,
    generation: number,
    work: (signal: AbortSignal) => Promise<IssuerSession>,
    expectedWebId?: string,
    establishedWebId?: string,
  ): Promise<IssuerSession> {
    const href = issuer.href;
    this.#assertGeneration(href, generation);
    const { abort } = this.#generationOf(href);
    // Defer work until the fenced promise and its account owner are installed.
    const fenced = Promise.resolve().then(async () => {
      try {
        this.#assertGeneration(href, generation);
        const session = await work(abort.signal);
        this.#assertGeneration(href, generation);
        if (establishedWebId !== undefined && session.webId !== establishedWebId) {
          throw new SessionIdentityChangedError(issuer.href);
        }
        if (this.#confirmedOwners.has(href) && this.#confirmedOwners.get(href) !== session.webId) {
          await this.#clearPersisted(issuer);
          this.#assertGeneration(href, generation);
        }
        // Keep the same object so invalidate/renew staleness reaches the popup probe.
        this.#settledSessions.set(href, session);
        this.#confirmedOwners.set(href, session.webId);
        await this.#persist(issuer, session, generation);
        this.#assertGeneration(href, generation);
        this.#scheduleProactive(issuer, session);
        return session;
      } catch (e) {
        if (this.#sessions.get(href) === fenced) this.#sessions.delete(href);
        // Cancellation belongs to the forgotten generation, not a newer session.
        this.#assertGeneration(href, generation);
        throw e;
      } finally {
        if (this.#sessions.get(href) === fenced || !this.#sessions.has(href)) {
          this.#pendingOwners.delete(href);
        }
      }
    });
    this.#sessions.set(href, fenced);
    this.#pendingOwners.set(href, expectedWebId);
    return fenced;
  }

  #generationOf(href: string): { id: number; abort: AbortController } {
    let generation = this.#generations.get(href);
    if (generation === undefined) {
      generation = { id: 0, abort: new AbortController() };
      this.#generations.set(href, generation);
    }
    return generation;
  }

  #assertGeneration(href: string, id: number): void {
    if (this.#generationOf(href).id !== id) throw new IssuerForgottenError(href);
  }

  #invalidatePin(): void {
    this.#pinGeneration++;
    this.#issuerResolutionAbort.abort(new IssuerForgottenError("pending issuer"));
    this.#issuerResolutionAbort = new AbortController();
  }

  #pin(issuer: URL): void {
    this.#issuer = Promise.resolve(issuer);
    this.#pinnedIssuerHref = issuer.href;
  }

  /** Explicit account targets may only share credentials with a known matching owner. */
  #belongsToAnotherWebId(issuer: URL, expectedWebId: string | undefined): boolean {
    if (expectedWebId === undefined) return false;
    if (this.#pendingOwners.has(issuer.href)) {
      return this.#pendingOwners.get(issuer.href) !== expectedWebId;
    }
    const settled = this.#settledSessions.get(issuer.href);
    if (settled !== undefined) return settled.webId !== expectedWebId;
    return this.#confirmedOwners.has(issuer.href) && this.#confirmedOwners.get(issuer.href) !== expectedWebId;
  }

  /** Drop ownership before aborting so even synchronous abort listeners see the new generation. */
  #forgetInMemory(href: string): void {
    const old = this.#generationOf(href);
    this.#generations.set(href, { id: old.id + 1, abort: new AbortController() });
    this.#clearScheduler(href);
    this.#sessions.delete(href);
    this.#settledSessions.delete(href);
    this.#confirmedOwners.delete(href);
    this.#pendingOwners.delete(href);
    old.abort.abort(new IssuerForgottenError(href));
  }

  // ── Proactive refresh (opt-in; MIRRORS-CANDIDATE for upstream) ─────────────
  //
  // Composes WITH the lazy paths rather than replacing them: every settled
  // session reschedules here (#begin), and a fired refresh runs through the SAME
  // single-flight #getSession machinery a lazy upgrade()/invalidate() uses — so a
  // proactive refresh in flight satisfies a concurrent upgrade(), and the two
  // never stampede the token endpoint. The persistence path is untouched: the
  // refresh grant rotates + #persist()s the new token exactly as the lazy renew
  // does. The renew-on-rejected path (invalidate) still wins on real 401s — a
  // proactive refresh just makes those rare during active use.

  /**
   * Arm (or re-arm) the proactive refresh timer for an issuer from a freshly
   * settled session. No-op unless proactive refresh is enabled AND the session
   * holds a refresh token with a reported lifetime (otherwise there is nothing
   * to refresh with, or nothing to schedule against — the lazy path stays).
   *
   * Idempotent per session: clears any prior timer first. Subscribes the shared
   * visibility listeners on first use. While the tab is HIDDEN, no timer is armed
   * — the resume listener re-evaluates on return instead (battery + sleep-drop
   * correctness).
   */
  #scheduleProactive(issuer: URL, session: IssuerSession): void {
    if (!this.#proactiveRefresh || this.#destroyed) return;
    // N/A without a refresh token or a reported lifetime — document: the lazy
    // path remains the only renewal trigger for these sessions.
    if (session.refreshToken === undefined) {
      this.#clearScheduler(issuer.href);
      return;
    }
    const fireAt = proactiveRefreshAt(session);
    if (fireAt === undefined) {
      this.#clearScheduler(issuer.href);
      return;
    }

    this.#ensureVisibilitySubscribed();

    let scheduler = this.#schedulers.get(issuer.href);
    if (scheduler === undefined) {
      scheduler = { retries: 0 };
      this.#schedulers.set(issuer.href, scheduler);
    } else if (scheduler.timer !== undefined) {
      this.#clearTimeout(scheduler.timer);
      scheduler.timer = undefined;
    }
    // A successfully (re)scheduled cycle starts a fresh retry budget.
    scheduler.retries = 0;
    scheduler.fireAt = fireAt;

    // Don't run timers in a hidden tab: the resume listener will re-evaluate.
    if (!this.#visibility.isVisible()) {
      scheduler.timer = undefined;
      return;
    }
    this.#armTimer(issuer, scheduler, fireAt);
  }

  /** Arm a timer to fire the proactive refresh at `fireAt` (clamped ≥ now). */
  #armTimer(issuer: URL, scheduler: IssuerScheduler, fireAt: number): void {
    const delay = Math.max(PROACTIVE_MIN_DELAY_MS, fireAt - Date.now());
    if (scheduler.timer !== undefined) this.#clearTimeout(scheduler.timer);
    scheduler.fireAt = fireAt;
    scheduler.timer = this.#setTimeout(() => {
      scheduler.timer = undefined;
      void this.#fireProactive(issuer);
    }, delay);
  }

  /**
   * Run a proactive refresh in the background, SHARING the single-flight session
   * cache with the lazy paths so the two never stampede the token endpoint:
   *
   *  - If a renewal/login is already IN FLIGHT for this issuer (`#sessions` holds
   *    a pending entry — a concurrent `upgrade()`→`#renew`, a `restoreIssuer`, …),
   *    JOIN it instead of starting a second grant. When it settles fresh, the
   *    cycle is satisfied (that entry's own {@link #begin} already rescheduled);
   *    only if it settles still-expired do we fall through and refresh ourselves.
   *  - Otherwise publish our own refresh-token grant into the cache via
   *    {@link #begin}, so a concurrent `upgrade()` that arrives mid-flight sees
   *    and shares it rather than firing its own.
   *
   * The refresh is driven through {@link #refresh} DIRECTLY (not {@link #renew}),
   * so a dead/transient grant is handled here WITHOUT ever falling back to the
   * authorize popup — there is no user gesture on this path. invalid_grant clears
   * the persisted session and STOPS scheduling; transient/network failure retries
   * with bounded backoff.
   */
  async #fireProactive(issuer: URL): Promise<void> {
    const scheduler = this.#schedulers.get(issuer.href);
    if (scheduler === undefined || this.#destroyed) return;
    // Hidden again between arming and firing: defer to the resume listener.
    if (!this.#visibility.isVisible()) {
      scheduler.timer = undefined;
      return;
    }

    // The session we mean to refresh — the last settled one, captured up front
    // so we can tell a steady-state cache hit (refresh it) from a NEWER renewal
    // that landed while we waited (join it; don't double-refresh).
    const current = this.#settledSessions.get(issuer.href);
    if (current === undefined || current.refreshToken === undefined) {
      this.#clearScheduler(issuer.href);
      return;
    }

    const generation = this.#generationOf(issuer.href).id;
    let outcome: "refreshed" | "forgotten" | "failed" = "refreshed";
    try {
      const inFlight = this.#sessions.get(issuer.href);
      if (inFlight !== undefined) {
        const joined = await inFlight.catch(() => undefined);
        this.#assertGeneration(issuer.href, generation);
        if (joined === undefined || (joined !== current && !hasExpired(joined))) return;
      }
      // A newer renewal owns its own persistence and rescheduling.
      if (this.#sessions.get(issuer.href) !== inFlight) return;
      await this.#begin(issuer, generation,
        (signal) => this.#refresh(issuer, current, current.refreshToken!, signal), current.webId, current.webId);
    } catch (e) {
      if (this.#generationOf(issuer.href).id !== generation || e instanceof IssuerForgottenError) {
        outcome = "forgotten";
        return;
      }
      outcome = "failed";
      await this.#handleProactiveFailure(issuer, e);
    } finally {
      // Tests and observers need settlement after cleanup, not merely a received grant.
      if (this.#generationOf(issuer.href).id !== generation) outcome = "forgotten";
      this.#onProactiveRefreshSettled?.(issuer, outcome);
    }
  }

  /**
   * Classify a failed proactive refresh:
   *  - `invalid_grant` (refresh token dead/revoked): clear the persisted session
   *    and STOP scheduling for this issuer. No popup — the next user-initiated
   *    action falls back to the existing interactive path.
   *  - transient/network: retry with bounded exponential backoff, still no popup.
   *    After the budget is spent, stop scheduling (the lazy path will recover on
   *    the next real request).
   */
  async #handleProactiveFailure(issuer: URL, error: unknown): Promise<void> {
    const scheduler = this.#schedulers.get(issuer.href);
    if (scheduler === undefined || this.#destroyed) return;

    if (isInvalidGrant(error)) {
      this.#clearScheduler(issuer.href);
      this.#settledSessions.delete(issuer.href);
      this.#sessions.delete(issuer.href);
      await this.#clearPersisted(issuer);
      return;
    }

    // Transient: retry with backoff, bounded, never a popup.
    if (scheduler.retries >= PROACTIVE_MAX_RETRIES) {
      this.#clearScheduler(issuer.href);
      return;
    }
    const attempt = ++scheduler.retries;
    const backoff = PROACTIVE_RETRY_BASE_MS * 2 ** (attempt - 1);
    if (!this.#visibility.isVisible()) {
      // Don't burn retries in the background; resume re-evaluates.
      scheduler.timer = undefined;
      return;
    }
    this.#armTimer(issuer, scheduler, Date.now() + backoff);
  }

  /** Subscribe the shared visibility/focus listeners once (first scheduler). */
  #ensureVisibilitySubscribed(): void {
    if (this.#visibilityUnsub !== undefined) return;
    const onResume = this.#onResume.bind(this);
    const onHide = this.#onHide.bind(this);
    const unsubResume = this.#visibility.onResume(onResume);
    const unsubHide = this.#visibility.onHide(onHide);
    this.#visibilityUnsub = () => {
      unsubResume();
      unsubHide();
    };
  }

  /**
   * The tab became visible / window regained focus. Timers may have been
   * throttled or dropped while hidden (or during OS sleep), so we ALWAYS
   * re-evaluate expiry rather than trust a timer fired: for each issuer, if the
   * token is already within the refresh window (or expired), refresh now; else
   * re-arm a fresh timer to its scheduled instant.
   */
  #onResume(): void {
    if (this.#destroyed) return;
    const now = Date.now();
    for (const [href, scheduler] of this.#schedulers) {
      const session = this.#settledSessions.get(href);
      if (session === undefined || session.refreshToken === undefined) {
        this.#clearScheduler(href);
        continue;
      }
      const fireAt = scheduler.fireAt ?? proactiveRefreshAt(session, now);
      const issuer = new URL(href);
      if (scheduler.timer !== undefined) {
        this.#clearTimeout(scheduler.timer);
        scheduler.timer = undefined;
      }
      if (fireAt === undefined || now >= fireAt) {
        // Within (or past) the refresh window: refresh immediately.
        void this.#fireProactive(issuer);
      } else {
        this.#armTimer(issuer, scheduler, fireAt);
      }
    }
  }

  /** The tab became hidden: stop firing timers (re-armed on resume). */
  #onHide(): void {
    for (const scheduler of this.#schedulers.values()) {
      if (scheduler.timer !== undefined) {
        this.#clearTimeout(scheduler.timer);
        scheduler.timer = undefined;
      }
    }
  }

  /** Clear and forget the scheduler for one issuer (timer + bookkeeping). */
  #clearScheduler(href: string): void {
    const scheduler = this.#schedulers.get(href);
    if (scheduler?.timer !== undefined) this.#clearTimeout(scheduler.timer);
    this.#schedulers.delete(href);
    if (this.#schedulers.size === 0) {
      this.#visibilityUnsub?.();
      this.#visibilityUnsub = undefined;
    }
  }

  /**
   * Stop proactively refreshing one issuer (e.g. explicit logout). Clears its
   * timer + bookkeeping; the visibility listeners are released once the last
   * scheduler is gone. Does NOT touch the persisted session — logout clears that
   * separately via {@link forgetIssuer}.
   */
  stopProactiveRefresh(issuer: URL): void {
    this.#clearScheduler(issuer.href);
  }

  /**
   * Provider teardown: stop ALL proactive scheduling and release the shared
   * visibility listeners. Idempotent. Call on unmount so no interval/listener
   * leaks (and no token churn) after the provider is discarded.
   */
  teardown(): void {
    this.#destroyed = true;
    for (const scheduler of this.#schedulers.values()) {
      if (scheduler.timer !== undefined) this.#clearTimeout(scheduler.timer);
    }
    this.#schedulers.clear();
    this.#visibilityUnsub?.();
    this.#visibilityUnsub = undefined;
  }

  /**
   * Persist (or update) the durable session for this issuer: the ROTATED refresh
   * token + the DPoP key. Persists ONLY when a refresh token exists and a WebID
   * is known (an issuer-first login with no `webid` claim cannot be restored by
   * WebID, so there is nothing useful to store). The ACCESS TOKEN is never
   * written — only the long-lived, key-bound credential. No-op without a store.
   */
  #persist(issuer: URL, session: IssuerSession, generation: number): Promise<void> {
    // Publication still waits for earlier cleanup when there is nothing to write.
    if (session.refreshToken === undefined || session.webId === undefined) return this.#storeMutations;
    const stored: PersistedSession = {
      issuer: issuer.href,
      webId: session.webId,
      refreshToken: session.refreshToken,
      dpopKey: session.dpopKey,
      clientId: this.#clientId,
      expiresAt: session.expiresAt,
    };
    return this.#mutateStore(async (store) => {
      // Ownership may change while an earlier put/delete holds the queue.
      if (this.#generationOf(issuer.href).id !== generation) return;
      await store.put(stored);
    });
  }

  /** Deletes retain their queue position so a later login's put always follows logout. */
  #clearPersisted(issuer: URL): Promise<void> {
    return this.#mutateStore((store) => store.delete(issuer.href));
  }

  #mutateStore(mutate: (store: SessionStore) => Promise<void>): Promise<void> {
    const store = this.#sessionStore;
    if (store === undefined) return Promise.resolve();
    this.#storeMutations = this.#storeMutations.then(() => mutate(store)).catch(() => {
      // Best-effort durability must neither fail login nor poison later queued cleanup.
    });
    return this.#storeMutations;
  }

  /**
   * RESTORE a returning user's session for a KNOWN issuer from the durable store
   * via a `refresh_token` grant — the whole point of this module: a
   * token-endpoint FETCH, never a window/iframe. Call on page load once the
   * issuer is known (the app reads it from the persisted recent-account record).
   *
   * Returns the authenticated WebID on success (the in-memory session is now
   * populated, so subsequent 401 upgrades and the synchronous popup-avoidance
   * probe work without any further interaction), or `undefined` when there is
   * nothing to restore OR the persisted refresh token is dead — in which case
   * the persisted entry is CLEARED and the caller falls back to its existing
   * behaviour (no popup on restore; interactive popup only on an explicit click).
   *
   * Pins the provider's issuer on success, exactly like {@link login}, so a
   * later 401 reuses the restored session without prompting for a WebID.
   *
   * APP-SPECIFIC divergence (strong upstream candidate — see the module docs):
   * upstream reactive-authentication's DPoPTokenProvider holds its refresh token
   * in memory only, so a reload re-runs the authorization-code flow (the
   * prompt=none probe that flashes a window). Persisting the DPoP-bound refresh
   * token + non-extractable key and restoring via the refresh grant removes that
   * flash. Equivalent library change described in the task report.
   */
  async restoreIssuer(issuer: URL): Promise<{ webId: string; ownership: number } | undefined> {
    const pinGeneration = this.#pinGeneration;
    const generation = this.#generationOf(issuer.href).id;
    if (this.#sessionStore === undefined || this.#sessions.has(issuer.href)) return undefined;

    let stored: PersistedSession | undefined;
    try {
      await this.#mutateStore(async (store) => {
        if (this.#generationOf(issuer.href).id === generation && !this.#sessions.has(issuer.href)) {
          stored = await store.get(issuer.href);
        }
      });
    } catch {
      return undefined;
    }
    if (stored === undefined || this.#generationOf(issuer.href).id !== generation ||
        this.#sessions.has(issuer.href)) return undefined;

    try {
      const session = await this.#begin(
        issuer,
        generation,
        (signal) => this.#restore(issuer, stored!, signal),
        stored.webId,
        stored.webId,
      );
      this.#assertGeneration(issuer.href, generation);
      if (this.#pinGeneration === pinGeneration) this.#pin(issuer);
      return session.webId === undefined ? undefined : { webId: session.webId, ownership: generation };
    } catch (e) {
      // Signed out while restoring: the logout already cleared the store, and
      // a newer login may have written its own entry since.
      if (e instanceof IssuerForgottenError || this.#generationOf(issuer.href).id !== generation) return undefined;
      // The refresh token was expired/revoked (token endpoint invalid_grant) or
      // the restore otherwise failed: clear the dead entry and report "nothing
      // restored" so the caller stays silent (no popup on restore).
      await this.#clearPersisted(issuer);
      return undefined;
    }
  }

  /**
   * Rebuild an {@link IssuerSession} from a {@link PersistedSession}: discover
   * the AS, reconstruct the DPoP handle around the PERSISTED key (key continuity
   * — the same non-extractable key that minted the original token signs the
   * refresh proof, which is the whole point of DPoP sender-constraining), then
   * run the refresh grant. Throws on a dead refresh token so restoreIssuer()
   * clears it.
   */
  async #restore(
    issuer: URL,
    stored: PersistedSession,
    signal: AbortSignal,
  ): Promise<IssuerSession> {
    const http = this.#httpOptions(issuer, signal);

    const discoveryResponse = await oauth.discoveryRequest(issuer, http);
    const authorizationServer = await oauth.processDiscoveryResponse(
      issuer,
      discoveryResponse,
    );
    const clientRegistration = await this.#resolveClient(authorizationServer, http);

    // Reattach the PERSISTED, non-extractable DPoP key — the proof for the
    // refresh grant must be signed by the key the token is bound to.
    const dpopHandle = oauth.DPoP({}, stored.dpopKey);

    // A bare in-memory session shell; #refresh redeems the persisted refresh
    // token against it and returns the populated, rotated session.
    const shell: IssuerSession = {
      authorizationServer,
      clientRegistration,
      dpopKey: stored.dpopKey,
      dpopHandle,
      accessToken: "", // never persisted; minted by the refresh grant below
      refreshToken: stored.refreshToken,
      expiresAt: 0,
      webId: stored.webId,
    };
    return this.#refresh(issuer, shell, stored.refreshToken, signal);
  }

  /**
   * Sign out of an issuer (explicit logout): drop the in-memory session (so no
   * later request is upgraded with it), stop refreshing it, unpin it as the
   * 401-upgrade issuer, fence off any login/refresh/restore still in flight for
   * it, and wipe the persisted refresh token + key so the credential is not
   * revived on the next load.
   */
  async forgetIssuer(issuer: URL): Promise<void> {
    this.#forgetInMemory(issuer.href);
    this.#invalidatePin();
    if (this.#pinnedIssuerHref === undefined || this.#pinnedIssuerHref === issuer.href) {
      this.#issuer = undefined;
      this.#pinnedIssuerHref = undefined;
    }
    await this.#clearPersisted(issuer);
  }

  /** Clear only the session generation whose profile validation failed. */
  async forgetIssuerIfOwned(issuer: URL, ownership: number): Promise<void> {
    if (this.#generationOf(issuer.href).id !== ownership) return;
    await this.forgetIssuer(issuer);
  }

  /**
   * Prefer a transparent refresh-token grant; fall back to a new
   * authorization-code flow when there is no refresh token or the grant fails
   * (refresh-token expiry, revocation, rotation-reuse detection, …).
   */
  async #renew(
    issuer: URL,
    expired: IssuerSession,
    signal: AbortSignal,
    mode: AuthorizeMode,
    generation: number,
  ): Promise<IssuerSession> {
    if (expired.refreshToken === undefined) {
      return this.#authenticate(issuer, signal, mode);
    }
    try {
      return await this.#refresh(issuer, expired, expired.refreshToken, signal);
    } catch {
      // Signed out while the grant was in flight: never open a login window
      // for a session the user has just left.
      if (this.#generationOf(issuer.href).id !== generation) throw new IssuerForgottenError(issuer.href);
      // The grant was rejected (refresh-token expiry, revocation, rotation
      // reuse, …): drop the dead token IN PLACE so the synchronous probe
      // (canRenewWithoutInteraction) stops promising a popup-free renewal on
      // the next click. On the background path the fallback stays silent
      // while the IdP cookie lives (prompt=none first); an explicit login
      // goes interactive at once.
      expired.refreshToken = undefined;
      return this.#authenticate(issuer, signal, mode);
    }
  }

  /**
   * The refresh-token grant (RFC 6749 §6), DPoP-bound with the session's
   * existing key/handle, adopting the rotated refresh token when the server
   * issues one. One retry on a server-required DPoP nonce.
   */
  async #refresh(
    issuer: URL,
    session: IssuerSession,
    refreshToken: string,
    signal: AbortSignal,
  ): Promise<IssuerSession> {
    const { authorizationServer, clientRegistration, dpopHandle } = session;
    const clientAuth = this.#clientAuth(authorizationServer.issuer, clientRegistration);
    const http = this.#httpOptions(issuer, signal);

    const grant = () =>
      oauth.refreshTokenGrantRequest(
        authorizationServer,
        clientRegistration,
        clientAuth,
        refreshToken,
        { DPoP: dpopHandle, ...http },
      );

    let tokenResult: oauth.TokenEndpointResponse;
    try {
      tokenResult = await oauth.processRefreshTokenResponse(
        authorizationServer,
        clientRegistration,
        await grant(),
      );
    } catch (e) {
      if (!oauth.isDPoPNonceError(e)) throw e;
      // The handle captured the server's DPoP nonce from the error; retry once.
      tokenResult = await oauth.processRefreshTokenResponse(
        authorizationServer,
        clientRegistration,
        await grant(),
      );
    }

    return {
      ...session,
      accessToken: tokenResult.access_token,
      refreshToken: tokenResult.refresh_token ?? refreshToken,
      expiresAt: expiresAt(tokenResult),
    };
  }

  /**
   * The published DPoPTokenProvider flow, verbatim except for two changes
   * threaded through: the insecure-loopback option on every oauth4webapi call,
   * and a STATIC-vs-DYNAMIC client branch. Flow: discovery → client identity
   * (static Client Identifier Document when {@link WebIdDPoPTokenProviderOptions.clientId}
   * is set, else dynamic client registration) → PKCE/DPoP authorization-code
   * grant. In `"silent-first"` mode the `prompt=none` attempt + interactive
   * retry are preserved verbatim; in `"interactive"` mode (explicit login) the
   * first navigation IS the interactive request.
   */
  async #authenticate(
    issuer: URL,
    signal: AbortSignal,
    mode: AuthorizeMode = "silent-first",
  ): Promise<IssuerSession> {
    const http = this.#httpOptions(issuer, signal);

    const discoveryResponse = await oauth.discoveryRequest(issuer, http);
    const authorizationServer = await oauth.processDiscoveryResponse(
      issuer,
      discoveryResponse,
    );

    const clientRegistration = await this.#resolveClient(
      authorizationServer,
      http,
    );

    const [registeredRedirectUri] = clientRegistration.redirect_uris as
      | string[]
      | undefined ?? [this.#callbackUri];
    const [registeredResponseType] = (clientRegistration.response_types as
      | string[]
      | undefined) ?? ["code"];

    const dpopKey = await oauth.generateKeyPair("ES256", { extractable: false });
    const dpop = oauth.DPoP({}, dpopKey);
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const state = oauth.generateRandomState();

    // Opt in to refresh tokens where the server supports them (OIDC Core §11).
    // The static Client Identifier Document already declares offline_access +
    // the refresh_token grant; servers without support see the old request.
    const useOfflineAccess =
      authorizationServer.scopes_supported?.includes("offline_access") ?? false;

    const buildAuthorizationUrl = (withPrompt: boolean): URL => {
      const url = new URL(authorizationServer.authorization_endpoint as string);
      url.searchParams.set("client_id", clientRegistration.client_id);
      url.searchParams.set("redirect_uri", registeredRedirectUri);
      url.searchParams.set("response_type", registeredResponseType);
      url.searchParams.set(
        "scope",
        useOfflineAccess ? "openid webid offline_access" : "openid webid",
      );
      if (withPrompt) {
        url.searchParams.set("prompt", "none");
      } else if (useOfflineAccess) {
        // The interactive attempt must carry `prompt=consent` for the server to
        // honour `offline_access`: OIDC Core §11 says the AS MUST ignore the
        // scope otherwise, and oidc-provider (CSS, this broker) enforces that.
        url.searchParams.set("prompt", "consent");
      }
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      if (authorizationServer.code_challenge_methods_supported !== undefined) {
        if (
          authorizationServer.code_challenge_methods_supported.includes("S256")
        ) {
          url.searchParams.set("code_challenge_method", "S256");
          // challenge set asynchronously below
        } else {
          url.searchParams.set("code_challenge_method", "plain");
          url.searchParams.set("code_challenge", codeVerifier);
        }
      }
      return url;
    };

    // PKCE challenge (async) computed once and reused across prompt/no-prompt URLs.
    const usePkce =
      authorizationServer.code_challenge_methods_supported !== undefined;
    const useS256 =
      usePkce &&
      authorizationServer.code_challenge_methods_supported!.includes("S256");
    const codeChallenge = useS256
      ? await oauth.calculatePKCECodeChallenge(codeVerifier)
      : codeVerifier;

    // Explicit logins go straight to the interactive URL; background re-auth
    // tries prompt=none first (see AuthorizeMode).
    const silentFirst = mode === "silent-first";
    const authorizationUrl = buildAuthorizationUrl(silentFirst);
    if (usePkce) authorizationUrl.searchParams.set("code_challenge", codeChallenge);

    // Run the interactive (no-`prompt=none`) authorization once, reusing the
    // same popup window. Shared by the two silent-fallthrough paths below.
    const interactiveRetry = async (): Promise<URLSearchParams> => {
      const retryUrl = buildAuthorizationUrl(false);
      if (usePkce) retryUrl.searchParams.set("code_challenge", codeChallenge);
      // A delayed silent response must not open another window after logout.
      signal.throwIfAborted();
      const retryResponse = await this.#getCode(retryUrl, signal);
      return oauth.validateAuthResponse(
        authorizationServer,
        clientRegistration,
        new URL(retryResponse),
        state,
      );
    };

    let authorizationCodeParams: URLSearchParams;
    // Discovery, key generation and PKCE can all finish after the user signs out.
    signal.throwIfAborted();
    const authorizationCodeResponse = await this.#getCode(authorizationUrl, signal);

    // Non-compliant servers (NSS — solidweb.org, datapod.igrant.io; Trinpod)
    // IGNORE `prompt=none`: instead of an OIDC error redirect back to our
    // callback (`?error=login_required`), they serve their HTML login page
    // with HTTP 200 and no OIDC parameter. The popup then lands on a page that
    // is NOT our callback, so the response carries neither `code` nor `error`.
    // `validateAuthResponse` would surface that as an opaque "missing response
    // parameter" error the classifier below never matches — so on the SILENT
    // path we detect it FIRST, by response SHAPE (not by hostname — any other
    // server that ignores prompt=none behaves the same), and treat it as an
    // IMPLICIT `interaction_required`: fall through to the interactive retry in
    // the same window instead of hanging or surfacing a raw error.
    //
    // Scoped to `silentFirst`: a GENUINE interactive login that lands on the
    // IdP's HTML is expected (the user types credentials there) and must NOT be
    // reclassified — that path runs with `mode === "interactive"`.
    if (silentFirst && isNonCallbackResponse(authorizationCodeResponse)) {
      authorizationCodeParams = await interactiveRetry();
    } else {
      try {
        authorizationCodeParams = oauth.validateAuthResponse(
          authorizationServer,
          clientRegistration,
          new URL(authorizationCodeResponse),
          state,
        );
      } catch (e) {
        if (
          silentFirst &&
          ((e instanceof oauth.AuthorizationResponseError &&
            (e.error === "interaction_required" ||
              e.error === "consent_required" ||
              e.error === "login_required")) ||
            isEssMissingIssInteractionNeeded(e))
        ) {
          // The IdP needs the user to interact: retry once without `prompt=none`.
          authorizationCodeParams = await interactiveRetry();
        } else {
          throw e;
        }
      }
    }

    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      authorizationServer,
      clientRegistration,
      this.#clientAuth(authorizationServer.issuer, clientRegistration),
      authorizationCodeParams,
      this.#callbackUri,
      usePkce ? codeVerifier : oauth.nopkce,
      { DPoP: dpop, ...http },
    );
    const tokenResult = await oauth.processAuthorizationCodeResponse(
      authorizationServer,
      clientRegistration,
      tokenResponse,
      { expectedNonce: this.#nonceVerification(authorizationServer.issuer, nonce) },
    );

    return {
      authorizationServer,
      clientRegistration,
      dpopKey,
      dpopHandle: dpop,
      accessToken: tokenResult.access_token,
      refreshToken: tokenResult.refresh_token,
      expiresAt: expiresAt(tokenResult),
      webId: webIdFromIdToken(oauth.getValidatedIdTokenClaims(tokenResult)),
    };
  }

  /**
   * Resolve the OAuth client used for this issuer.
   *
   * - **Static (a Client Identifier Document):** when `clientId` is set, return a
   *   public {@link oauth.Client} whose `client_id` IS that URL, with
   *   `token_endpoint_auth_method: "none"`. No network call is made here — the OP
   *   dereferences the document itself at the authorization/token endpoints and
   *   matches the redirect_uri against the document's `redirect_uris`. The
   *   document must therefore list this provider's `callbackUri`. `redirect_uris`
   *   and `response_types` are seeded locally so the shared URL-building code
   *   below has the values it needs.
   * - **Dynamic (the default):** dynamic client registration, exactly as the
   *   published provider does — a throwaway client per session, no stable name.
   */
  async #resolveClient(
    authorizationServer: oauth.AuthorizationServer,
    http: { signal: AbortSignal; [oauth.allowInsecureRequests]?: true },
  ): Promise<oauth.Client> {
    if (this.#clientId !== undefined) {
      // A public browser client identified by a dereferenceable URL. `oauth.Client`
      // requires only `client_id`; the rest are accepted via its index signature
      // and consumed by the shared authorization-URL builder below.
      return {
        client_id: this.#clientId,
        token_endpoint_auth_method: "none",
        redirect_uris: [this.#callbackUri],
        response_types: ["code"],
      };
    }
    const registrationResponse = await oauth.dynamicClientRegistrationRequest(
      authorizationServer,
      {
        redirect_uris: [this.#callbackUri],
        // Register for refresh tokens where supported (mirrors the static
        // Client Identifier Document, which declares both grants).
        ...(authorizationServer.grant_types_supported?.includes("refresh_token")
          ? { grant_types: ["authorization_code", "refresh_token"] }
          : {}),
      },
      http,
    );
    return oauth.processDynamicClientRegistrationResponse(registrationResponse);
  }

  /** Client authentication, mirroring the published provider's ESS workaround. */
  #clientAuth(issuer: string, client: oauth.Client): oauth.ClientAuth {
    if (client.token_endpoint_auth_method === "client_secret_basic") {
      return clientSecretBasicFor(issuer)(client.client_secret as string);
    }
    return oauth.None();
  }

  /** Some servers (NSS/ESS variants) omit the nonce; expect none for them. */
  #nonceVerification(issuer: string, nonce: string): string | typeof oauth.expectNoNonce {
    if (issuer === "https://datapod.igrant.io" || issuer === "https://solidweb.org") {
      return oauth.expectNoNonce;
    }
    return nonce;
  }
}

/**
 * The authenticated WebID stated by the ID token: the `webid` claim
 * (Solid-OIDC §5), falling back to `sub` when it is an http(s) URL (the NSS
 * convention). `undefined` when the token states neither — issuer-first
 * logins then fail with clear copy rather than guessing.
 */
function webIdFromIdToken(
  claims: oauth.IDToken | undefined,
): string | undefined {
  if (claims === undefined) return undefined;
  const webid = claims.webid;
  if (typeof webid === "string" && /^https?:\/\//.test(webid)) return webid;
  if (/^https?:\/\//.test(claims.sub)) return claims.sub;
  return undefined;
}

/**
 * Whether a failed token-endpoint request was an OAuth `invalid_grant` — the
 * refresh token is dead (expired / revoked / rotation-reuse), so proactive
 * scheduling must STOP rather than retry. oauth4webapi surfaces this as a
 * `ResponseBodyError` whose `.error` is `"invalid_grant"`; we also probe the
 * nested `cause.parameters` shape some paths carry. Anything else is treated as
 * transient (network, 5xx, …) and retried with backoff.
 */
function isInvalidGrant(e: unknown): boolean {
  if (e instanceof oauth.ResponseBodyError && e.error === "invalid_grant") {
    return true;
  }
  try {
    return (
      (e as { error?: unknown }).error === "invalid_grant" ||
      (e as { cause: { parameters: URLSearchParams } }).cause.parameters.get(
        "error",
      ) === "invalid_grant"
    );
  } catch {
    return false;
  }
}

/**
 * Whether a `getCode` result is NOT a usable OIDC authorization response — the
 * popup landed somewhere OTHER than our callback redirect. True when the string
 * does not parse as a URL, or parses to a URL carrying neither a `code` nor an
 * `error` query parameter (an authorization response MUST carry one or the
 * other; RFC 6749 §4.1.2 / §4.1.2.1). This is the SHAPE of a server ignoring
 * `prompt=none` and serving its HTML login page (NSS, Trinpod) — detected
 * server-agnostically, never by hostname. Used ONLY on the silent path, to
 * reclassify such a landing as an implicit `interaction_required`.
 */
function isNonCallbackResponse(response: string): boolean {
  let url: URL;
  try {
    url = new URL(response);
  } catch {
    return true;
  }
  return (
    !url.searchParams.has("code") &&
    !url.searchParams.has("error") &&
    !new URLSearchParams(url.hash.replace(/^#/, "")).has("code") &&
    !new URLSearchParams(url.hash.replace(/^#/, "")).has("error")
  );
}

function isEssMissingIssInteractionNeeded(e: unknown): boolean {
  try {
    return (
      (e as { cause: { parameters: URLSearchParams } }).cause.parameters.get(
        "error",
      ) === "interaction_required"
    );
  } catch {
    return false;
  }
}

/**
 * A variant of oauth4webapi's ClientSecretBasic that does NOT url-encode id and
 * secret — PodSpaces (ESS) fails when the spec is followed.
 * @see https://www.rfc-editor.org/rfc/rfc6749.html#section-2.3.1
 */
function noUrlEncodeClientSecretBasic(clientSecret: string): oauth.ClientAuth {
  return (_as, client, _body, headers) => {
    headers.set(
      "Authorization",
      `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`,
    );
  };
}

function clientSecretBasicFor(issuer: string): (secret: string) => oauth.ClientAuth {
  if (issuer.includes("login.inrupt.com")) return noUrlEncodeClientSecretBasic;
  return oauth.ClientSecretBasic;
}
