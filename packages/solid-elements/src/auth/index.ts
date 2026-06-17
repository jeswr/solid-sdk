// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-elements/auth — the OPTIONAL adapter that wires the real auth
// stack (@solid/reactive-authentication + @jeswr/solid-session-restore +
// oauth4webapi + dpop) into a LoginController for <jeswr-login-panel>.
//
// IT LIVES IN A SEPARATE SUBEXPORT ON PURPOSE. The core @jeswr/solid-elements
// entry has ZERO auth runtime deps and a self-contained committed `dist/` (the
// GitHub-installable contract under `ignore-scripts=true`). Only consumers who
// `import { createReactiveAuthController } from "@jeswr/solid-elements/auth"`
// pull in the auth dependencies. ⚠️ INSTALL CONTRACT (read the README "Auth deps"
// section): this subexport's deps include the OFF-NPM `@jeswr/solid-session-restore`
// (github:-installed) and `@solid/reactive-authentication` — they are OPTIONAL
// peerDependencies, so a consumer using `/auth` must install them explicitly. The
// core components (theme toggle, account menu, …) and even <jeswr-login-panel>
// itself with a CUSTOM LoginController do NOT need them.
//
// ─── SECURITY MODEL (this composes a credential-redeeming flow — be exhaustive) ─
//
// THE TWO-FETCH BOUNDARY (the credential-leak boundary the panel exposes):
//   • publicFetch        — the pristine native fetch snapshotted at MODULE LOAD
//                          (MODULE_PRISTINE_FETCH), i.e. before any
//                          ReactiveFetchManager `registerGlobally` could patch the
//                          global — NOT re-read from the (possibly already-patched)
//                          global at construction. NO session, never upgrades on a
//                          401. The foreign-origin / public-read path. A consumer
//                          constructing after the global was already patched can
//                          inject a known-pristine fetch via `options.publicFetch`.
//   • authenticatedFetch — a CONTROLLER-OWNED wrapper over the known-pristine
//                          publicFetch (NOT ReactiveFetchManager.fetch, which
//                          captures globalThis.fetch at construction and could route
//                          through a global another controller patched). It attaches
//                          the user's DPoP-bound token on a 401 from an allowed
//                          origin and retries. By DEFAULT we do NOT patch the global,
//                          so the global `fetch` stays pristine; opting into
//                          `patchGlobalFetch: true` additionally upgrades bare
//                          `fetch()` callers via a ReactiveFetchManager.
//
// LOGIN persists, on success, the DPoP-bound refresh token + the non-extractable
// ES256 key into the issuer-keyed IndexedDB store, so SILENT RESTORE on the next
// load can rebuild the session with a `refresh_token` grant (a token-endpoint
// fetch — never a popup/iframe). All the security invariants of
// @jeswr/solid-session-restore apply (WebID-scoped isolation, asymmetric-only,
// non-extractable key, clear-only-on-invalid_grant, fail-closed).
//
// The interactive authorization-code + PKCE + DPoP flow is built on oauth4webapi
// directly (the same primitive both packages use) and drives the
// <authorization-code-flow> element's `getCode` for the popup step — we extend
// the published DPoPTokenProvider flow with `offline_access` (so a refresh token
// is issued) + persistence, which the stock provider does not do.

import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  type CredentialPresence,
  decideSilentRestore,
  hasPersisted,
  IndexedDbSessionStore,
  indexedDbAvailable,
  type PersistedSession,
  RememberedAccount,
  type RememberedAccountRecord,
  restoreSession,
  type SessionStore,
  shouldDropRememberedPointer,
  webIdsEqual,
} from "@jeswr/solid-session-restore";
import { Agent } from "@solid/object";
import type { AuthorizationCodeFlow, GetCodeCallback } from "@solid/reactive-authentication";
import * as DPoP from "dpop";
import { DataFactory } from "n3";
import * as oauth from "oauth4webapi";
import type {
  LoginController,
  LoginResult,
  RecentLoginAccount,
  RestoreOutcome,
} from "../login-controller.js";

/**
 * The PRISTINE native fetch, snapshotted ONCE at MODULE LOAD — before any
 * ReactiveFetchManager (or another controller's `registerGlobally`) can patch the
 * global. This is the credential-leak boundary's anchor: a controller's
 * `publicFetch` defaults to THIS snapshot, NOT to a re-read of the (possibly
 * already-patched) `globalThis.fetch` at construction time. Importing this `/auth`
 * module before constructing any auth (the normal order) guarantees this is the
 * original, non-upgrading fetch even if a LATER controller patches the global. A
 * consumer who imports this module after the global was already patched can inject a
 * known-pristine fetch via {@link ReactiveAuthControllerOptions.publicFetch}.
 */
const MODULE_PRISTINE_FETCH: typeof fetch | undefined =
  typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : undefined;

/**
 * The reactive-auth TokenProvider structural contract. @solid/reactive-authentication
 * 0.1.3 does NOT re-export the `TokenProvider` TYPE from its entrypoint (only the
 * concrete providers), so — exactly as the suite's reference code does — we restate
 * the tiny, stable structural shape. `ReactiveFetchManager` accepts any
 * `Iterable<TokenProvider>` and matches structurally.
 */
interface TokenProvider {
  matches(request: Request): Promise<boolean>;
  upgrade(request: Request): Promise<Request>;
}

/** oauth4webapi HTTP options shape (signal + loopback-insecure allowance). */
type OauthHttpOptions = {
  signal?: AbortSignal;
  [oauth.allowInsecureRequests]?: true;
};

/** A WebID's profile advertises several OIDC issuers; the host must choose one. */
export class AmbiguousIssuerError extends Error {
  readonly webId: string;
  readonly issuers: string[];
  constructor(webId: string, issuers: string[]) {
    super(
      `This WebID advertises ${issuers.length} OIDC issuers — supply a 'chooseIssuer' ` +
        `callback so the user can pick one (${webId}).`,
    );
    this.name = "AmbiguousIssuerError";
    this.webId = webId;
    this.issuers = issuers;
  }
}

/** A WebID's profile has no `solid:oidcIssuer` — it cannot be used for Solid login. */
export class NoSolidIssuerError extends Error {
  readonly webId: string;
  constructor(webId: string) {
    super(`This WebID has no solid:oidcIssuer, so it can't be used for Solid login (${webId}).`);
    this.name = "NoSolidIssuerError";
    this.webId = webId;
  }
}

/** The supplied input is not a usable WebID URL. */
export class InvalidWebIdError extends Error {
  constructor(input: string, reason: string) {
    super(`Not a valid WebID (${reason}): ${input}`);
    this.name = "InvalidWebIdError";
  }
}

/**
 * `login()` was called but no `authFlow` (the interactive popup driver) was supplied
 * at construction. `authFlow` is OPTIONAL — a restore-only consumer can omit it — but
 * the INTERACTIVE login flow needs it to drive the authorization-code popup. Construct
 * the controller with an `authFlow` to use `login()`.
 */
export class MissingAuthFlowError extends Error {
  constructor() {
    super(
      "login() requires an 'authFlow' (the interactive popup driver), but none was " +
        "supplied to createReactiveAuthController. Pass options.authFlow to enable " +
        "interactive login. (Silent restore via restore() does not need it.)",
    );
    this.name = "MissingAuthFlowError";
  }
}

/** Pick one issuer from several advertised on a profile (the user chooses). */
export type ChooseIssuerCallback = (issuers: string[], webId: string) => Promise<string>;

/** Options for {@link createReactiveAuthController}. */
export interface ReactiveAuthControllerOptions {
  /**
   * The <authorization-code-flow> element (or anything exposing a compatible
   * `getCode(authUri, signal)`), which drives the interactive popup.
   *
   * OPTIONAL: it is needed ONLY by interactive {@link LoginController.login}. A
   * RESTORE-ONLY consumer (one that constructs the controller purely to silently
   * restore a persisted session on load, never calling `login()`) does not need a
   * popup driver and may omit it. Calling `login()` WITHOUT an `authFlow` throws a
   * targeted {@link MissingAuthFlowError} so the misconfiguration is clear.
   */
  authFlow?: Pick<AuthorizationCodeFlow, "getCode"> | { getCode: GetCodeCallback };
  /**
   * The OAuth redirect/callback URI this client is registered with. Must be the
   * page that does `opener.postMessage(location.href)` (see the reactive-auth
   * skill) and must be listed in the Client Identifier Document when {@link clientId}
   * is set.
   */
  callbackUri: string;
  /**
   * A Solid-OIDC Client Identifier Document URL. When set, login + restore run as
   * a public client whose `client_id` IS this URL (stable consent-screen name).
   * When absent, dynamic client registration is used (dev fallback; throwaway).
   */
  clientId?: string;
  /**
   * Pick an issuer when a profile advertises several. Default: throw
   * {@link AmbiguousIssuerError} (never silently pick the first); a single issuer
   * is always used directly.
   */
  chooseIssuer?: ChooseIssuerCallback;
  /**
   * The IndexedDB database name for the persisted-session store. MUST be unique
   * per app on a shared origin. Defaults to a generic name; pass your app's.
   */
  dbName?: string;
  /**
   * The localStorage key for the SILENT-RESTORE pointer (the single last-active
   * WebID→issuer pointer that selects which issuer to restore on load). App-specific.
   * Cleared on logout. Distinct from the recent-accounts list below.
   */
  rememberedAccountsKey?: string;
  /**
   * The localStorage key for the RECENT-ACCOUNTS list — the credential-free history
   * of previously-used WebIDs (most-recent-first, deduplicated) powering the
   * returning-user affordance. This list SURVIVES logout (logout clears the session +
   * the restore pointer, NOT the account memory). App-specific; defaults to a generic
   * name derived from {@link rememberedAccountsKey} when omitted.
   */
  recentAccountsKey?: string;
  /**
   * Allow oauth4webapi insecure requests for `localhost`/`127.0.0.1` issuers only
   * (dev CSS over HTTP). Remote HTTPS issuers stay strict. Default false.
   */
  allowInsecureLoopback?: boolean;
  /**
   * Patch `globalThis.fetch` so EVERY plain `fetch` upgrades on 401 (reactive-auth's
   * default mode). Default FALSE here — we keep the global pristine so `publicFetch`
   * is unambiguously credential-free, and the authenticated path is the explicit
   * `authenticatedFetch` handle. Opt in only if a third-party lib that captured the
   * global must transparently authenticate.
   */
  patchGlobalFetch?: boolean;
  /**
   * The resource ORIGINS the session's DPoP-bound token may be attached to (the
   * credential boundary). `authenticatedFetch` upgrades a 401 ONLY for a request
   * whose origin is in the allowed set; every other origin is left UNAUTHENTICATED
   * (fail-closed), so the user's token is never sent to a foreign origin even if a
   * caller accidentally routes a cross-origin request through `.fetch`.
   *
   * The effective allowed set is the UNION of these explicit origins PLUS, by
   * default, the authenticated WebID's own origin and the issuer's origin (the
   * common case: a user's pod is served from their WebID's origin). Set
   * {@link includeWebIdOrigin}/{@link includeIssuerOrigin} to `false` to drop those
   * defaults and rely solely on this list. Each entry is compared by URL `origin`
   * (scheme + host + port); a non-URL entry is ignored. When the resulting set is
   * EMPTY the provider attaches the token to NOTHING (strictly fail-closed).
   *
   * Pods on a DIFFERENT host than the WebID (a valid Solid topology) MUST be listed
   * here — otherwise their 401s will not be authenticated.
   */
  allowedOrigins?: string[];
  /** Include the authenticated WebID's origin in the allowed set. Default true. */
  includeWebIdOrigin?: boolean;
  /** Include the issuer's origin in the allowed set. Default true. */
  includeIssuerOrigin?: boolean;
  /**
   * The session store implementation. Defaults to an {@link IndexedDbSessionStore}
   * (or an in-memory no-op when IndexedDB is unavailable). Test seam.
   */
  store?: SessionStore;
  /**
   * Override the fetch used to dereference the public WebID profile. Defaults to
   * the pristine `publicFetch` (captured before any patching) — the profile read
   * stays provably out of the reactive-auth loop. Test seam.
   */
  profileFetch?: typeof fetch;
  /**
   * Inject a KNOWN-PRISTINE native fetch to use as `publicFetch` (the credential-
   * free / foreign-origin boundary). By default the controller uses the snapshot
   * this module took at LOAD time (before any patching). Pass this ONLY if you are
   * constructing the controller after the global `fetch` was already patched and you
   * hold a reference to the original — otherwise the default is correct and safer.
   */
  publicFetch?: typeof fetch;
}

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** Refresh this far before the reported expiry, to absorb clock skew + RTT. */
const EXPIRY_SKEW_MS = 30_000;

/** Epoch ms the access token should be treated as expired, or undefined when none. */
function expiresAtFrom(expiresIn: number | undefined): number | undefined {
  return expiresIn === undefined ? undefined : Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS;
}

