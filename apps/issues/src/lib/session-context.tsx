"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadProfile, trackerDocumentUrl, type SolidProfile } from "@/lib/profile";
import { Repository } from "@/lib/repository";
import { registerTracker } from "@/lib/type-index";
import { RecentAccounts, type RecentAccount } from "@/lib/login-ux";
import { NoStorageError } from "@/lib/errors";
import { clearSession, loadSession, saveSession } from "@/lib/session-store";
import { classifyRestoreError, shouldAttemptRestore, shouldClearStoredSession } from "@/lib/silent-restore";
import { clearAllIssueCaches } from "@/lib/issue-cache";
import type { RestorableSession, WebIdDPoPTokenProvider } from "@/lib/webid-token-provider";
import { planAutologin } from "@/lib/autologin-plan";
import {
  consumePendingRedirectWebId,
  hasPendingRedirectLogin,
  webIdsEqual,
} from "@/lib/webid-token-provider";

export type SessionStatus =
  | "initialising"
  // Attempting a silent refresh-grant restore on reopen (brief "Restoring…" state).
  | "restoring"
  // A Pod-Manager `#autologin/<webid>` full-page redirect is being initiated or
  // completed — a brief "Signing you in…" state (no user gesture, so it is NOT the
  // interactive "authenticating" state the LoginScreen's spinner reflects).
  | "autologin"
  | "logged-out"
  | "authenticating"
  | "choose-storage"
  | "logged-in"
  | "error";

export interface SolidSession {
  status: SessionStatus;
  profile: SolidProfile | null;
  /** Pod root chosen for this session (where the tracker lives). */
  storageUrl: string | null;
  /** URL of this user's own tracker config document. */
  trackerUrl: string | null;
  error: string | null;
  recentAccounts: RecentAccount[];
  /** When status is "choose-storage": the storages the WebID advertises. */
  storageChoices: string[];
  login: (webId: string) => Promise<void>;
  /** Continue login with the chosen storage (multi-pod WebIDs). */
  chooseStorage: (storageUrl: string) => Promise<void>;
  logout: () => void;
  /** Forget a remembered account (does not affect the active session). */
  forgetAccount: (webId: string) => void;
}

const SessionContext = createContext<SolidSession | null>(null);

/** Minimal shape of the <authorization-code-flow> element we depend on. */
interface AuthCodeFlowElement extends HTMLElement {
  getCode: (authorizationUri: URL, signal: AbortSignal) => Promise<string>;
}

// ── Autologin (full-page redirect deep-link) ─────────────────────────────────
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
 * bounces back to the app root WITHOUT a `?code` and the deep-link fragment is
 * somehow seen again, the already-set sentinel makes us fall through to the login
 * screen instead of looping. Cleared on a successful completion, and on a non-code
 * bounce.
 */
const AUTOLOGIN_SENTINEL_KEY = "solid-issues.autologin-attempted";

/**
 * MODULE-LEVEL once-guard so the autologin mount effect fires its redirect/complete
 * AT MOST ONCE per page, even under React StrictMode (which double-invokes mount
 * effects in dev). The sentinel + persisted-redirect record are the durable
 * cross-navigation guards; this in-memory latch additionally stops the SAME render
 * pass's double-mount from firing two redirects. Reset only by a full page load.
 */
let autologinEffectRan = false;

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

/** True when the URL carries an OAuth `?code` AND `?state` (a redirect return). */
export function hasAuthCodeParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") && params.has("state");
}

/**
 * True when the URL carries an OAuth `?error` AND `?state` (a FAILED redirect
 * return — e.g. `?error=login_required` / `?error=access_denied`: the broker
 * declined silent SSO or the user declined). The `state` is required so a stray
 * `error` query unrelated to our flow is not mistaken for a redirect return.
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
 * Whether autologin OWNS this page load — i.e. the mount effect should hand off to
 * the autologin effect and NOT run a silent refresh-grant restore (both would race
 * the same provider). True when a redirect is RETURNING (a persisted record + a
 * `?code`/`?error&state` on the URL) OR a fresh `#autologin/<webid>` deep-link is
 * present. Mirrors the conditions under which `planAutologin` yields a non-`none`
 * action (complete / abort-redirect / begin / clear-sentinel). Browser-only; on the
 * server (no `location`) it is conservatively false.
 */
function autologinOwnsLoad(): boolean {
  if (typeof location === "undefined") return false;
  const pending = hasPendingRedirectLogin();
  if (pending && (hasAuthCodeParams(location.search) || hasAuthErrorParams(location.search))) {
    return true;
  }
  if (!pending && parseAutologinFragment(location.hash) !== null) return true;
  return false;
}