/** How {@link computeAllowedOrigins} derives the default WebID/issuer origins. */
export interface AllowedOriginsInputs {
  /** Explicit allowed resource origins (any URL; compared by `origin`). */
  allowedOrigins?: string[];
  /** The authenticated WebID (its origin is included unless disabled). */
  webId?: string;
  /** The issuer URL (its origin is included unless disabled). */
  issuer?: string;
  /** Include the WebID's origin. Default true. */
  includeWebIdOrigin?: boolean;
  /** Include the issuer's origin. Default true. */
  includeIssuerOrigin?: boolean;
  /**
   * Allow `http:` origins for LOOPBACK hosts only (dev). Default false: every
   * non-`https:` origin is dropped, so the token is never attached over cleartext.
   */
  allowInsecureLoopback?: boolean;
}

/**
 * The set of resource origins a session token may be attached to — the credential
 * boundary the token provider enforces. PURE + exported so the boundary is
 * unit-tested. CLEARTEXT GUARD: a non-`https:` origin is DROPPED (so a configured
 * `http:` allowedOrigin can't make the DPoP token ride over cleartext), EXCEPT a
 * loopback `http:` origin when `allowInsecureLoopback` is set (dev). Fail-closed: an
 * unparseable entry is skipped; an empty result means the token is attached to NOTHING.
 */
export function computeAllowedOrigins(inputs: AllowedOriginsInputs): ReadonlySet<string> {
  const origins = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value) return;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return; // unparseable → not allowed (fail-closed)
    }
    if (url.protocol === "https:") {
      origins.add(url.origin);
    } else if (
      url.protocol === "http:" &&
      inputs.allowInsecureLoopback &&
      isLoopback(url.hostname)
    ) {
      origins.add(url.origin); // dev loopback only, under the explicit opt-in
    }
    // every other scheme (incl. non-loopback http) is dropped — no cleartext token
  };
  for (const o of inputs.allowedOrigins ?? []) add(o);
  if (inputs.includeWebIdOrigin !== false) add(inputs.webId);
  if (inputs.includeIssuerOrigin !== false) add(inputs.issuer);
  return origins;
}

/**
 * Whether a request URL targets an allowed origin (the per-request credential
 * gate). PURE + exported. Fail-closed: an unparseable URL is never allowed.
 */
export function isOriginAllowed(allowed: ReadonlySet<string>, requestUrl: string): boolean {
  try {
    return allowed.has(new URL(requestUrl).origin);
  } catch {
    return false;
  }
}

/**
 * The DPoP `htu` claim for a request URL — the request URI WITHOUT its query and
 * fragment (RFC 9449 §4.2). PURE + exported. If the URL is unparseable it is
 * returned unchanged (the proof generator then sees the raw string).
 */
export function htuOf(requestUrl: string): string {
  try {
    const u = new URL(requestUrl);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return requestUrl;
  }
}

/**
 * Whether a 401 response is a PURE DPoP-nonce challenge — i.e. its `WWW-Authenticate`
 * carries the DPoP scheme with `error="use_dpop_nonce"` (RFC 9449 §8). PURE + exported
 * for testing.
 *
 * This is deliberately CONSERVATIVE: it returns true ONLY when the server explicitly
 * says the token was fine and only the nonce was missing. Any OTHER error (e.g.
 * `invalid_token`, expired/revoked) — or no DPoP `error` token at all — returns false,
 * so the caller force-refreshes the access token instead of looping on a stale one even
 * when the server ALSO rotated the `DPoP-Nonce`. We match the `DPoP` auth-scheme
 * challenge specifically; a `Bearer …` challenge that happens to mention the string is
 * not treated as a DPoP nonce challenge.
 */
export function isUseDpopNonceChallenge(response: Response): boolean {
  const header = response.headers.get("WWW-Authenticate");
  if (!header) return false;
  // A `WWW-Authenticate` value can carry MULTIPLE challenges (RFC 9110 §11.6.1), e.g.
  // `Bearer error="invalid_token", DPoP error="use_dpop_nonce"`, and even MULTIPLE DPoP
  // challenges. We inspect ONLY the TOP-LEVEL `error` auth-param of the `DPoP` challenges —
  // reading `error=` from another scheme's challenge, or from INSIDE a quoted value, would
  // wrongly classify a DPoP `invalid_token` as a pure nonce challenge.
  //
  // UNAMBIGUOUS-NONCE rule (the roborev finding): return true only when the DPoP challenge
  // set is nonce-ONLY — at least one DPoP challenge says `use_dpop_nonce` AND no DPoP
  // challenge reports a DIFFERENT error. If ANY DPoP challenge carries a non-nonce error
  // (invalid_token / expired / revoked), the token may be stale, so we must NOT skip the
  // forced refresh — return false (force-refresh) even if another DPoP challenge mentions a
  // nonce.
  let sawNonce = false;
  for (const challenge of parseWwwAuthenticate(header)) {
    if (challenge.scheme.toLowerCase() !== "dpop") continue;
    const error = challenge.params.get("error")?.toLowerCase();
    if (error === undefined) continue; // a DPoP challenge with no error is not a signal
    if (error === "use_dpop_nonce") sawNonce = true;
    else return false; // a DPoP challenge with a DIFFERENT error → ambiguous → force refresh
  }
  return sawNonce;
}

/**
 * Parse a `WWW-Authenticate` header into its individual challenges, each with its scheme
 * and a QUOTE-AWARE map of its top-level auth-params. PURE + exported for testing.
 *
 * The grammar (RFC 9110 §11.6.1) is comma-ambiguous: commas separate BOTH auth-params
 * within a challenge AND challenges from each other; auth-params allow optional whitespace
 * around `=` (BWS); and a quoted value may itself contain commas/`=`/scheme-like words. We
 * scan character-by-character into ATOMS (a bare word, a quoted string, or a standalone
 * `=`), tracking quoted strings (with `\`-escapes), then walk the atoms: a `word [=] value`
 * triple (tolerating BWS) is an auth-param attributed to the current challenge; a lone word
 * NOT followed by `=` starts a NEW challenge (a scheme / token68). Param VALUES are unquoted
 * (quotes stripped, escapes resolved). Odd input degrades safely (the caller is
 * conservative — only an UNAMBIGUOUS DPoP `error="use_dpop_nonce"` is acted on).
 */
export function parseWwwAuthenticate(
  header: string,
): { scheme: string; params: Map<string, string> }[] {
  // ── Tokenise into atoms ──────────────────────────────────────────────────────────
  // Each atom is { kind: "word" | "quoted" | "eq", text }. Whitespace + commas separate
  // atoms (commas are not otherwise significant — challenge boundaries are inferred from
  // the word-not-followed-by-`=` rule, which is robust to the comma ambiguity). `=` OUTSIDE
  // quotes is its own atom so BWS around it (`error = "x"`) parses correctly.
  type Atom = { kind: "word" | "quoted"; text: string } | { kind: "eq" };
  const atoms: Atom[] = [];
  let buf = "";
  let bufIsQuoted = false;
  let inQuotes = false;
  const flush = () => {
    if (buf || bufIsQuoted) {
      atoms.push({ kind: bufIsQuoted ? "quoted" : "word", text: buf });
      buf = "";
      bufIsQuoted = false;
    }
  };
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (inQuotes) {
      if (c === "\\" && i + 1 < header.length) {
        buf += header[i + 1];
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        buf += c;
      }
      continue;
    }
    if (c === '"') {
      // A quoted string is ALWAYS a value atom (even if it abuts a preceding word with no
      // space). Flush any pending bare word first.
      flush();
      inQuotes = true;
      bufIsQuoted = true;
    } else if (c === "=") {
      flush();
      atoms.push({ kind: "eq" });
    } else if (c === "," || c === " " || c === "\t") {
      flush();
    } else {
      buf += c;
    }
  }
  flush();

  // ── Walk atoms into challenges ───────────────────────────────────────────────────
  const challenges: { scheme: string; params: Map<string, string> }[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (atom.kind === "eq") continue; // a stray `=` with no preceding key — ignore
    if (atom.kind === "quoted") {
      // A bare quoted string with no `key =` before it — not a valid challenge/param; skip.
      continue;
    }
    // A WORD: it is an auth-param key iff the NEXT non-trivial atom is `=`.
    if (atoms[i + 1]?.kind === "eq") {
      const valueAtom = atoms[i + 2];
      const value = valueAtom && valueAtom.kind !== "eq" ? valueAtom.text : "";
      if (challenges.length > 0) {
        challenges[challenges.length - 1].params.set(atom.text.toLowerCase(), value);
      }
      i += 2; // consume `= value`
    } else {
      // A lone word NOT followed by `=` → a scheme (or token68) starting a NEW challenge.
      challenges.push({ scheme: atom.text, params: new Map() });
    }
  }
  return challenges;
}

/**
 * The result of {@link ReactiveAuthController.#persist}: `wrote` = a credential for the
 * current session was actually stored (so this-page refresh works, true even for the
 * in-memory fallback); `durable` = it will survive a reload (restorable next load —
 * additionally requires a durable store). See `#persist` for why the two are distinct.
 */
interface PersistResult {
  wrote: boolean;
  durable: boolean;
}

/** Per-issuer in-memory live session (NOT persisted beyond the refresh token). */
interface LiveSession {
  /**
   * The controller generation that CREATED this session (login / restore). A refresh
   * uses THIS — not the current generation — so a refresh of a SUPERSEDED session
   * writes under a stale generation (skipped by the guarded store) and never
   * overwrites a newer login's credential (the roborev race).
   */
  generation: number;
  issuer: URL;
  webId: string;
  /** The current access token — REPLACED in place when refreshed (see #refresh). */
  accessToken: string;
  dpopKey: CryptoKeyPair;
  dpopHandle: oauth.DPoPHandle;
  authorizationServer: oauth.AuthorizationServer;
  client: oauth.Client;
  /**
   * The resource ORIGINS this session's token may be attached to (the credential
   * boundary the provider enforces). Computed once at session creation from the
   * options + the WebID/issuer origins. Empty = attach to nothing (fail-closed).
   */
  allowedOrigins: ReadonlySet<string>;
  /**
   * Epoch ms the access token is treated as expired (server `expires_in` minus a
   * skew), or undefined when the OP reported no lifetime. Drives proactive refresh
   * in {@link PersistingDPoPTokenProvider.upgrade}.
   */
  expiresAt?: number;
  /**
   * The DPoP-bound refresh token, present only between {@link #authenticate} and
   * {@link #persist} (it is written to the durable store, never kept in memory for
   * the session lifetime, and never logged).
   */
  refreshToken?: string;
}

/** An in-memory SessionStore fallback so the controller works with no IndexedDB. */
class MemorySessionStore implements SessionStore {
  /**
   * BRAND: this fallback store is NON-DURABLE — it lives only for the page lifetime, so
   * a credential "persisted" here cannot survive a reload. The controller checks this so
   * it does NOT write the silent-restore pointer for an in-memory put (which would make
   * the next load attempt — and fail — a restore that has nothing behind it; the roborev
   * finding). An INJECTED `options.store` is assumed durable (the consumer's contract).
   */
  readonly durable = false as const;
  readonly #map = new Map<string, PersistedSession>();
  async get(issuer: string): Promise<PersistedSession | undefined> {
    return this.#map.get(issuer);
  }
  async put(session: PersistedSession): Promise<void> {
    this.#map.set(session.issuer, session);
  }
  async delete(issuer: string): Promise<void> {
    this.#map.delete(issuer);
  }
}

/**
 * The credential-free RECENT-ACCOUNTS list (most-recent-first, deduplicated by WebID),
 * backed by localStorage under an app-specific key. Holds NO credential — only the
 * public WebID + chosen issuer — and SURVIVES logout by design (logout clears the
 * session + the silent-restore pointer, not the account memory). Every method degrades
 * safely when localStorage is unavailable/throwing (private mode / SSR / quota).
 */
const MAX_RECENT_ACCOUNTS = 8;
class RecentAccountsList {
  readonly #key: string;
  constructor(key: string) {
    this.#key = key;
  }
  list(): RecentLoginAccount[] {
    try {
      const raw = globalThis.localStorage?.getItem(this.#key) ?? null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // NORMALISE each entry to a well-typed RecentLoginAccount: a valid string webId
      // is required; displayName defaults to the webId and avatarUrl is kept only when
      // it is a string. A corrupt / older record (non-string displayName/avatarUrl)
      // must never reach the renderer and throw — that would block the login prompt.
      const out: RecentLoginAccount[] = [];
      for (const a of parsed) {
        if (typeof a !== "object" || a === null) continue;
        const rec = a as { webId?: unknown; displayName?: unknown; avatarUrl?: unknown };
        if (typeof rec.webId !== "string" || rec.webId.length === 0) continue;
        out.push({
          webId: rec.webId,
          displayName: typeof rec.displayName === "string" ? rec.displayName : rec.webId,
          ...(typeof rec.avatarUrl === "string" ? { avatarUrl: rec.avatarUrl } : {}),
        });
      }
      return out;
    } catch {
      return [];
    }
  }
  /** Add or refresh an account, moving it to the front. Best-effort. */
  remember(account: RecentLoginAccount): void {
    try {
      const rest = this.list().filter((a) => a.webId !== account.webId);
      globalThis.localStorage?.setItem(
        this.#key,
        JSON.stringify([account, ...rest].slice(0, MAX_RECENT_ACCOUNTS)),
      );
    } catch {
      // Non-fatal — the returning-account affordance just won't remember this one.
    }
  }
}

/**
 * Build a {@link LoginController} that wires @solid/reactive-authentication +
 * @jeswr/solid-session-restore for <jeswr-login-panel>. Constructing this captures
 * the pristine native fetch BEFORE the ReactiveFetchManager exists, so `publicFetch`
 * is guaranteed credential-free.
 */
export function createReactiveAuthController(
  options: ReactiveAuthControllerOptions,
): LoginController {
  return new ReactiveAuthController(options);
}

class ReactiveAuthController implements LoginController {
  /**
   * The pristine, credential-free fetch — the foreign-origin boundary. We DO NOT
   * re-read the (possibly already-patched) `globalThis.fetch` at construction; we use
   * the explicitly injected {@link ReactiveAuthControllerOptions.publicFetch}, else
   * the module-load snapshot taken before any patching. A last-resort rejecting fetch
   * is only ever reached in a non-DOM env with no fetch at all (never returns a
   * possibly-patched global as "publicFetch").
   */
  readonly #publicFetch: typeof fetch;
  readonly #profileFetch: typeof fetch;
  readonly #opts: ReactiveAuthControllerOptions;
  readonly #store: SessionStore;
  /**
   * Whether {@link #store} actually SURVIVES a reload. The built-in in-memory fallback
   * (used when IndexedDB is unavailable) does NOT, so a "successful" put to it must not
   * cause the silent-restore pointer to be written (the next load would attempt — and
   * fail — a restore with nothing behind it). An INJECTED store is assumed durable.
   */
  readonly #storeIsDurable: boolean;
  /**
   * The configured Client Identifier Document URL, NORMALIZED so an empty string is
   * treated as ABSENT (`undefined`). A `clientId: ""` would otherwise leak through
   * `??`-style fallbacks — e.g. #persist would store `""` instead of the server-assigned
   * dynamic client id, breaking later silent restore (the roborev finding). Read this
   * everywhere instead of `#opts.clientId` so the empty-string case is handled once.
   */
  readonly #clientId: string | undefined;
  readonly #remembered: RememberedAccount;
  readonly #recentAccounts: RecentAccountsList;

  // The token provider, built lazily so construction has no side effects until a
  // login/restore actually happens.
  #provider?: PersistingDPoPTokenProvider;
  // The STABLE controller-owned global `fetch` wrapper (created once when patchGlobalFetch
  // is enabled). Kept as a reference so we can RE-ASSERT it onto globalThis.fetch whenever
  // a session is (re)established — if another controller/library overwrote the global since
  // we installed it, the next login/restore re-installs OURS (the option's contract).
  #globalFetchWrapper?: typeof fetch;

  // The single live session (this controller is single-account at a time).
  #session?: LiveSession;
  /** Bumped on logout / new login so a stale async result is ignored. */
  #generation = 0;
  /**
   * The AbortController of the CURRENTLY in-flight interactive login (its popup). Tracked
   * on the instance so a NEWER login or a logout can abort it IMMEDIATELY — proactively
   * cancelling a still-open popup rather than waiting for getCode to return (the roborev
   * finding). Cleared when the attempt settles.
   */
  #activeLoginAbort?: AbortController;
  /**
   * The in-flight refresh / silent-restore GRANTS (restoreSession), each as its
   * AbortController + a `settled` promise. Two mechanisms protect the refresh-token-rotation
   * lifecycle (the roborev findings):
   *  - ABORT (logout, or a NON-blocking supersede): cancel the grant's token-endpoint
   *    request so the token isn't redeemed under a stale generation.
   *  - DRAIN-BEFORE-BUMP (login): before `login()` advances #generation, it ABORTS then
   *    AWAITS the in-flight grants to settle — so a grant the OP ALREADY processed despite
   *    the abort gets its rotation write to land under its STILL-VALID generation, instead
   *    of being generation-skipped (which would strand the prior session on a spent token if
   *    the new login later failed). The abort bounds the wait (the grant bails promptly).
   * Each grant adds itself on start and removes itself on settle.
   */
  readonly #activeGrants = new Set<{ abort: AbortController; settled: Promise<unknown> }>();

  constructor(options: ReactiveAuthControllerOptions) {
    this.#opts = options;
    // Normalize the Client Identifier once: an empty string means "no static client_id"
    // (use dynamic registration), same as undefined (the roborev finding).
    this.#clientId =
      options.clientId !== undefined && options.clientId !== "" ? options.clientId : undefined;
    this.#publicFetch =
      options.publicFetch ??
      MODULE_PRISTINE_FETCH ??
      ((() =>
        Promise.reject(
          new Error("No pristine fetch available in this environment"),
        )) as typeof fetch);
    this.#profileFetch = options.profileFetch ?? this.#publicFetch;
    this.#store =
      options.store ??
      (indexedDbAvailable()
        ? new IndexedDbSessionStore({ dbName: options.dbName })
        : new MemorySessionStore());
    // The built-in MemorySessionStore fallback is explicitly non-durable (it brands
    // itself `durable: false`); every other store (IndexedDB, or an injected one) is
    // treated as durable. Used to gate the silent-restore pointer (only point next-load
    // restore at a credential that can actually survive a reload).
    this.#storeIsDurable = (this.#store as { durable?: boolean }).durable !== false;
    this.#remembered = new RememberedAccount(options.rememberedAccountsKey);
    // The recent-accounts list is SEPARATE from the silent-restore pointer (it
    // survives logout). Default its key off the remembered key (or a generic name).
    this.#recentAccounts = new RecentAccountsList(
      options.recentAccountsKey ??
        `${options.rememberedAccountsKey ?? "solid-elements"}.recent-accounts`,
    );
  }

  get publicFetch(): typeof fetch {
    return this.#publicFetch;
  }