function describeError(e: unknown): string {
  if (e instanceof NoStorageError) return e.message;
  if (e instanceof DOMException && e.name === "AbortError") {
    return "Login was cancelled.";
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong during login.";
}

export function SolidSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("initialising");
  const [profile, setProfile] = useState<SolidProfile | null>(null);
  const [storageUrl, setStorageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([]);
  const [storageChoices, setStorageChoices] = useState<string[]>([]);
  // True once the auth manager is wired (registerGlobally ran) AND the provider is
  // live. The autologin mount effect waits on this — it must never run a
  // begin/complete before the patched fetch + provider exist.
  const [ready, setReady] = useState(false);
  const pendingProfile = useRef<SolidProfile | null>(null);

  const flowRef = useRef<AuthCodeFlowElement | null>(null);
  const managerReady = useRef(false);
  // The WebID the user is logging in with — the provider's getWebId resolves this.
  const webIdRef = useRef<string | null>(null);
  const recentRef = useRef<RecentAccounts | null>(null);
  // The live token provider, so silent restore can drive a refresh-grant on it.
  const providerRef = useRef<WebIdDPoPTokenProvider | null>(null);
  // The WebID whose refresh token we are persisting — `onSession` scopes the
  // saved record to it. Set before any auth flow that should persist a session.
  const persistWebIdRef = useRef<string | null>(null);
  // The current pod storage URL, mirrored in a ref so persistSession (a stable
  // callback) can read it synchronously when the provider emits a session.
  const storageUrlRef = useRef<string | null>(null);
  // The WebID of the currently-active session, so completeLogin can detect an
  // ACCOUNT SWITCH (a different WebID becoming active) and purge the prior
  // user's cached issue snapshots — defence in depth on top of the WebID-scoped
  // cache, so no prior identity's data lingers when a new one signs in.
  const activeWebIdRef = useRef<string | null>(null);

  // Persist a freshly (re)established session so a later reopen can silently
  // restore it (pss-203m). Scoped to the WebID set in persistWebIdRef — a
  // session emitted for one identity can never be saved under another.
  const persistSession = useCallback((session: RestorableSession) => {
    const webId = persistWebIdRef.current;
    if (!webId) return;
    void saveSession({
      webId,
      issuer: session.issuer,
      storageUrl: storageUrlRef.current ?? "",
      hasRefreshToken: session.refreshToken !== undefined,
      refreshExpiresAt: session.refreshExpiresAt,
      client: session.client as unknown as Record<string, unknown>,
      refreshToken: session.refreshToken,
      dpopKey: session.dpopKey,
    });
  }, []);

  const completeLogin = useCallback(async (loaded: SolidProfile, storage: string) => {
    // Account switch: a DIFFERENT WebID is becoming active. Purge the prior
    // user's cached issue snapshots so none of their (possibly private) issue
    // data can be painted under the new identity. Defence in depth: the cache is
    // also WebID-scoped, so a mismatched snapshot is already a miss — but clearing
    // here keeps the device free of the previous user's data outright.
    const previousWebId = activeWebIdRef.current;
    if (previousWebId && previousWebId !== loaded.webId) {
      clearAllIssueCaches();
    }
    activeWebIdRef.current = loaded.webId;

    // Scope refresh-token persistence to this identity + storage BEFORE the first
    // authenticated fetch below — that fetch is what drives the auth-code flow,
    // and the provider emits its session (with the refresh token) via onSession
    // mid-flight. Setting these first means the emitted session is saved correctly.
    persistWebIdRef.current = loaded.webId;
    storageUrlRef.current = storage;

    // First authenticated fetch: a private resource in the pod returns 401,
    // which transparently drives the login popup, then retries. A 404 (the
    // tracker doesn't exist yet) is success — the pod is reachable + authed.
    const trackerUrl = trackerDocumentUrl(storage);
    await new Repository(trackerUrl).loadTracker();

    setProfile(loaded);
    setStorageUrl(storage);
    setStatus("logged-in");

    // Make the tracker discoverable by other apps/people (best-effort, non-blocking).
    void registerTracker(loaded.webId, storage, trackerUrl);

    recentRef.current?.remember({
      webId: loaded.webId,
      displayName: loaded.name ?? loaded.webId,
      avatarUrl: undefined,
      storage,
    });
    if (recentRef.current) setRecentAccounts(recentRef.current.list());
  }, []);

  /**
   * Try to silently restore a persisted session via the refresh grant (pss-203m).
   * Shows a brief "restoring" state, then lands the user on their page on success,
   * or falls back to the login screen on a genuine failure. A dead token is
   * purged; a transient failure keeps it for a later retry.
   */
  const attemptSilentRestore = useCallback(
    async (provider: WebIdDPoPTokenProvider, isCancelled: () => boolean) => {
      const stored = await loadSession();
      if (isCancelled()) return;
      if (
        !stored ||
        !stored.refreshToken ||
        !shouldAttemptRestore({
          webId: stored.webId,
          issuer: stored.issuer,
          storageUrl: stored.storageUrl,
          hasRefreshToken: stored.hasRefreshToken,
          refreshExpiresAt: stored.refreshExpiresAt,
        })
      ) {
        setStatus("logged-out");
        return;
      }
      setStatus("restoring");
      // Scope any re-emitted (rotated) refresh token to this WebID, and let the
      // provider resolve the issuer to it without re-prompting.
      webIdRef.current = stored.webId;
      persistWebIdRef.current = stored.webId;
      storageUrlRef.current = stored.storageUrl;
      try {
        await provider.restore({
          issuer: stored.issuer,
          client: stored.client as never,
          dpopKey: stored.dpopKey,
          refreshToken: stored.refreshToken,
        });
        if (isCancelled()) return;
        // The access token is now seeded; load the profile + tracker as a normal login.
        const loaded = await loadProfile(stored.webId);
        if (isCancelled()) return;
        await completeLogin(loaded, stored.storageUrl);
      } catch (e) {
        if (isCancelled()) return;
        const outcome = classifyRestoreError(e);
        if (shouldClearStoredSession(outcome)) void clearSession();
        webIdRef.current = null;
        persistWebIdRef.current = null;
        setStatus("logged-out");
      }
    },
    [completeLogin],
  );

  // Patch globalThis.fetch exactly once, as early as possible (AGENTS.md §Authentication),
  // then attempt a silent session restore before ever showing the login screen.
  useEffect(() => {
    if (managerReady.current) return;
    let cancelled = false;
    (async () => {
      // 0.1.5+: the package ROOT no longer registers <authorization-code-flow> as a
      // side-effect — the `/registerElements` subpath does. Import it FIRST so the
      // custom element is defined before flowRef.current.getCode is used; without
      // this the element never upgrades and interactive login silently breaks.
      await import("@solid/reactive-authentication/registerElements");
      const { ReactiveFetchManager } = await import("@solid/reactive-authentication");
      const { WebIdDPoPTokenProvider } = await import("@/lib/webid-token-provider");
      const ui = flowRef.current;
      if (cancelled || !ui || managerReady.current) return;

      // Static client-id only when deployed (HTTPS): a remote IdP can't dereference
      // a localhost client-id document, so localhost falls back to dynamic
      // registration — which works against both local CSS and live servers.
      const host = location.hostname;
      const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      const clientId = isLoopback ? undefined : new URL("/clientid.jsonld", location.href).toString();

      const provider = new WebIdDPoPTokenProvider(
        new URL("/callback.html", location.href).toString(),
        ui.getCode.bind(ui),
        // getWebId — resolves to the WebID the user submitted via login() or the
        // WebID being silently restored.
        async () => {
          if (!webIdRef.current) throw new Error("No WebID provided.");
          return webIdRef.current;
        },
        { allowInsecureLoopback: true, onSession: persistSession, ...(clientId ? { clientId } : {}) },
      );
      providerRef.current = provider;
      // 0.1.3: the constructor does NOT patch globalThis.fetch — registerGlobally() does.
      const manager = new ReactiveFetchManager([provider]);
      manager.registerGlobally();
      managerReady.current = true;

      recentRef.current = new RecentAccounts();
      setRecentAccounts(recentRef.current.list());

      // The runtime is wired — let the autologin effect (which depends on `ready`)
      // run. If a Pod-Manager autologin redirect is RETURNING (?code/?error&state +
      // a persisted record) or a fresh `#autologin/<webid>` deep-link is present, the
      // autologin effect OWNS this load and we must NOT also run silent restore
      // (both would race the same provider). Otherwise fall through to silent restore.
      setReady(true);
      if (autologinOwnsLoad()) {
        // The autologin effect drives the status from here (autologin → logged-in,
        // or it cleans up + falls back to logged-out). Do not run silent restore.
        return;
      }

      // Silent session restore (pss-203m): if a refresh token was persisted on a
      // previous visit, re-establish the session WITHOUT a redirect/popup before
      // ever showing the login screen. Only a genuine failure (no token /
      // expired / revoked) drops to logged-out.
      await attemptSilentRestore(provider, () => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [persistSession, attemptSilentRestore]);

  // Land an autologin (the SHARED post-redirect step). After completeRedirectLogin
  // has established + verified the provider session, load the (now authenticated)
  // profile and run the SAME completeLogin path the popup + silent-restore use, so
  // storage selection / tracker / cache / refresh-token persistence all behave
  // identically. A multi-storage WebID that needs a choice falls back to the
  // login screen's choose-storage step rather than silently picking one.
  const landAutologin = useCallback(
    async (verifiedWebId: string) => {
      webIdRef.current = verifiedWebId;
      persistWebIdRef.current = verifiedWebId;
      const loaded = await loadProfile(verifiedWebId);
      if (loaded.storageUrls.length === 0) throw new NoStorageError(verifiedWebId);
      if (loaded.storageUrls.length > 1) {
        const remembered = recentRef.current?.list().find((a) => a.webId === verifiedWebId)?.storage;
        if (!remembered || !loaded.storageUrls.includes(remembered)) {
          pendingProfile.current = loaded;
          setStorageChoices(loaded.storageUrls);
          setStatus("choose-storage");
          return;
        }
        await completeLogin(loaded, remembered);
        return;
      }
      await completeLogin(loaded, loaded.storageUrls[0]);
    },
    [completeLogin],
  );

  // ── AUTOLOGIN mount effect (full-page redirect deep-link / return) ───────────
  //
  // The DECISION (what to do given the URL + persisted/sentinel state + login state)
  // is the PURE `planAutologin`; this effect only EXECUTES the chosen action (URL
  // cleaning, provider calls, navigation). Keeping the decision pure makes the
  // security-critical scenarios unit-testable with no DOM (autologin-plan.test.ts).
  //
  // It runs AFTER the runtime is `ready`, ONLY when NOT already logged in: a
  // restored / active session WINS — `planAutologin` returns `none` when `loggedIn`.
  // The module-level `autologinEffectRan` latch + the persisted-redirect record +
  // the sessionStorage sentinel together make the body idempotent so at most one
  // redirect/complete fires (also covers React StrictMode's dev double-mount).
  useEffect(() => {
    const provider = providerRef.current;
    const action = planAutologin({
      ready,
      hasProvider: provider !== null,
      loggedIn: status === "logged-in",
      effectAlreadyRan: autologinEffectRan,
      hasPendingRedirect: hasPendingRedirectLogin(),
      pendingRedirectWebId: consumePendingRedirectWebId(),
      hasCodeParams: hasAuthCodeParams(location.search),
      hasErrorParams: hasAuthErrorParams(location.search),
      fragmentWebId: parseAutologinFragment(location.hash),
      sentinel: readAutologinSentinel(),
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
      setStatus("logged-out");
      return;
    }

    // ABORT — returning from the full-page redirect with an OAuth ERROR
    // (?error&state: the broker declined silent SSO / the user declined). Without
    // this the error return is ignored and the persisted record + DPoP key + sentinel
    // + the error query all leak, BLOCKING future autologins. Clean EVERYTHING up and
    // surface the error once — do NOT loop, do NOT spew.
    if (action.kind === "abort-redirect") {
      const errParams = new URLSearchParams(location.search);
      const oauthError = errParams.get("error");
      // Drop the persisted record (the single-use PKCE verifier + exported DPoP key)
      // WITHOUT a token exchange — there is no code to exchange on an error return.
      provider.abortRedirectLogin();
      clearAutologinSentinel();
      webIdRef.current = null;
      persistWebIdRef.current = null;
      history.replaceState(null, "", cleanedUrl(location.href));
      setError(
        `Automatic sign-in was declined or unavailable${
          oauthError ? ` (${oauthError})` : ""
        } — please sign in.`,
      );
      setStatus("logged-out");
      return;
    }

    // CASE A — returning from the full-page redirect: complete the persisted login.
    if (action.kind === "complete") {
      const callbackUrl = location.href;
      const targetWebId = action.webId;
      // Clean the URL IMMEDIATELY so a refresh cannot replay the code/state.
      history.replaceState(null, "", cleanedUrl(callbackUrl));
      setError(null);
      setStatus("autologin");
      provider
        .completeRedirectLogin(callbackUrl)
        .then(async (result) => {
          // completeRedirectLogin already PROVED the OP authenticated AS flow.webId
          // (fail-closed). Defence in depth: confirm it also equals the persisted
          // target the planner carried, then land via the shared completeLogin path.
          if (targetWebId && !webIdsEqual(result.webId, targetWebId)) {
            throw new Error(
              "Autologin completed for an unexpected WebID — you were not logged in.",
            );
          }
          await landAutologin(result.webId);
          clearAutologinSentinel(); // success → clean slate for next time.
        })
        .catch((e) => {
          // Failure: the persisted record is already cleared by completeRedirectLogin;
          // drop the sentinel + fall back to the login screen with a single error.
          clearAutologinSentinel();
          webIdRef.current = null;
          persistWebIdRef.current = null;
          setError(describeError(e));
          setStatus("logged-out");
        });
      return;
    }

    // CASE B — fresh autologin deep-link: begin the full-page redirect.
    const targetWebId = action.webId;
    // Clean the URL (strip the fragment) BEFORE anything else, so a refresh /
    // redirect-bounce can't re-trigger and the WebID isn't left in the address bar.
    history.replaceState(null, "", cleanedUrl(location.href));
    setAutologinSentinel(targetWebId);
    // Resolve the provider's getWebId to the deep-link target for this redirect.
    webIdRef.current = targetWebId;
    persistWebIdRef.current = targetWebId;
    setError(null);
    setStatus("autologin");

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
        webIdRef.current = null;
        persistWebIdRef.current = null;
        setError(describeError(e));
        setStatus("logged-out");
      });
    // `status` is a dep so a logout (→ logged-out) does NOT re-trigger autologin —
    // the once-guard + the cleaned URL (no fragment / no code) keep it inert.
  }, [ready, status, landAutologin]);

  const login = useCallback(async (webIdInput: string) => {
    setError(null);
    setStatus("authenticating");
    const webId = webIdInput.trim();
    webIdRef.current = webId;
    try {
      // 1. Public profile read (no auth) → display name, avatar, storage.
      const loaded = await loadProfile(webId);
      if (loaded.storageUrls.length === 0) throw new NoStorageError(webId);

      // Multiple pim:storage values: never pick silently (AGENTS.md §discovery).
      // A previously remembered choice for this account is honoured; otherwise ask.
      if (loaded.storageUrls.length > 1) {
        const remembered = recentRef.current?.list().find((a) => a.webId === webId)?.storage;
        if (!remembered || !loaded.storageUrls.includes(remembered)) {
          pendingProfile.current = loaded;
          setStorageChoices(loaded.storageUrls);
          setStatus("choose-storage");
          return;
        }
        await completeLogin(loaded, remembered);
        return;
      }
      await completeLogin(loaded, loaded.storageUrls[0]);
    } catch (e) {
      webIdRef.current = null;
      setError(describeError(e));
      setStatus("error");
    }
  }, [completeLogin]);

  const chooseStorage = useCallback(async (storage: string) => {
    const loaded = pendingProfile.current;
    if (!loaded) return;
    setStatus("authenticating");
    try {
      await completeLogin(loaded, storage);
      pendingProfile.current = null;
      setStorageChoices([]);
    } catch (e) {
      setError(describeError(e));
      setStatus("error");
    }
  }, [completeLogin]);

  const logout = useCallback(() => {
    // Tokens live in memory in the fetch manager; a reload is the clean way to
    // drop them (skill: solid-reactive-authentication §Sessions). Recent accounts
    // persist in localStorage and survive the reload.
    //
    // Logging out MUST also drop the persisted refresh token (so the next reopen
    // does NOT silently restore) and the cached issue snapshots (so a signed-out
    // device leaves no pod data behind). Clear them, then reload once cleared.
    setProfile(null);
    setStorageUrl(null);
    setStatus("logged-out");
    persistWebIdRef.current = null;
    storageUrlRef.current = null;
    activeWebIdRef.current = null;
    clearAllIssueCaches();
    void clearSession().finally(() => window.location.reload());
  }, []);

  const forgetAccount = useCallback((webId: string) => {
    recentRef.current?.forget(webId);
    if (recentRef.current) setRecentAccounts(recentRef.current.list());
  }, []);

  const value: SolidSession = {
    status,
    profile,
    storageUrl,
    trackerUrl: storageUrl ? trackerDocumentUrl(storageUrl) : null,
    error,
    recentAccounts,
    storageChoices,
    login,
    chooseStorage,
    logout,
    forgetAccount,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
      {/* Registered via the "@solid/reactive-authentication/registerElements"
          side-effect import (in the fetch-patch effect above) + driven by
          @solid/reactive-authentication; visually hidden. */}
      <authorization-code-flow
        ref={flowRef as unknown as React.Ref<HTMLElement>}
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      />
    </SessionContext.Provider>
  );
}

export function useSolidSession(): SolidSession {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSolidSession must be used within SolidSessionProvider");
  return ctx;
}