  get authenticatedFetch(): typeof fetch {
    // When LOGGED OUT (no live session) hand back the pristine, credential-free
    // fetch (the LoginController contract). While logged in, return OUR OWN
    // authenticated wrapper — built over the known-pristine #publicFetch, NOT
    // ReactiveFetchManager.fetch (which captures globalThis.fetch at construction
    // and could route through a global another controller patched, applying the
    // WRONG credentials — the roborev finding). The wrapper is fully controller-
    // owned: pristine fetch → on 401 from an allowed origin, our provider upgrades
    // and retries. The global is never read or patched (except the explicit
    // patchGlobalFetch opt-in, which only affects bare `fetch()` callers, not this).
    if (!this.#session) return this.#publicFetch;
    return this.#ownAuthenticatedFetch;
  }

  /**
   * The controller-owned authenticated fetch: run on the KNOWN-PRISTINE fetch and,
   * on a 401 from an allowed origin with a live session, attach the DPoP-bound token
   * (refreshing if expired) via the provider and retry ONCE. Never touches/reads the
   * global fetch, so it can't pick up another controller's patched global.
   */
  readonly #ownAuthenticatedFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    this.#authenticatedFetchOver(this.#publicFetch, input, init)) as typeof fetch;

  /**
   * The SINGLE authenticated-fetch implementation, run over an explicit `base` fetch.
   * Used by BOTH `.authenticatedFetch` (base = the known-pristine #publicFetch) AND the
   * `patchGlobalFetch` global wrapper (also base = #publicFetch, NOT the live global) —
   * so the global-patch path has the EXACT same credential boundary + DPoP-nonce handling
   * as the owned fetch, and crucially does NOT chain through a global another controller
   * patched (the roborev findings against the old ReactiveFetchManager path). For an
   * ALLOWED-origin request with a live session the token is attached PROACTIVELY (first
   * request, refreshing only on a KNOWN-passed expiry); a non-allowed origin / no session
   * is left unauthenticated (the foreign-origin boundary). RFC 9449 §8 resource-server
   * DPoP nonces are cached per-origin + embedded, and a 401 is retried ONCE.
   */
  async #authenticatedFetchOver(
    base: typeof fetch,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input as RequestInfo, init);
    const provider = this.#provider;
    if (provider && (await provider.matches(request))) {
      // Clone BEFORE the first fetch consumes the body: a 401 retry must replay the
      // body, but PUT/PATCH/POST request streams are single-use once fetched, so
      // re-upgrading the already-consumed request would send an empty/invalid body
      // (roborev finding). clone() tees the body stream — valid while bodyUsed is
      // false (i.e. pre-fetch); for bodyless GET/HEAD it is a cheap no-op.
      const retrySource = request.clone();
      // PROACTIVE attach (forceRefresh=false): refresh only if a KNOWN expiry passed.
      const upgraded = await provider.upgrade(request);
      const response = await base(upgraded);
      // RFC 9449 §8: capture any `DPoP-Nonce` the resource server returned (a
      // `use_dpop_nonce` 401 challenge OR a rotated nonce on a 2xx) so the NEXT proof
      // to this origin embeds it. `rememberNonce` reports whether it CHANGED.
      const nonceChanged = provider.rememberNonce(response, request);
      // If the proactively-attached token was REJECTED (401), retry once. Two reasons a
      // protected resource 401s: (a) the access token is stale → forceRefresh re-grants
      // it; (b) it REQUIRES a DPoP nonce we didn't have → we just cached it, so the
      // re-`upgrade` embeds it. Retry whenever the server SUPPLIED a (new) nonce too —
      // not only on `provider.matches` — so a `use_dpop_nonce` challenge against a
      // still-valid token is honoured. Retry from the pre-fetch clone (intact body).
      if (response.status === 401 && (nonceChanged || (await provider.matches(request)))) {
        // Decide whether to force-refresh on the retry. A PURE nonce challenge
        // (`WWW-Authenticate: DPoP error="use_dpop_nonce"`) means the TOKEN was fine —
        // only the nonce was missing — so re-using the (valid) token with the now-cached
        // nonce is right; burning a refresh-token grant would be wasteful. But if the
        // server's error is ANYTHING ELSE (invalid_token / expired / revoked, or no
        // explicit `use_dpop_nonce`), the token may genuinely be stale, so we MUST
        // force-refresh even though a `DPoP-Nonce` was ALSO present — otherwise a server
        // that rotates nonces while rejecting a dead token would loop on the stale token
        // and never redeem the refresh (the roborev finding). Default to force-refresh
        // unless it is UNAMBIGUOUSLY a pure-nonce challenge.
        const pureNonceChallenge = nonceChanged && isUseDpopNonceChallenge(response);
        const retried = await provider.upgrade(retrySource, !pureNonceChallenge);
        const retryResponse = await base(retried);
        // The RS may rotate the nonce again on the retry response — keep it current.
        provider.rememberNonce(retryResponse, request);
        return retryResponse;
      }
      return response;
    }
    // No session / not an allowed origin → unauthenticated (public) request.
    return base(request);
  }

  get webId(): string | null {
    return this.#session?.webId ?? null;
  }

  recentAccounts(): RecentLoginAccount[] {
    // From the SEPARATE recent-accounts list (credential-free, SURVIVES logout) — NOT
    // the silent-restore pointer (which logout clears). This is the returning-user
    // affordance, so it must persist across sign-out.
    return this.#recentAccounts.list();
  }

  #safeReadRemembered(): RememberedAccountRecord | null {
    try {
      return this.#remembered.read();
    } catch {
      return null;
    }
  }

  /**
   * Write the credential-free remembered pointer, SWALLOWING any storage error
   * (quota / private mode). This pointer is a convenience for next-load silent
   * restore — its write FAILING must NEVER make a SUCCESSFUL login/restore report
   * logged-out while the controller actually holds a live session (the roborev
   * finding). Worst case on failure: no silent restore next load (a re-login), never
   * an inconsistent reported state. (`RememberedAccount.write` already tries to
   * swallow, but we guard here too so the invariant doesn't depend on that.)
   */
  #safeWriteRemembered(webId: string, issuer: string): void {
    try {
      this.#remembered.write(webId, issuer);
    } catch {
      // Non-fatal — the live session stands; only silent restore next load is lost.
    }
  }

  /**
   * Controller-scoped SINGLE-FLIGHT restore. Two callers sharing ONE controller (e.g. two
   * panels, or a panel + an app on the same controller) must NOT run concurrent
   * refresh-token restores against the SAME stored credential: with refresh-token
   * ROTATION, one restore rotates the token, then the SECOND restore — having read the now
   * superseded old token — hits `invalid_grant` and DELETES the freshly-rotated credential,
   * leaving memory logged in but durable restore/refresh state wiped (the roborev race).
   * Sharing the in-flight promise makes concurrent callers observe ONE restore + result.
   */
  #restoreInFlightPromise?: Promise<RestoreOutcome>;
  async restore(): Promise<RestoreOutcome> {
    if (this.#restoreInFlightPromise) return this.#restoreInFlightPromise;
    const run = this.#doRestore();
    this.#restoreInFlightPromise = run;
    try {
      return await run;
    } finally {
      // Clear only if still ours (defensive — restore isn't re-entered, but mirror the
      // refresh single-flight pattern).
      if (this.#restoreInFlightPromise === run) this.#restoreInFlightPromise = undefined;
    }
  }

  async #doRestore(): Promise<RestoreOutcome> {
    // Fail-closed wrapper around the pure decision: ANY throw → login. Capture the
    // generation at entry: a newer login/logout that STARTS during this (awaited)
    // restore SUPERSEDES it, so this restore must NOT mutate the remembered pointer
    // afterward (it could erase the pointer a successful newer login just wrote — the
    // roborev race). Each post-await pointer mutation below is gated on `superseded`.
    const generation = this.#generation;
    const superseded = (): boolean => generation !== this.#generation;
    try {
      const record = this.#safeReadRemembered();
      const decision = await decideSilentRestore({
        lastActiveWebId: record?.webId,
        remembered: record ? [record] : [],
        // Pass the EXPECTED (remembered) WebID so #restoreIssuer only pins the session
        // AFTER confirming the restored WebID matches — so a mismatched credential is
        // never transiently exposed via controller.webId / authenticatedFetch during
        // the restore window (the roborev finding). decideSilentRestore also re-checks.
        restoreIssuer: (issuer) => this.#restoreIssuer(new URL(issuer), record?.webId),
        webIdsEqual,
      });
      // A newer login/logout superseded us during the grant: do NOT report the stale
      // restore decision (the controller may no longer expose that session). Report the
      // CURRENT controller state — restored iff a session is actually live now (e.g. a
      // concurrent login won), else login (e.g. a logout won). This keeps the reported
      // outcome consistent with what `.webId` / `.fetch` actually expose.
      if (superseded()) {
        const current = this.#session?.webId ?? null;
        return current !== null ? { outcome: "restored", webId: current } : { outcome: "login" };
      }
      if (decision.outcome === "restored") {
        // Re-confirm the pointer (issuer + WebID) on a successful restore. SAFE write:
        // a storage failure here must NOT turn a live restored session into a reported
        // "login" — the session is already pinned one layer down. Also refresh the
        // (logout-surviving) recent-accounts list.
        this.#safeWriteRemembered(decision.webId, decision.issuer);
        this.#recentAccounts.remember({ webId: decision.webId, displayName: decision.webId });
        return { outcome: "restored", webId: decision.webId };
      }
      // webid-mismatch: #restoreIssuer pinned the WRONG WebID one layer down — tear
      // down fail-closed. Local teardown FIRST + unconditionally (drop the in-memory
      // session, bump the generation, clear the remembered pointer), THEN the durable
      // delete — so even if the delete fails the next load won't silently restore the
      // known-bad pointer. Mirrors logout's fail-closed ordering.
      if (decision.reason === "webid-mismatch") {
        this.#session = undefined;
        this.#generation++;
        this.#safeClearRemembered();
        if (record?.issuer) {
          try {
            await this.#forget(new URL(record.issuer));
          } catch {
            // Unparseable issuer / store error — the local teardown above already
            // made us logged-out; the stale durable entry is DPoP-bound + harmless.
          }
        }
        return { outcome: "login" };
      }
      // Otherwise keep/drop the pointer per the pure matrix + tri-state presence.
      const presence: CredentialPresence = record?.issuer
        ? await hasPersisted(this.#store, new URL(record.issuer))
        : "absent";
      // Re-check supersession after the awaited hasPersisted: a newer login may have
      // written a fresh pointer that we must not clear.
      if (!superseded() && shouldDropRememberedPointer(decision.reason, presence)) {
        this.#safeClearRemembered();
      }
      return { outcome: "login" };
    } catch {
      return { outcome: "login" };
    }
  }

  /**
   * The thin restore wrapper the pure decision calls: redeem the persisted
   * refresh token for `issuer`, pin the rebuilt session in memory (so a later 401
   * upgrade reuses it), under the generation fence. Returns `{ webId }` or
   * undefined (nothing/dead/transient — all fail-closed in restoreSession).
   *
   * `expectedWebId` is the remembered WebID this restore is FOR: the session is pinned
   * ONLY after confirming the restored WebID matches it, so a mismatched credential is
   * never transiently exposed via `controller.webId` / `authenticatedFetch` during the
   * restore window. (decideSilentRestore also re-checks; this closes the pin-then-check
   * window.)
   */
  async #restoreIssuer(
    issuer: URL,
    expectedWebId: string | null | undefined,
  ): Promise<{ webId: string } | undefined> {
    const generation = this.#generation;
    // Guarded store: restoreSession's internal rotation-write is generation-guarded +
    // serialized (a logout during this restore can't be undone by a late put), AND it
    // reports whether that rotation `put` durably succeeded.
    const guarded = this.#guardedStore(generation);
    // Run the grant under a tracked AbortController so a login/logout that supersedes us
    // mid-grant cancels the token-endpoint request (the roborev finding) rather than
    // letting it redeem+rotate the refresh token under a stale generation.
    const restored = await this.#withGrantAbort((signal) =>
      restoreSession({
        store: guarded.store,
        issuer,
        clientId: this.#clientId,
        callbackUri: this.#opts.callbackUri,
        allowInsecureLoopback: this.#opts.allowInsecureLoopback,
        signal,
        // Discovery + the grant use the pristine fetch (out of the reactive loop).
        fetch: this.#publicFetch,
      }),
    );
    if (!restored) return undefined;
    // FENCE: a logout / new login during the grant supersedes this restore.
    if (generation !== this.#generation) return undefined;
    // CONSISTENCY: restoreSession returned a refreshed (rotated) token, but if its
    // rotation `put` did NOT durably persist (store threw — private mode / quota), the
    // store still holds the OLD (now server-spent) refresh token. Pinning the in-memory
    // session on the new access token would strand it once that token expired (the next
    // refresh would invalid_grant — the roborev finding). Fall back to login (fail-closed)
    // rather than pin a session backed by a non-persisted credential.
    if (!guarded.rotationPersisted()) return undefined;
    // WEBID-MATCH GUARD: do NOT pin a session whose WebID differs from the one this
    // restore is for — that would transiently expose the wrong account. Return the
    // restored WebID WITHOUT pinning so the pure decision can fail closed
    // (webid-mismatch → teardown). We intentionally leave the credential as-is here;
    // the decision's webid-mismatch branch forgets it.
    if (
      expectedWebId !== undefined &&
      expectedWebId !== null &&
      !webIdsEqual(restored.webId, expectedWebId)
    ) {
      return { webId: restored.webId };
    }
    // SCHEME GUARD: a persisted/refreshed WebID must satisfy the SAME https-only rule
    // as an interactive login, or a cleartext `http:` WebID could restore a session
    // and join allowedOrigins — letting the DPoP token ride over http. Validate it;
    // on failure, forget the dead-as-far-as-we're-concerned credential and fall back
    // to login (fail-closed). (loopback http is allowed only under the opt-in.)
    try {
      validateWebId(restored.webId, this.#opts.allowInsecureLoopback ?? false);
    } catch {
      if (generation === this.#generation) await this.#forget(issuer);
      return undefined;
    }
    // We don't have the full AS/client here; rebuild a minimal live session for the
    // authenticated-fetch path. Re-discover lazily on a refresh via the provider.
    // The session is tagged with THIS restore's generation so a later refresh of it
    // is generation-scoped correctly.
    this.#pinRestoredSession(
      generation,
      issuer,
      restored.webId,
      restored.accessToken,
      restored.dpopKey,
      restored.expiresAt,
    );
    return { webId: restored.webId };
  }

  #pinRestoredSession(
    generation: number,
    issuer: URL,
    webId: string,
    accessToken: string,
    dpopKey: CryptoKeyPair,
    expiresAt: number | undefined,
  ): void {
    this.#session = {
      generation,
      issuer,
      webId,
      accessToken,
      dpopKey,
      dpopHandle: oauth.DPoP({}, dpopKey),
      allowedOrigins: this.#allowedOriginsFor(webId, issuer),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      // Lazily discovered on first refresh; placeholders are never used directly.
      authorizationServer: { issuer: issuer.href } as oauth.AuthorizationServer,
      client: { client_id: this.#clientId ?? "" } as oauth.Client,
    };
    this.#ensureProvider();
  }

  /**
   * Refresh the live session's access token from the persisted refresh token (via
   * the audited {@link restoreSession} — discovery → reattach the bound key →
   * refresh grant → rotation + re-persist). Mutates the live session's access token
   * + expiry IN PLACE (the controller and the provider share the object reference),
   * under the generation fence. Single-flight so concurrent 401s share one refresh.
   * Returns true when the token was refreshed; false when it could not be (then the
   * caller attaches the existing token as a best effort).
   */
  // The single-flight refresh is SCOPED to the session it is refreshing — concurrent
  // 401s for the SAME session share it, but a NEW session (login/restore) is never
  // blocked behind a stale old-session refresh (it would otherwise reuse an expired
  // token until the old refresh resolved — the roborev finding). Cleared in `finally`.
  #refreshInFlight?: { session: LiveSession; promise: Promise<boolean> };
  async #refreshSession(session: LiveSession): Promise<boolean> {
    // PRE-GRANT FENCE (BEFORE the in-flight machinery — a synchronous early return that
    // must NOT register a #refreshInFlight entry, or a stuck never-cleared entry would
    // block this session's future refreshes): if this session is ALREADY superseded (a
    // login/logout advanced #generation since it was created), do NOT run the refresh
    // grant. The grant REDEEMS (rotates) the refresh token server-side, but our rotation
    // `put` would then be generation-SKIPPED — so we'd spend the token without persisting
    // its replacement, stranding the session on a now-spent credential if the superseding
    // op (e.g. an account switch) later FAILS (the roborev finding). Skipping leaves the
    // persisted token UNSPENT, so once the generation re-syncs (failed switch) the session
    // can still refresh. (A refresh of the CURRENT session has generation === #generation.)
    if (session.generation !== this.#generation) {
      return false; // superseded → keep the existing token, don't consume the refresh token
    }
    // Share the in-flight refresh ONLY when it is for THIS session.
    if (this.#refreshInFlight && this.#refreshInFlight.session === session) {
      return this.#refreshInFlight.promise;
    }
    // Use the SESSION's OWN generation — NOT the current one. If a newer login has
    // already bumped #generation, this session is SUPERSEDED, so its guarded
    // rotation-write writes under a stale generation (skipped by the guarded store)
    // and can't overwrite the newer login's credential for the same issuer (the
    // roborev race). A refresh of the CURRENT session uses its (current) generation.
    const generation = session.generation;
    const promise = (async () => {
      try {
        // Guarded store (see #restoreIssuer): a logout/newer-login during this refresh
        // can't be undone/overwritten by the refresh's rotation-write; AND it tells us
        // whether that rotation `put` DURABLY SUCCEEDED.
        const guarded = this.#guardedStore(generation);
        // Run the grant under a tracked AbortController so a login/logout that supersedes
        // this refresh mid-grant cancels the token-endpoint request (the roborev finding)
        // rather than redeeming+rotating the refresh token under a stale generation.
        const restored = await this.#withGrantAbort((signal) =>
          restoreSession({
            store: guarded.store,
            issuer: session.issuer,
            clientId: this.#clientId,
            callbackUri: this.#opts.callbackUri,
            allowInsecureLoopback: this.#opts.allowInsecureLoopback,
            signal,
            fetch: this.#publicFetch, // out of the reactive loop
          }),
        );
        // ATOMICITY: apply the refreshed token to the in-memory session ONLY if the
        // session is still live (`this.#session === session`) AND the rotated refresh-token
        // WRITE actually DURABLY PERSISTED (`guarded.rotationPersisted()`). The latter is
        // the store↔memory CONSISTENCY gate: the rotation `put` inside restoreSession is
        // SKIPPED when the generation advanced (a logout / a newer login in flight) AND
        // could THROW (private mode / quota) — in EITHER case the store keeps the OLD (now
        // server-rotated, possibly SPENT) refresh token. Applying the new in-memory access
        // token while that write didn't land would strand the session once that token
        // expired (the next refresh would invalid_grant — the roborev findings). Gating on
        // the actual write outcome keeps the two in lockstep: either the rotation persisted
        // AND we apply it, or neither (the prior session keeps its still-persisted token).
        if (!restored || this.#session !== session || !guarded.rotationPersisted()) {
          return false;
        }
        // CROSS-ACCOUNT GUARD: the issuer-keyed persisted credential could have been
        // replaced by ANOTHER account's (same issuer, different WebID). Refusing
        // unless the refreshed WebID still equals this session's WebID prevents
        // minting/attaching a token for a DIFFERENT identity into the live session.
        if (!webIdsEqual(restored.webId, session.webId)) {
          return false; // fail closed — keep the existing token, do not cross accounts
        }
        // Mutate IN PLACE so the provider (sharing the reference) sees the new token.
        // The refreshed access token is DPoP-bound to `restored.dpopKey` — which may
        // DIFFER from the live key if the persisted credential was replaced (e.g. by
        // another tab logging into the same WebID). Adopt the restored key + handle
        // too, so the provider signs the DPoP proof with the key the NEW token is
        // bound to (RFC 9449 §4.3) instead of mismatching token↔key (→ 401s).
        session.accessToken = restored.accessToken;
        session.expiresAt = restored.expiresAt;
        session.dpopKey = restored.dpopKey;
        session.dpopHandle = restored.dpopHandle;
        return true;
      } catch {
        return false; // best effort — the caller falls back to the existing token.
      } finally {
        // Clear only if still ours (a newer session's refresh may have replaced it).
        if (this.#refreshInFlight?.session === session) this.#refreshInFlight = undefined;
      }
    })();
    this.#refreshInFlight = { session, promise };
    return promise;
  }

  /**
   * The resource origins the session token may be attached to — the credential
   * boundary the provider enforces. Union of the configured {@link
   * ReactiveAuthControllerOptions.allowedOrigins} plus (by default) the WebID's
   * origin and the issuer's origin. Fail-closed: an unparseable entry is skipped,
   * and an empty result means the token is attached to NOTHING.
   */
  #allowedOriginsFor(webId: string, issuer: URL): ReadonlySet<string> {
    return computeAllowedOrigins({
      allowedOrigins: this.#opts.allowedOrigins,
      webId,
      issuer: issuer.href,
      includeWebIdOrigin: this.#opts.includeWebIdOrigin,
      includeIssuerOrigin: this.#opts.includeIssuerOrigin,
      allowInsecureLoopback: this.#opts.allowInsecureLoopback,
    });
  }

  /**
   * Build the token PROVIDER once (used by our OWN authenticated fetch), and — only
   * when `patchGlobalFetch` is requested — install a CONTROLLER-OWNED global `fetch`
   * wrapper so bare `fetch()` callers also upgrade. `.authenticatedFetch` does NOT
   * depend on this (it uses the provider + the pristine fetch directly).
   *
   * IMPORTANT (the roborev findings): we do NOT use `ReactiveFetchManager` for the
   * global patch. That manager (a) captures the CURRENT `globalThis.fetch` as its base,
   * so if another controller/library already patched the global it would CHAIN through
   * that patched fetch — letting a bare `fetch()` be authenticated by ANOTHER session
   * before our provider runs (credential-boundary breach); and (b) passes only the
   * request to `provider.upgrade()`, discarding 401 response headers, so it cannot honour
   * RFC 9449 §8 resource-server DPoP-nonce challenges. Instead the global wrapper runs the
   * SAME {@link #authenticatedFetchOver} as `.authenticatedFetch`, ANCHORED on the
   * known-pristine {@link #publicFetch} (never the live, possibly-patched global) — so it
   * has the identical credential boundary + nonce handling and cannot pick up another
   * controller's patched global.
   */
  #ensureProvider(): PersistingDPoPTokenProvider {
    if (!this.#provider) {
      this.#provider = new PersistingDPoPTokenProvider(
        () => this.#session,
        (session) => this.#refreshSession(session),
      );
    }
    if (this.#opts.patchGlobalFetch && typeof globalThis !== "undefined") {
      // The global wrapper is OUR owned authenticated fetch over the pristine base — NOT a
      // re-read of globalThis.fetch — so the credential boundary + DPoP-nonce retry match
      // `.authenticatedFetch` exactly and we never chain through another patched global.
      // Build it ONCE (stable reference) …
      if (!this.#globalFetchWrapper) {
        this.#globalFetchWrapper = ((input: RequestInfo | URL, init?: RequestInit) =>
          this.#authenticatedFetchOver(this.#publicFetch, input, init)) as typeof fetch;
      }
      // … and RE-ASSERT it on every session (re)establishment. #ensureProvider runs on
      // each login/restore, so if another controller/library overwrote globalThis.fetch
      // since we installed ours, the next session re-installs OURS — the patchGlobalFetch
      // contract (bare fetch() upgrades) doesn't silently lapse (the roborev finding).
      if (globalThis.fetch !== this.#globalFetchWrapper) {
        globalThis.fetch = this.#globalFetchWrapper;
      }
    }
    return this.#provider;
  }

  async login(webId?: string): Promise<LoginResult> {
    // Abort any prior in-flight login's popup immediately (this attempt supersedes it).
    this.#abortActiveLogin();
    // DRAIN in-flight refresh/restore GRANTS BEFORE advancing the generation: abort them
    // (cancel their token-endpoint request) AND await them to settle, so a grant the OP
    // already processed lands its rotation write under its STILL-VALID generation rather
    // than being generation-skipped after our bump — which would strand the prior session
    // on a spent token if THIS login then failed (the roborev finding). The abort bounds
    // the wait. We do this BEFORE the ++generation below.
    await this.#drainActiveGrants();
    // FENCE: bump the generation so this attempt SUPERSEDES any earlier in-flight
    // login/restore — a slower earlier attempt that finishes later must NOT overwrite this
    // attempt's session/persisted credential/remembered pointer with a stale identity. We
    // capture our id and re-check it before every state mutation below; an earlier attempt
    // sees its captured id is no longer current and discards. (logout also bumps.)
    const generation = ++this.#generation;
    // RE-ABORT after the drain await + the bump: the `await #drainActiveGrants()` above is a
    // yield point during which a PRIOR pre-popup login could have resumed (it still saw the
    // OLD generation as current) and registered its own #activeLoginAbort / opened a popup.
    // Now that we've bumped, abort any such handle so a stale popup can't remain open after
    // this superseding login (the roborev finding). This attempt registers its OWN handle
    // later in #authenticate, gated on the (now current) generation.
    this.#abortActiveLogin();
    // The session this attempt is REPLACING (if any). On a FAILED attempt we must not
    // leave it stranded: bumping #generation above made its (older) session.generation
    // stale, which would block its future refreshes while webId/authenticatedFetch
    // still expose it (the roborev finding). So on failure we re-sync the still-live
    // session's generation to the current one, keeping it refreshable.
    const priorSession = this.#session;
    // Capture the issuer of the session/pointer this login is REPLACING, so that on
    // an account switch to a DIFFERENT issuer we can delete the old issuer's persisted
    // credential afterward — otherwise logging into A (issuer X) then B (issuer Y)
    // would leave A's refresh token + key in IndexedDB forever (logout only clears the
    // active issuer). The DPoP-bound stale entry is not directly exploitable, but
    // leaving it violates the clear-on-account-change invariant (the roborev finding).
    const previousIssuer = priorSession?.issuer.href ?? this.#safeReadRemembered()?.issuer;
    // Also capture the WebID being replaced (same source as the issuer). The same-issuer
    // cleanup below must only delete the stored credential when this login is a genuine
    // ACCOUNT SWITCH (different WebID) — a plain SAME-WebID re-login that happens to write
    // no new credential must NOT delete the still-valid credential for that account (the
    // roborev finding).
    const previousWebId = priorSession?.webId ?? this.#safeReadRemembered()?.webId;
    // No explicit WebID → re-login the last account: the remembered silent-restore
    // pointer, ELSE the most-recent stored account (which SURVIVES logout, so a no-arg
    // login still works after sign-out — the LoginController contract).
    const targetWebId =
      webId ?? this.#safeReadRemembered()?.webId ?? this.#recentAccounts.list()[0]?.webId;
    try {
      // FAIL FAST on a restore-only controller: interactive login needs the popup driver.
      // Check `authFlow` BEFORE any network (issuer resolution / discovery) so a restore-
      // only consumer that mistakenly calls login() gets the targeted MissingAuthFlowError
      // immediately, not a profile/issuer fetch error (the roborev finding). #authenticate
      // re-checks too (defense in depth).
      if (!this.#opts.authFlow) {
        throw new MissingAuthFlowError();
      }
      if (!targetWebId) {
        throw new InvalidWebIdError(String(webId), "no WebID supplied");
      }
      const validated = validateWebId(targetWebId, this.#opts.allowInsecureLoopback ?? false);
      const issuer = await this.#resolveIssuer(validated);
      const session = await this.#authenticate(generation, issuer, validated);
      if (generation !== this.#generation) {
        // Superseded by a logout / a LATER login during the popup — discard so we
        // don't clobber the winning attempt's state.
        throw new DOMException("Login superseded", "AbortError");
      }
      // Persist the DPoP-bound refresh token + key for silent restore next load,
      // THEN drop the refresh token from the in-memory session — only the durable
      // store keeps it; the live session needs only the access token + DPoP key.
      // #persist is SERIALIZED + generation-guarded so a superseded earlier login's
      // store write can never land AFTER (and overwrite) a later login's credential.
      // It returns BOTH whether a credential for this session was WRITTEN (so the
      // current, this-page session can refresh) and whether it is DURABLE (survives a
      // reload → restorable next load). The two differ for the in-memory fallback store.
      const { wrote: credentialWritten, durable: credentialRestorable } = await this.#persist(
        session,
        generation,
      );
      // Re-check after the (awaited) persist: a later login may have superseded us
      // while the store write was in flight; if so, do not overwrite its state.
      if (generation !== this.#generation) {
        throw new DOMException("Login superseded", "AbortError");
      }
      session.refreshToken = undefined;
      this.#session = session;
      this.#ensureProvider();
      // SILENT-RESTORE pointer: write it ONLY when a refresh credential is RESTORABLE
      // next load (durable). Otherwise — the OP issued no refresh_token, the store write
      // failed, or the store is non-durable — there is NOTHING to restore from for THIS
      // account next load, so a pointer would make the next load attempt silent restore
      // and fall back (despite login claiming the account is restorable — the roborev
      // finding).
      //
      // CRUCIALLY, when not restorable we must CLEAR any PRE-EXISTING pointer, not merely
      // skip writing: a stale pointer to a PREVIOUS account (e.g. account A on the same
      // issuer, or one whose account-switch cleanup delete failed) would otherwise
      // survive this login and silently restore the WRONG (old) account on the next load
      // instead of falling back to login for the current, non-restorable session (the
      // roborev finding). SAFE either way: a storage failure must NOT reject an
      // otherwise-successful login while the controller already holds the live session.
      if (credentialRestorable) {
        this.#safeWriteRemembered(session.webId, session.issuer.href);
      } else {
        this.#safeClearRemembered();
      }
      // RECENT-ACCOUNTS list (DISTINCT from the silent-restore pointer above): the
      // credential-free, logout-surviving returning-user affordance. This is always
      // remembered — it does not imply a restorable credential, only that the user has
      // signed in with this WebID before (it powers the account picker / no-arg login).
      this.#recentAccounts.remember({ webId: session.webId, displayName: session.webId });
      // ACCOUNT-SWITCH CLEANUP: if this login replaced a session on a DIFFERENT issuer,
      // delete that old issuer's persisted credential (serialized through the chain, so
      // it can't race this login's own persist). Best-effort.
      // Normalize previousIssuer before comparing: it may be a stored/raw string
      // (e.g. "https://idp.example") while session.issuer.href is normalized
      // ("https://idp.example/"). A raw `!==` would treat the SAME issuer as
      // different and #forget the credential JUST persisted for it (roborev finding).
      let normalizedPrevIssuer: string | null = null;
      try {
        normalizedPrevIssuer = previousIssuer ? new URL(previousIssuer).href : null;
      } catch {
        // Unparseable old issuer → nothing safe to forget.
        normalizedPrevIssuer = null;
      }
      if (normalizedPrevIssuer && normalizedPrevIssuer !== session.issuer.href) {
        try {
          await this.#forget(new URL(normalizedPrevIssuer));
        } catch {
          // Store error — the stale entry is DPoP-bound; harmless.
        }
      } else if (
        !credentialWritten &&
        normalizedPrevIssuer === session.issuer.href &&
        previousWebId !== undefined &&
        !webIdsEqual(previousWebId, session.webId)
      ) {
        // SAME-ISSUER account SWITCH (the replaced WebID DIFFERS from the new one) where
        // THIS login WROTE NO new credential (no refresh_token / store-write failed): the
        // store still holds the PREVIOUS, DIFFERENT account's credential for this issuer
        // (we didn't overwrite it). Leaving it would let a later restore redeem the WRONG
        // account's refresh token for the issuer the live session now belongs to. Drop it
        // so no stale, mismatched credential lingers (the roborev finding).
        //
        // CRUCIALLY gated on a DIFFERENT WebID (the roborev follow-up): a plain SAME-WebID
        // re-login that wrote no new credential must NOT delete the stored credential — it
        // belongs to the SAME account and is still valid, so deleting it would make that
        // still-live session non-restorable/non-refreshable once its access token expired.
        // Also gated on `!credentialWritten` (NOT `!credentialRestorable`): a successful
        // put to the NON-DURABLE in-memory store DID write the current session's credential
        // — we must not delete THAT either. Best-effort; the entry is DPoP-bound regardless.
        try {
          await this.#forget(session.issuer);
        } catch {
          // Store error — the stale entry is DPoP-bound; harmless.
        }
      }
      // FINAL SUPERSESSION RECHECK (after the awaited account-switch cleanup): a newer
      // login / a logout may have advanced #generation (and replaced/cleared #session)
      // WHILE #forget was in flight. Returning a success for `session.webId` here would
      // report a WebID that no longer matches `controller.webId` (the winner's account, or
      // logged-out) — a stale, misleading result. Throw the same AbortError as the earlier
      // checkpoints so the superseded attempt does not claim an out-of-date success (the
      // roborev finding). The winning op owns the reported state + the session-change event.
      if (generation !== this.#generation || this.#session !== session) {
        throw new DOMException("Login superseded", "AbortError");
      }
      return { webId: session.webId };
    } catch (e) {
      // FAILED / cancelled attempt: if it did NOT replace the prior session (that is
      // still the live one), re-sync its generation to the current one so it stays
      // refreshable — the bump at the top must not strand a session that survives a
      // failed switch. (If a logout/newer login intervened, leave it to them.)
      if (priorSession && this.#session === priorSession && generation === this.#generation) {
        priorSession.generation = this.#generation;
      }
      throw e;
    } finally {
      // Clear the active-login abort handle ONLY if this attempt is still the current one
      // (a superseding login/logout already replaced/aborted it — don't clobber theirs).
      if (generation === this.#generation) this.#activeLoginAbort = undefined;
    }
  }

  /** Abort the in-flight interactive login's popup (if any) and drop the handle. */
  #abortActiveLogin(): void {
    const abort = this.#activeLoginAbort;
    if (abort) {
      this.#activeLoginAbort = undefined;
      abort.abort();
    }
  }

  /**
   * Abort every in-flight refresh / silent-restore GRANT (logout / non-blocking supersede)
   * so a grant superseded mid-flight cancels its token-endpoint request rather than
   * redeeming the refresh token under a stale generation (the roborev finding).
   */
  #abortActiveGrants(): void {
    for (const g of this.#activeGrants) g.abort.abort();
  }

  /**
   * ABORT then AWAIT the in-flight grants to SETTLE — used by `login()` BEFORE it bumps the
   * generation, so a grant the OP already processed gets its rotation write to land under
   * its still-valid generation instead of being generation-skipped (the roborev finding).
   * The abort bounds the wait. Snapshot the set first (members remove themselves on settle).
   */
  async #drainActiveGrants(): Promise<void> {
    if (this.#activeGrants.size === 0) return;
    const grants = [...this.#activeGrants];
    for (const g of grants) g.abort.abort();
    await Promise.allSettled(grants.map((g) => g.settled));
  }

  /** Run a refresh/restore grant under a tracked AbortController so supersession cancels it. */
  async #withGrantAbort<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    let resolveSettled!: () => void;
    const settled = new Promise<void>((res) => {
      resolveSettled = res;
    });
    const entry = { abort, settled };
    this.#activeGrants.add(entry);
    try {
      return await run(abort.signal);
    } finally {
      this.#activeGrants.delete(entry);
      resolveSettled();
    }
  }

  async logout(): Promise<void> {
    const issuer = this.#session?.issuer ?? this.#rememberedIssuer();
    // LOCAL TEARDOWN FIRST — unconditional + synchronous, BEFORE any awaited store
    // I/O: drop the in-memory session, bump the generation (so any in-flight
    // login/restore/persist is superseded — its chained store write becomes a
    // no-op), and clear the remembered pointer. This must happen even if the
    // durable delete below fails, otherwise a failed delete would leave the pointer
    // intact and the NEXT load could silently restore a "logged-out" session
    // (the roborev finding). Logout is fail-closed to logged-out, locally, always.
    this.#session = undefined;
    this.#generation++;
    // PROACTIVELY abort any in-flight login's popup AND any in-flight refresh/restore grant
    // — logout supersedes them, so cancel the (possibly still-open) popup and the
    // (possibly mid-flight) token grant immediately (the roborev findings); their
    // post-grant/popup generation checks would discard them anyway.
    this.#abortActiveLogin();
    this.#abortActiveGrants();
    this.#safeClearRemembered();
    // DURABLE DELETE, SERIALIZED through the SAME chain as persists, so a persist
    // that was already queued cannot write the credential back AFTER this delete
    // (the delete is enqueued last, so it runs after any pending persist). If the durable
    // delete FAILS, the local teardown above has ALREADY made us logged-out (webId null,
    // pristine fetch, no restore pointer), but the persisted credential may LINGER — so we
    // REJECT logout() to SURFACE that to the caller (it can retry / warn) rather than
    // silently reporting a fully-complete logout while a restorable credential remains
    // (the roborev finding). The pointer is cleared regardless, so the lingering entry is
    // not auto-restored next load — but the caller deserves to know it wasn't fully purged.
    if (issuer) {
      const deleted = await this.#forget(issuer);
      if (!deleted) {
        throw new Error(
          "Logged out locally, but the persisted credential could not be deleted from durable " +
            "storage (it may remain until the next successful logout / store write).",
        );
      }
    }
  }

  /**
   * Serialized durable delete (chained with persists so ordering is deterministic).
   * Returns whether the delete DURABLY SUCCEEDED (so logout() can surface a failure). We
   * call the store's `delete` DIRECTLY rather than `forgetPersisted` (which swallows store
   * errors and always "succeeds") — so a genuine delete fault is observable and logout no
   * longer silently reports complete while the credential lingers (the roborev finding).
   */
  async #forget(issuer: URL): Promise<boolean> {
    const run = this.#persistChain.then(async () => {
      await this.#store.delete(issuer.href);
      return true;
    });
    this.#persistChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.catch(() => false);
  }

  #rememberedIssuer(): URL | undefined {
    const record = this.#safeReadRemembered();
    if (!record?.issuer) return undefined;
    try {
      return new URL(record.issuer);
    } catch {
      return undefined;
    }
  }

  #safeClearRemembered(): void {
    try {
      this.#remembered.clear();
    } catch {
      // localStorage unavailable — nothing to clear; not a logout blocker.
    }
  }

  // ── Issuer resolution: WebID profile → solid:oidcIssuer (never regex) ──────
  async #resolveIssuer(webId: string): Promise<URL> {
    const { dataset } = await fetchRdf(webId, { fetch: this.#profileFetch });
    const agent = new Agent(webId, dataset, DataFactory);
    const issuers = [...agent.oidcIssuer];
    if (issuers.length === 0) throw new NoSolidIssuerError(webId);
    if (issuers.length === 1) return new URL(issuers[0]);
    const choose = this.#opts.chooseIssuer;
    if (!choose) throw new AmbiguousIssuerError(webId, issuers);
    const chosen = await choose(issuers, webId);
    // SECURITY: the chosen issuer MUST be one the profile actually advertised — a
    // buggy/tampered chooser returning an unlisted OP would bypass the Solid
    // issuer↔WebID binding (a malicious OP could then assert this WebID). Compare by
    // URL origin+path (tolerant of a trailing slash), fail closed otherwise.
    const chosenUrl = new URL(chosen);
    const advertised = issuers.some((i) => {
      try {
        return new URL(i).href.replace(/\/$/, "") === chosenUrl.href.replace(/\/$/, "");
      } catch {
        return false;
      }
    });
    if (!advertised) {
      throw new Error(
        `chooseIssuer returned an issuer (${chosen}) that the WebID profile does not advertise.`,
      );
    }
    return chosenUrl;
  }

  #httpOptions(issuer: URL): OauthHttpOptions {
    if (this.#opts.allowInsecureLoopback && isLoopback(issuer.hostname)) {
      return { [oauth.allowInsecureRequests]: true };
    }
    return {};
  }

  /** Resolve the OAuth client (static Client Identifier Document or dynamic reg). */
  async #resolveClient(
    authorizationServer: oauth.AuthorizationServer,
    http: OauthHttpOptions,
  ): Promise<oauth.Client> {
    if (this.#clientId !== undefined) {
      return {
        client_id: this.#clientId,
        token_endpoint_auth_method: "none",
        redirect_uris: [this.#opts.callbackUri],
        response_types: ["code"],
      };
    }
    // Silent restore depends on a refresh token (the `offline_access` scope), and a
    // refresh token is only issued to a client registered for the refresh-token
    // grant. The default dynamic-registration metadata advertises only
    // `authorization_code`, so an OP that honours it may issue NO refresh token —
    // silently breaking silent restore for dynamically-registered clients. Declare
    // BOTH grants (and `response_types: ["code"]`) so the OP grants a refresh token.
    const registrationResponse = await oauth.dynamicClientRegistrationRequest(
      authorizationServer,
      {
        redirect_uris: [this.#opts.callbackUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { ...http, [oauth.customFetch]: this.#oauthFetch() },
    );
    return oauth.processDynamicClientRegistrationResponse(registrationResponse);
  }

  /** oauth4webapi customFetch bound to the pristine fetch (out of the reactive loop). */
  #oauthFetch(): (
    url: string,
    opts: oauth.CustomFetchOptions<string, unknown>,
  ) => Promise<Response> {
    const f = this.#publicFetch;
    return (url, opts) => f(url, opts as RequestInit);
  }

  /**
   * The interactive authorization-code + PKCE + DPoP grant, requesting
   * `offline_access` so the OP issues a refresh token, then minting a DPoP-bound
   * access token. Drives `authFlow.getCode` for the popup; retries once without
   * `prompt=none` when the OP needs interaction.
   */
  async #authenticate(
    generation: number,
    issuer: URL,
    expectedWebId: string,
  ): Promise<LiveSession> {
    // FAIL FAST: interactive login needs the popup driver. `authFlow` is OPTIONAL on
    // the options type (restore-only construction doesn't need it), so a missing one
    // surfaces HERE — the only path that actually drives the popup — with a targeted,
    // clear error rather than a generic "cannot read getCode of undefined".
    const authFlow = this.#opts.authFlow;
    if (!authFlow) {
      throw new MissingAuthFlowError();
    }
    const baseHttp = this.#httpOptions(issuer);
    const customFetch = this.#oauthFetch();
    const http = { ...baseHttp, [oauth.customFetch]: customFetch };

    const discoveryResponse = await oauth.discoveryRequest(issuer, http);
    const authorizationServer = await oauth.processDiscoveryResponse(issuer, discoveryResponse);
    const client = await this.#resolveClient(authorizationServer, baseHttp);

    const dpopKey = await oauth.generateKeyPair("ES256", { extractable: false });
    const dpopHandle = oauth.DPoP(client, dpopKey);
    // RFC 9449 §10 / Solid-OIDC: bind the AUTHORIZATION CODE to this DPoP key from the
    // start by sending `dpop_jkt` (the JWK SHA-256 thumbprint of the DPoP key) on the
    // authorization request. Providers that enforce DPoP authorization-code binding
    // otherwise reject the login or issue a token not bound to our key (the roborev
    // finding). Best-effort: if the handle can't compute a thumbprint, omit it (don't
    // block login) — the token-endpoint DPoP proof still binds the token to the key.
    let dpopJkt: string | undefined;
    try {
      dpopJkt = await dpopHandle.calculateThumbprint();
    } catch {
      dpopJkt = undefined;
    }
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();

    // PKCE with S256 is MANDATORY for a public browser client (OAuth 2.0 for
    // Browser-Based Apps BCP / RFC 7636): it protects the authorization code against
    // interception. We ALWAYS send an S256 challenge — never the `plain` method (a
    // downgrade) and never skip PKCE because metadata omits
    // `code_challenge_methods_supported` (some OPs require PKCE but omit the
    // advertisement). A non-S256 verifier is never used.
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);

    const buildUrl = (withPromptNone: boolean): URL => {
      const url = new URL(authorizationServer.authorization_endpoint as string);
      url.searchParams.set("client_id", client.client_id);
      url.searchParams.set("redirect_uri", this.#opts.callbackUri);
      url.searchParams.set("response_type", "code");
      // `offline_access` is what makes the OP issue a refresh token (the credential
      // silent restore later redeems). `webid` is the Solid-OIDC scope.
      url.searchParams.set("scope", "openid webid offline_access");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      // SILENT leg: prompt=none. INTERACTIVE leg: `select_account consent` — the
      // account chooser is REQUIRED for account switching (a plain `consent` lets the
      // IdP keep returning the existing session's account, so an account switch / an
      // `account_selection_required` retry would loop), and `consent` ensures the OP
      // (re-)prompts for the offline_access consent so a refresh token is issued.
      url.searchParams.set("prompt", withPromptNone ? "none" : "select_account consent");
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      // RFC 9449 §10 DPoP authorization-code binding: advertise the DPoP key's thumbprint
      // so the issued code is bound to it (when the handle could compute one).
      if (dpopJkt) url.searchParams.set("dpop_jkt", dpopJkt);
      return url;
    };

    // A real AbortController for THIS attempt's popup: if a newer login / a logout
    // supersedes us, we abort it so the popup driver can cancel (best-effort — the host's
    // getCode may or may not honour the signal). REGISTER it on the instance so a newer
    // login()/logout() can abort it IMMEDIATELY (not only when getCode returns).
    const abort = new AbortController();
    // Only register as the active handle if THIS attempt is still current: a STALE attempt
    // (one a newer login already superseded while we awaited issuer-resolution/discovery)
    // must NOT overwrite the NEWER attempt's #activeLoginAbort — otherwise a later
    // logout/login would abort the stale controller and leave the newer popup un-cancelled
    // (the roborev finding). A superseded attempt's own popup is bailed by the generation
    // checks in runLeg regardless.
    if (generation === this.#generation) {
      this.#activeLoginAbort = abort;
    }
    const getCode: GetCodeCallback = authFlow.getCode.bind(authFlow);

    // One full leg: drive getCode for the given prompt, exchange the code for a
    // DPoP-bound token, and read the authenticated WebID. Returns the token + WebID.
    const runLeg = async (
      withPromptNone: boolean,
    ): Promise<{ tokenResult: oauth.TokenEndpointResponse; webId: string }> => {
      // SUPERSESSION CHECK BEFORE OPENING THE POPUP: the awaited pre-popup steps (issuer
      // resolution, discovery, client metadata) give a newer login / a logout time to
      // advance #generation. Don't open (or block on) the popup for a stale attempt — bail
      // with AbortError so we never drive getCode for a login the caller already discarded
      // (the roborev finding). The post-popup checks (in login()) still guard the result.
      if (generation !== this.#generation) {
        abort.abort();
        throw new DOMException("Login superseded", "AbortError");
      }
      const code = await getCode(buildUrl(withPromptNone), abort.signal);
      // SUPERSESSION CHECK AFTER THE POPUP, BEFORE REDEEMING THE CODE: getCode is a long
      // await (the user is interacting), during which a newer login / a logout can advance
      // #generation. Bail HERE — before validateAuthResponse + the authorization-code grant
      // — so a stale popup does NOT needlessly REDEEM the authorization code / mint tokens
      // for a login the caller already discarded (the roborev finding). Abort the signal too
      // so any still-open flow can cancel. (login() also re-checks after #authenticate, but
      // that is after the token has been minted; stopping here avoids the wasted redemption
      // and a transient extra session at the OP.)
      if (generation !== this.#generation) {
        abort.abort();
        throw new DOMException("Login superseded", "AbortError");
      }
      const params = oauth.validateAuthResponse(authorizationServer, client, new URL(code), state);
      // The grant + PROCESS as one unit: oauth4webapi surfaces a `use_dpop_nonce`
      // challenge from EITHER authorizationCodeGrantRequest OR
      // processAuthorizationCodeResponse (the latter inspects the Response body), and
      // the DPoP handle captures the nonce from the error — so the whole exchange must
      // be retried once, not just the request.
      const exchange = async (): Promise<oauth.TokenEndpointResponse> => {
        const tokenResponse = await oauth.authorizationCodeGrantRequest(
          authorizationServer,
          client,
          oauth.None(),
          params,
          this.#opts.callbackUri,
          codeVerifier, // PKCE always on (S256) — never oauth.nopkce for a public client
          { DPoP: dpopHandle, ...http },
        );
        return oauth.processAuthorizationCodeResponse(authorizationServer, client, tokenResponse, {
          expectedNonce: nonce,
        });
      };
      // RETRY ONCE on a server-required DPoP nonce (the same pattern the refresh-restore
      // path uses) so providers that require a token-endpoint nonce don't fail login.
      let tokenResult: oauth.TokenEndpointResponse;
      try {
        tokenResult = await exchange();
      } catch (e) {
        if (!oauth.isDPoPNonceError(e)) throw e;
        tokenResult = await exchange();
      }
      // ENFORCE DPoP: oauth4webapi permits a `Bearer` token_type by default. This
      // controller is DPoP-only — accepting a Bearer token would persist + attach a
      // NON-sender-constrained credential (a Bearer refresh token is exfiltratable),
      // defeating the whole DPoP threat model. Reject anything but `dpop` (case-insens).
      if (tokenResult.token_type.toLowerCase() !== "dpop") {
        throw new Error(
          `Expected a DPoP-bound token but the identity provider returned token_type="${tokenResult.token_type}".`,
        );
      }
      const webId = webIdFromClaims(oauth.getValidatedIdTokenClaims(tokenResult));
      if (!webId) {
        throw new Error("The identity provider did not return a WebID for this session.");
      }
      return { tokenResult, webId };
    };

    // First the SILENT (`prompt=none`) leg. Two paths can require an INTERACTIVE retry,
    // and the `needsInteraction` fallback is SCOPED TO THE SILENT LEG ONLY (the roborev
    // finding): otherwise an interactive leg that itself throws an interaction-required
    // error would be re-treated as a silent-leg failure and trigger a SECOND interactive
    // retry (a stray extra popup). So we capture the silent result (or its
    // needs-interaction signal) in one try, then run the SINGLE interactive retry OUTSIDE
    // that catch — an error from the interactive leg propagates and is never re-retried.
    let result: { tokenResult: oauth.TokenEndpointResponse; webId: string } | undefined;
    let needInteractiveRetry = false;
    try {
      result = await runLeg(true);
      // Silent leg SUCCEEDED but authenticated a DIFFERENT WebID than requested (an existing
      // IdP cookie for ANOTHER account on the same issuer): retry interactively so the user
      // can SELECT the requested account, rather than hard-failing (which would make
      // account-switching impossible). Defer the retry to OUTSIDE this catch.
      if (!webIdsEqual(result.webId, expectedWebId)) needInteractiveRetry = true;
    } catch (e) {
      // ONLY the silent leg's needs-interaction error falls back to an interactive leg.
      if (!needsInteraction(e)) throw e;
      needInteractiveRetry = true;
    }
    // The SINGLE interactive retry (for either reason above). An error here PROPAGATES —
    // it is NOT caught by the silent-leg fallback, so there is never a second retry.
    if (needInteractiveRetry) {
      result = await runLeg(false);
    }
    // `result` is always set here: either the silent leg succeeded (and no retry was
    // needed), or the interactive retry ran and assigned it (a throw would have exited).
    const { tokenResult, webId } = result as {
      tokenResult: oauth.TokenEndpointResponse;
      webId: string;
    };
    // SECURITY: confirm the OP authenticated the WebID the user asked to log in as.
    // A mismatch (user typed A, OP logged in B) fails closed — never silently accept
    // B's session under A's intent. (Even after the interactive retry above.)
    if (!webIdsEqual(webId, expectedWebId)) {
      throw new Error(
        `Signed in as a different WebID than requested (asked for ${expectedWebId}, got ${webId}).`,
      );
    }

    return {
      generation,
      issuer,
      webId,
      accessToken: tokenResult.access_token,
      dpopKey,
      dpopHandle,
      authorizationServer,
      client,
      allowedOrigins: this.#allowedOriginsFor(webId, issuer),
      expiresAt: expiresAtFrom(tokenResult.expires_in),
      // Stash the refresh token transiently for persist(); cleared right after.
      refreshToken: tokenResult.refresh_token,
    };
  }

  /**
   * Persist the DPoP-bound refresh token + key for silent restore next load.
   *
   * RETURNS a {@link PersistResult} distinguishing two DIFFERENT facts (conflating them
   * was a roborev finding):
   *   • `wrote` — a credential for THIS session was actually `put` into the store and
   *     survived (so the CURRENT, this-page session can refresh against it). True even
   *     for the in-memory fallback store (the put is real for the page lifetime).
   *   • `durable` — that credential will SURVIVE A RELOAD (restorable next load), which
   *     additionally requires a DURABLE store. This drives whether `login()` writes the
   *     SILENT-RESTORE pointer; a pointer to a non-restorable session would make the
   *     next load attempt silent restore and fall back.
   *
   * Both are false when: the OP issued NO refresh token; a LATER login/logout superseded
   * this attempt before/while writing; or the store `put` THREW. `wrote` is true but
   * `durable` false ONLY for a successful put to the NON-DURABLE in-memory fallback.
   *
   * SERIALIZED + generation-guarded (the roborev race fix): durable writes are
   * chained through {@link #persistChain} so they apply STRICTLY in call order, and
   * each write re-checks its login `generation` (synchronously, immediately before
   * issuing the store `put`, after acquiring its turn) — so a SUPERSEDED earlier
   * login's write is SKIPPED rather than landing after (and overwriting) a later
   * login's credential. Without this, two overlapping logins could race their async
   * `put`s and leave the WRONG (stale) refresh token persisted, breaking the next
   * silent restore.
   */
  #persistChain: Promise<void> = Promise.resolve();
  async #persist(session: LiveSession, generation: number): Promise<PersistResult> {
    // OP issued no refresh token → nothing to write, nothing restorable.
    if (!session.refreshToken) return { wrote: false, durable: false };
    const run = this.#persistChain.then(async (): Promise<PersistResult> => {
      // We now hold the write turn. If a LATER login (or logout) has superseded us
      // since this attempt started, do NOT write — the winner's credential stands.
      if (generation !== this.#generation) return { wrote: false, durable: false };
      try {
        // VALUE-AWARE ROLLBACK SNAPSHOT: read the issuer's CURRENT credential before we
        // overwrite it, so that if we have to roll back (superseded mid-put) we can RESTORE
        // it rather than blindly deleting — otherwise overwriting then deleting would
        // destroy a PRIOR live session's credential for the same issuer, breaking its next
        // refresh/restore (the roborev finding). We hold the serialized write turn, so this
        // snapshot reflects the state immediately before our put (the prior account's
        // credential, or a winner's if it already wrote).
        let previous: PersistedSession | undefined;
        try {
          previous = await this.#store.get(session.issuer.href);
        } catch {
          previous = undefined; // a read fault → fall back to delete-on-rollback
        }
        // Persist the client_id that was ACTUALLY used: the static Client Identifier
        // Document URL when configured, else the server-assigned DYNAMIC client id
        // from this login's registration. A refresh token is client-bound (RFC 6749
        // §6 / §10.4), so silent restore must redeem it as the SAME client — persisting
        // the dynamic id is what keeps the default (no-static-clientId) path restorable
        // instead of re-registering a new client that cannot redeem the old token.
        const clientId = this.#clientId ?? session.client.client_id;
        await this.#store.put({
          issuer: session.issuer.href,
          webId: session.webId,
          refreshToken: session.refreshToken as string,
          dpopKey: session.dpopKey,
          ...(clientId !== undefined && clientId !== "" ? { clientId } : {}),
        });
        // ROLLBACK: if a newer login/logout superseded us WHILE the put was in flight, our
        // write is stale. RESTORE the snapshot we captured (compare-and-restore) so a PRIOR
        // session's credential for the same issuer is preserved; only DELETE when there was
        // no prior credential (our write was the only one). A logout that already deleted
        // the entry: `previous` is undefined → we delete (a no-op), staying logged-out. This
        // never destroys another account's still-needed credential (the roborev finding).
        // Our write did NOT survive → report neither wrote nor durable.
        if (generation !== this.#generation) {
          if (previous !== undefined) {
            await this.#store.put(previous).catch(() => {});
          } else {
            await this.#store.delete(session.issuer.href).catch(() => {});
          }
          return { wrote: false, durable: false };
        }
        // The credential is in the store and survived supersession (so the CURRENT
        // session can refresh against it = `wrote`). It is RESTORABLE next load only if
        // the store is DURABLE (`durable`): the in-memory fallback loses it on reload, so
        // its put is real this page lifetime but NOT durable — the silent-restore pointer
        // is suppressed for it while the live session still works (the roborev finding).
        return { wrote: true, durable: this.#storeIsDurable };
      } catch {
        // Durable persistence failed (private mode / quota): the in-memory session
        // is still valid this load; the next load may re-prompt. Never logged. Nothing
        // was persisted → neither wrote nor durable.
        return { wrote: false, durable: false };
      }
    });
    // Keep the chain alive even if this link rejected (it can't — caught above), so
    // a later persist always runs after this one completes.
    this.#persistChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Wrap the store so restoreSession's INTERNAL rotation-write (its own `put` after
   * a successful refresh grant) goes through the SAME serialized + generation-guarded
   * lifecycle as login/logout. Without this, a logout during an in-flight restore /
   * refresh could delete the credential and then the restore's rotation `put` could
   * re-persist it AFTER — leaving a durable session behind after sign-out (the roborev
   * finding). Reads pass through unchanged; BOTH mutations (`put` AND `delete`) are
   * chained + skipped when the generation has advanced (logout/relogin) since the
   * operation started — so a stale restore that hits `invalid_grant` cannot delete a
   * NEWER login's freshly-persisted credential, and a stale rotation cannot re-create
   * one a newer logout deleted.
   *
   * Returns the wrapped store PLUS a `rotationPersisted()` flag: whether restoreSession's
   * rotation `put` actually DURABLY SUCCEEDED (ran, was not generation-skipped, and did
   * not throw). The caller pins/applies the refreshed in-memory token ONLY when this is
   * true — otherwise the store would keep the OLD (now server-spent) refresh token while
   * memory ran on the new access token, stranding the session once that token expired
   * (the roborev finding). A store whose `put` throws (private mode / quota) therefore
   * does NOT desynchronise memory from durable state.
   */
  #guardedStore(generation: number): {
    store: SessionStore;
    rotationPersisted: () => boolean;
  } {
    const inner = this.#store;
    let rotationPersisted = false;
    const guard = <T>(op: () => Promise<T>, onPut: boolean): Promise<T | undefined> => {
      const run = this.#persistChain.then(async () => {
        if (generation !== this.#generation) return undefined; // superseded → skip
        const result = await op();
        if (onPut) rotationPersisted = true; // this put RAN to completion (not skipped/threw)
        return result;
      });
      this.#persistChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    return {
      rotationPersisted: () => rotationPersisted,
      store: {
        get: (issuer) => inner.get(issuer),
        put: async (s) => {
          // A put resets the flag to its own outcome (so an EARLIER failed put can't make a
          // later one look durable, and vice-versa); guard sets it true only on success.
          rotationPersisted = false;
          await guard(() => inner.put(s), true);
        },
        delete: async (issuer) => {
          await guard(() => inner.delete(issuer), false);
        },
      },
    };
  }
}

/**
 * A reactive-auth TokenProvider that attaches the controller's current live
 * session's DPoP-bound token on a 401 — but ONLY for a request whose origin is in
 * the session's allowed-origins set (the credential boundary). It matches a request
 * only when there IS a live session AND the request targets an allowed origin, so a
 * 401 from a FOREIGN origin is left unauthenticated — the user's token never leaks
 * cross-origin even if a caller accidentally routes a foreign request through
 * `.fetch`. The session is read live via a getter so a relogin / restore is
 * reflected without re-registering the provider. The DPoP proof is generated by the
 * audited `dpop` package (RFC 9449, incl. the `ath` access-token hash) — never
 * hand-rolled crypto.
 */
class PersistingDPoPTokenProvider implements TokenProvider {
  readonly #getSession: () => LiveSession | undefined;
  readonly #refresh: (session: LiveSession) => Promise<boolean>;
  /**
   * RFC 9449 §8 resource-server DPoP nonces, cached per RESOURCE ORIGIN. A protected
   * resource may REQUIRE the DPoP proof to carry a server-chosen `nonce` claim: it
   * answers an unaccompanied request with `401` + `WWW-Authenticate: DPoP
   * error="use_dpop_nonce"` and a `DPoP-Nonce` response header, and rotates that nonce
   * on subsequent responses. Without echoing it back the RS rejects every request even
   * with a perfectly fresh access token (the roborev finding). We key by origin (a
   * nonce is scoped to the issuing server) so the user's nonce for pod A is never sent
   * to pod B. {@link rememberNonce} feeds it from observed responses; {@link upgrade}
   * embeds the current one in the proof.
   */
  readonly #nonces = new Map<string, string>();
  constructor(
    getSession: () => LiveSession | undefined,
    refresh: (session: LiveSession) => Promise<boolean>,
  ) {
    this.#getSession = getSession;
    this.#refresh = refresh;
  }

  /** True only for an allowed-origin request while a session is live. */
  async matches(request: Request): Promise<boolean> {
    return this.#allowed(this.#getSession(), request);
  }

  /**
   * Record a resource server's `DPoP-Nonce` for its origin (from a 401 challenge or a
   * rotated nonce on any response), so the NEXT proof to that origin embeds it. Only
   * stored for an ALLOWED origin with a live session — we never retain a nonce for an
   * origin the token is not attached to. Returns whether the stored nonce CHANGED (so
   * the caller can decide a 401 is worth retrying with the new nonce).
   */
  rememberNonce(response: Response, request: Request): boolean {
    const nonce = response.headers.get("DPoP-Nonce");
    if (!nonce) return false;
    const session = this.#getSession();
    if (!this.#allowed(session, request)) return false;
    let origin: string;
    try {
      origin = new URL(request.url).origin;
    } catch {
      return false;
    }
    const changed = this.#nonces.get(origin) !== nonce;
    this.#nonces.set(origin, nonce);
    return changed;
  }

  /** The cached resource-server DPoP nonce for `url`'s origin, if any. */
  #nonceFor(url: string): string | undefined {
    try {
      return this.#nonces.get(new URL(url).origin);
    } catch {
      return undefined;
    }
  }

  /**
   * Attach the session's DPoP-bound token to `request` (allowed-origin only).
   * `forceRefresh` separates the two call sites:
   *  - PROACTIVE first attach (false): refresh ONLY when a KNOWN expiry has passed —
   *    a provider that omits `expires_in` must NOT trigger a refresh on EVERY fetch
   *    (token-rotation / rate-limit risk); the existing token is attached as-is.
   *  - 401 RETRY (true): the server REJECTED the token, so refresh even when the
   *    expiry is unknown (the 401 is the proof the token is stale).
   */
  async upgrade(request: Request, forceRefresh = false): Promise<Request> {
    let session = this.#getSession();
    // Defense in depth: re-check the origin here too, so even a direct/forced
    // `upgrade` (bypassing `matches`) never attaches the token cross-origin.
    if (!this.#allowed(session, request) || !session) return request;
    // Refresh the access token if it is known-expired, or (on a 401 retry) if the
    // server rejected it. Refresh is single-flight + fail-closed.
    if (shouldRefresh(session.expiresAt, forceRefresh)) {
      await this.#refresh(session);
      // REVALIDATE after the awaited refresh: a logout / relogin during the grant may
      // have superseded or REPLACED the session. Re-read the CURRENT session and
      // re-check it is the SAME object AND still allowed for this request — otherwise
      // attaching the captured (now-stale / wrong-account) token would leak a
      // credential after sign-out / across accounts (the roborev finding). Return the
      // original request unauthenticated when the session changed/disappeared.
      const current = this.#getSession();
      if (current !== session || !this.#allowed(current, request)) return request;
      session = current;
    }
    const headers = new Headers(request.headers);
    headers.set(
      "DPoP",
      await DPoP.generateProof(
        session.dpopKey,
        // RFC 9449 §4.2: the `htu` claim is the request URI WITHOUT query + fragment.
        // Pass a normalized htu (query/hash stripped) so a protected request like
        // `…?q=…#frag` produces a valid proof the RS will accept.
        htuOf(request.url),
        request.method,
        // RFC 9449 §8: embed the resource server's cached `nonce` (from a prior
        // `use_dpop_nonce` 401 / a rotated `DPoP-Nonce` response header) so a server
        // that REQUIRES a nonce accepts the proof; `undefined` for servers that don't.
        this.#nonceFor(request.url),
        session.accessToken,
      ),
    );
    headers.set("Authorization", `DPoP ${session.accessToken}`);
    return new Request(request, { headers });
  }

  /** Whether `request`'s origin is in the live session's allowed set (fail-closed). */
  #allowed(session: LiveSession | undefined, request: Request): boolean {
    if (!session) return false;
    return isOriginAllowed(session.allowedOrigins, request.url);
  }
}

/**
 * Whether to refresh the access token before attaching it.
 *  - `force` (a 401 retry where the server REJECTED the token) → ALWAYS refresh, even
 *    when the client THINKS the token is still valid (a future local expiry): the
 *    server's 401 is authoritative proof the token is stale (revoked / clock skew /
 *    rotated), so a known-future `expiresAt` must NOT suppress the forced refresh (the
 *    roborev finding — otherwise a server rejecting a not-yet-locally-expired token
 *    loops forever).
 *  - Otherwise (PROACTIVE first attach, `force` false): refresh only when a KNOWN expiry
 *    has PASSED. An UNKNOWN expiry (`expiresAt` undefined) is NOT refreshed proactively —
 *    a provider that omits `expires_in` would otherwise trigger a refresh-token grant on
 *    EVERY authenticated fetch (token-rotation / rate-limit risk).
 */
function shouldRefresh(expiresAt: number | undefined, force: boolean): boolean {
  if (force) return true;
  if (expiresAt === undefined) return false;
  return Date.now() >= expiresAt;
}

/** The OIDC `prompt=none` errors that mean "the user must interact" (RFC 6749 / OIDC Core §3.1.2.6). */
const INTERACTION_REQUIRED_ERRORS = new Set([
  "interaction_required",
  "login_required",
  "consent_required",
  "account_selection_required",
]);

/**
 * Whether an auth-response error means the OP needs the user to interact (so the
 * silent `prompt=none` leg should fall back to an interactive prompt). Checks both the
 * direct {@link oauth.AuthorizationResponseError} and the wrapped `cause.parameters`
 * shape, against the FULL OIDC interaction-required set (incl.
 * `account_selection_required`, which a user switching accounts on a shared issuer
 * hits) — not just `interaction_required`.
 */
function needsInteraction(e: unknown): boolean {
  if (e instanceof oauth.AuthorizationResponseError && INTERACTION_REQUIRED_ERRORS.has(e.error)) {
    return true;
  }
  try {
    const err = (e as { cause?: { parameters?: URLSearchParams } }).cause?.parameters?.get("error");
    return err !== undefined && err !== null && INTERACTION_REQUIRED_ERRORS.has(err);
  } catch {
    return false;
  }
}

/** The WebID from Solid-OIDC id_token claims (`webid`, else `sub`). */
function webIdFromClaims(claims: oauth.IDToken | undefined): string | undefined {
  if (!claims) return undefined;
  const webid = (claims as { webid?: unknown }).webid;
  if (typeof webid === "string" && webid.length > 0) return webid;
  if (typeof claims.sub === "string" && claims.sub.length > 0) return claims.sub;
  return undefined;
}

/**
 * Validate user input as a WebID: it must parse as a URL and be **`https:`** —
 * because the WebID's origin is added to the credential boundary (the session's
 * DPoP token may be attached to it), so a cleartext `http:` WebID would let the
 * token be sent over plaintext. `http:` is allowed ONLY for a loopback host
 * (`localhost`/`127.0.0.1`/`[::1]`) and ONLY when `allowInsecureLoopback` is set
 * (dev CSS over HTTP) — every other `http:` WebID is rejected.
 */
export function validateWebId(input: string, allowInsecureLoopback = false): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidWebIdError(input, "not a URL");
  }
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:") {
    if (allowInsecureLoopback && isLoopback(url.hostname)) return url.toString();
    throw new InvalidWebIdError(
      input,
      "must be https (http is allowed only for a loopback dev host with allowInsecureLoopback)",
    );
  }
  throw new InvalidWebIdError(input, "scheme must be https");
}

// Re-export the controller types for adapter consumers.
export type {
  LoginController,
  LoginResult,
  RecentLoginAccount,
  RestoreOutcome,
} from "../login-controller.js";
export type {
  InstallProactiveAuthFetchOptions,
  ProactiveAllowedOriginsInputs,
  ProactiveFetchConfig,
  ProactiveFetchInstall,
  ProactiveFetchState,
  ProactiveTokenProvider,
} from "./proactive-fetch.js";
// PROACTIVE AUTHENTICATED FETCH (task #123) — the generic, reusable installer that wraps an
// EXTERNAL TokenProvider (the app keeps its own provider) and proactively attaches the
// DPoP-bound token on the FIRST request to an allowed origin, eliminating the per-resource
// 401-dance. Built on the pure seam primitives above (computeAllowedOrigins / isOriginAllowed
// / isUseDpopNonceChallenge). Use this when you have your own token provider that
// createReactiveAuthController cannot wrap. See ./proactive-fetch.ts.
export {
  __resetProactiveFetchForTests,
  deriveProactiveAllowedOrigins,
  installProactiveAuthFetch,
  isReactiveAuthResetError,
  proactiveAuthenticatedFetch,
} from "./proactive-fetch.js";
