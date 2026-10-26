// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * The credential helper's operations. Only `login` opens a listener (and, with `--open`, a
 * browser); nothing else ever starts a sign-in. `accessToken` is the one place a token is
 * produced, for the helper protocol and the in-process inventory command; no other operation
 * returns or prints token material.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { z } from "zod";
import {
  authorizationUrl,
  type ClientInfo,
  exchangeCode,
  listCalendars,
  normaliseScopes,
  pkce,
  randomToken,
  refresh,
  requiredScopes,
  revokeGoogle,
  sameSecret,
  type Transport,
  tenantMatches,
  verifyIdentity,
} from "./providers.js";
import { type CredentialStore, type Grant, HelperError, type Profile } from "./store.js";

export interface Deps {
  store: CredentialStore;
  transport: Transport;
  now: () => Date;
}

export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const MAX_STRAY_CALLBACKS = 20;
/** A cached access token is used only while it has at least this long left. */
const ACCESS_MARGIN_MS = 2 * 60_000;

export function loadProfile(store: CredentialStore, name: string): Profile {
  const p = store.profile(name);
  if (!p)
    throw new HelperError("setup", `no profile “${name}” (create it with: profile add --name …)`);
  return p;
}

export function clientFor(store: CredentialStore, p: Profile): ClientInfo {
  const c = p.provider === "google" ? store.googleClient() : store.microsoftClient();
  if (!c)
    throw new HelperError(
      "setup",
      `no ${p.provider === "google" ? "Google" : "Microsoft"} OAuth client is registered (see: client ${p.provider})`,
    );
  return { clientId: c.clientId, clientSecret: "clientSecret" in c ? c.clientSecret : undefined };
}

const missing = (granted: readonly string[], needed: readonly string[]) =>
  needed.filter((s) => !granted.includes(s));

// ------------------------------------------------------------------ login (explicit only)

export interface LoginResult {
  profile: string;
  provider: Profile["provider"];
  account: { username: string; subjectPinned: boolean; tenant?: string };
  grantedScopes: string[];
  extraScopes: string[];
  replacedExisting: boolean;
}

/** Wait for ONE callback carrying our state; stray/forged callbacks are answered and ignored. */
function awaitCallback(
  servers: readonly Server[],
  expect: { state: string; hosts: string[] },
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    let stray = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new HelperError("unavailable", "no sign-in response in time; nothing was stored")),
        ),
      timeoutMs,
    );
    const page = (res: ServerResponse, status: number, text: string) => {
      res.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      res.end(text);
    };
    const handle = (req: IncomingMessage, res: ServerResponse) => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://callback.invalid");
      } catch {
        page(res, 400, "Malformed sign-in response; it was ignored.");
        return;
      }
      if (
        done ||
        req.method !== "GET" ||
        url.pathname !== "/" ||
        !expect.hosts.includes(String(req.headers.host ?? ""))
      ) {
        page(res, 404, "Not found.");
        return;
      }
      const state = url.searchParams.get("state") ?? "";
      if (!sameSecret(state, expect.state)) {
        page(
          res,
          400,
          "This sign-in response does not belong to the current login; it was ignored.",
        );
        if (++stray > MAX_STRAY_CALLBACKS)
          finish(() =>
            reject(new HelperError("refused", "too many unexpected sign-in responses; stopped")),
          );
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        page(res, 400, "Sign-in was not completed. You can close this tab.");
        const reason = (error ?? "no code").replace(/[^a-z_ ]/gi, "").slice(0, 40);
        finish(() => reject(new HelperError("refused", `sign-in was not completed (${reason})`)));
        return;
      }
      page(res, 200, "Sign-in received. You can close this tab and return to the terminal.");
      finish(() => resolve({ code }));
    };
    for (const s of servers) s.on("request", handle);
    signal.addEventListener("abort", () =>
      finish(() => reject(new HelperError("unavailable", "login stopped"))),
    );
  });
}

async function listen(server: Server, host: string, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

/**
 * Interactive sign-in for one profile (installed-app loopback flow with PKCE, RFC 8252). The
 * listener binds to loopback only, on a random port, accepts one response carrying the random
 * single-use state, and closes. Nothing is stored unless the ID token proves the chosen account,
 * the calendar scopes were granted and a refresh token was issued; an existing grant for another
 * account is never overwritten.
 */
export async function login(
  deps: Deps,
  name: string,
  opts: { timeoutMs?: number; onUrl: (url: string) => void | Promise<void> },
): Promise<LoginResult> {
  const p = loadProfile(deps.store, name);
  const client = clientFor(deps.store, p);
  let before: Grant | undefined;
  try {
    before = deps.store.grant(name);
  } catch (error) {
    // A corrupt grant file is not silently replaced.
    throw new HelperError(
      "invalid",
      `the existing grant cannot be read (${(error as Error).message}); remove it with logout first`,
    );
  }
  const servers: Server[] = [createServer()];
  const stop = new AbortController();
  try {
    const port = await listen(servers[0] as Server, "127.0.0.1", 0);
    const hostName = p.provider === "google" ? "127.0.0.1" : "localhost";
    if (hostName === "localhost") {
      // Browsers may resolve localhost to ::1 first; listen there too when available.
      const v6 = createServer();
      try {
        await listen(v6, "::1", port);
        servers.push(v6);
      } catch {
        await close(v6);
      }
    }
    const redirectUri = `http://${hostName}:${port}`;
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = pkce();
    const wait = awaitCallback(
      servers,
      { state, hosts: [`${hostName}:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`] },
      opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS,
      stop.signal,
    );
    wait.catch(() => undefined); // observed below; avoids an unhandled rejection meanwhile
    await opts.onUrl(authorizationUrl(p, client, { redirectUri, state, nonce, challenge }));
    const { code } = await wait;
    // Single use: the listener closes as soon as the one response arrived.
    await Promise.all(servers.map(close));

    const answer = await exchangeCode(deps.transport, p, client, { code, redirectUri, verifier });
    const account = await verifyIdentity(
      deps.transport,
      p,
      client,
      answer.id_token,
      nonce,
      before,
      deps.now(),
    );
    const granted = normaliseScopes(p.provider, answer.scope);
    const lacking = missing(granted, requiredScopes(p));
    if (lacking.length > 0)
      throw new HelperError(
        "scope",
        `the consent did not include ${lacking.join(", ")}; nothing was stored (sign in again and allow calendar access)`,
      );
    if (!answer.refresh_token)
      throw new HelperError(
        "revoked",
        "the provider issued no refresh token; nothing was stored. Remove this app's access in the account's security settings, then log in again.",
      );
    const now = deps.now();
    const result = await deps.store.withLock(name, async () => {
      // Re-check under the lock: another login may have pinned a different account meanwhile.
      const current = deps.store.grant(name);
      if (
        current &&
        (current.account.subject !== account.subject || current.account.tenant !== account.tenant)
      )
        throw new HelperError(
          "account",
          "this profile's grant is pinned to a different account; it was not overwritten",
        );
      const grant: Grant = {
        version: 1,
        profile: name,
        provider: p.provider,
        purpose: p.purpose,
        resource: p.resource,
        clientId: client.clientId,
        account,
        grantedScopes: granted,
        state: "active",
        refreshToken: answer.refresh_token,
        access: {
          token: answer.access_token,
          expiresAt: new Date(now.getTime() + answer.expires_in * 1000).toISOString(),
        },
        obtainedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      deps.store.putGrant(grant);
      return current !== undefined;
    });
    const identityScopes = new Set([
      "openid",
      "email",
      "profile",
      "offline_access",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
    return {
      profile: name,
      provider: p.provider,
      account: {
        username: account.username,
        subjectPinned: true,
        ...(account.tenant ? { tenant: account.tenant } : {}),
      },
      grantedScopes: granted,
      extraScopes: granted.filter((s) => !requiredScopes(p).includes(s) && !identityScopes.has(s)),
      replacedExisting: result,
    };
  } finally {
    stop.abort();
    await Promise.all(servers.map(close));
  }
}

// ------------------------------------------------------------------ access tokens

export interface IssuedToken {
  token: string;
  expiresAt: string;
  scopes: string[];
}

function usable(g: Grant, now: Date): IssuedToken | undefined {
  if (g.state !== "active" || !g.access) return undefined;
  const expires = Date.parse(g.access.expiresAt);
  // NaN (an unreadable time) must never pass as "still valid".
  if (!Number.isFinite(expires) || !(expires - now.getTime() >= ACCESS_MARGIN_MS)) return undefined;
  return { token: g.access.token, expiresAt: g.access.expiresAt, scopes: g.grantedScopes };
}

/**
 * Whether a stored grant really belongs to this profile: the file name is not proof. The grant
 * must name the profile, its provider, the profile's chosen account (and, for Microsoft, a tenant
 * of the chosen account type), and the OAuth client currently registered — a grant never
 * migrates silently to another account or client.
 */
export function grantBindingProblem(
  g: Grant,
  p: Profile,
  clientId: string | undefined,
): string | undefined {
  const identity = p.microsoft?.expectedIdentity;
  if (g.profile !== p.name) return "the grant record belongs to another profile";
  if (g.purpose !== p.purpose || g.resource !== p.resource)
    return "the grant record is for another purpose or resource";
  if (g.provider !== p.provider) return "the grant record is for another provider";
  if (g.account.username !== p.account.toLowerCase())
    return "the grant record is for another account than this profile's chosen account";
  if (p.provider === "google" && g.account.tenant !== undefined)
    return "the grant record carries a tenant (not a Google grant)";
  if (
    p.provider === "microsoft" &&
    (!p.microsoft || !g.account.tenant || !tenantMatches(p.microsoft.tenant, g.account.tenant))
  )
    return "the grant record's tenant does not match the profile's account type/tenant";
  if (p.provider === "microsoft") {
    if (
      !identity ||
      g.account.tenant !== identity.tenantId ||
      g.account.subject !== identity.objectId
    )
      return "the grant record does not match a trusted Microsoft tenant/object identity";
  }
  if (clientId !== undefined && g.clientId !== clientId)
    return "the grant was issued to a different OAuth client than the one registered (log in again)";
  return undefined;
}

function checkBinding(g: Grant, p: Profile, client: ClientInfo): void {
  if (missing(g.grantedScopes, requiredScopes(p)).length)
    throw new HelperError("scope", "required scopes missing from grant");
  const problem = grantBindingProblem(g, p, client.clientId);
  if (!problem) return;
  throw new HelperError(
    problem.includes("OAuth client") ? "revoked" : "invalid",
    `${problem}; it was not used`,
  );
}

/**
 * A short-lived access token for the profile, refreshing it under the profile lock (so that
 * concurrent callers refresh once, and a rotated refresh token is never lost). A refused refresh
 * (invalid_grant) marks the grant as needing re-consent and removes its tokens.
 */
export async function accessToken(deps: Deps, name: string): Promise<IssuedToken> {
  const p = loadProfile(deps.store, name);
  const client = clientFor(deps.store, p);
  const first = deps.store.grant(name);
  if (!first) throw new HelperError("revoked", "no grant for this profile (log in first)");
  checkBinding(first, p, client);
  if (first.state !== "active")
    throw new HelperError(
      "revoked",
      `the grant needs re-consent (${first.problem ?? "log in again"})`,
    );
  const cached = usable(first, deps.now());
  if (cached) return cached;
  return deps.store.withLock(name, async () => {
    // Re-read under the lock (another process may have changed it) and re-check the binding.
    const g = deps.store.grant(name);
    if (g?.state !== "active")
      throw new HelperError("revoked", "the grant needs re-consent (log in again)");
    checkBinding(g, p, client);
    const again = usable(g, deps.now());
    if (again) return again; // refreshed by another process meanwhile
    if (!g.refreshToken) throw new HelperError("revoked", "no refresh token (log in again)");
    let answer: Awaited<ReturnType<typeof refresh>>;
    try {
      answer = await refresh(deps.transport, p, client, g.refreshToken);
    } catch (error) {
      if (error instanceof HelperError && error.code === "revoked") {
        const { refreshToken: _r, access: _a, ...rest } = g;
        deps.store.putGrant({
          ...rest,
          state: "needs-reconsent",
          problem: "the provider refused the refresh token (revoked, expired or password changed)",
          updatedAt: deps.now().toISOString(),
        });
      }
      throw error;
    }
    const granted = normaliseScopes(p.provider, answer.scope);
    const lacking = missing(granted, requiredScopes(p));
    const now = deps.now();
    if (lacking.length > 0) {
      const { access: _a, ...rest } = g;
      deps.store.putGrant({
        ...rest,
        grantedScopes: granted,
        state: "needs-reconsent",
        problem: `the grant no longer includes ${lacking.join(", ")}`,
        updatedAt: now.toISOString(),
      });
      throw new HelperError("scope", `the grant no longer includes ${lacking.join(", ")}`);
    }
    const next: Grant = {
      ...g,
      grantedScopes: granted,
      // Microsoft rotates refresh tokens: the new one replaces the old (atomically).
      refreshToken: answer.refresh_token ?? g.refreshToken,
      access: {
        token: answer.access_token,
        expiresAt: new Date(now.getTime() + answer.expires_in * 1000).toISOString(),
      },
      updatedAt: now.toISOString(),
    };
    deps.store.putGrant(next);
    return {
      token: answer.access_token,
      expiresAt: (next.access as { expiresAt: string }).expiresAt,
      scopes: granted,
    };
  });
}

// ------------------------------------------------------------------ helper protocol

const helperRequest = z.strictObject({
  purpose: z.enum(["read", "send"]).default("read"),
  provider: z.enum(["google", "microsoft"]),
  connectionId: z.string().max(64),
  scopes: z.array(z.string().max(300)).max(10),
});

/** Exit codes of the helper protocol (docs/PROVIDER-ACTIONS.md §3). */
export const EXIT = { ok: 0, unavailable: 1, refused: 2, revoked: 3 } as const;

/**
 * One helper-protocol exchange: the action's request (stdin) → the token JSON (stdout). The
 * request must match the profile (provider, connection) and ask only for granted scopes.
 */
export async function helperExchange(
  deps: Deps,
  name: string,
  requestText: string,
): Promise<{ exit: number; stdout?: string; problem?: string }> {
  let req: z.infer<typeof helperRequest>;
  try {
    req = helperRequest.parse(JSON.parse(requestText));
  } catch {
    return { exit: EXIT.refused, problem: "unreadable request" };
  }
  try {
    const p = loadProfile(deps.store, name);
    if (
      p.purpose !== req.purpose ||
      p.provider !== req.provider ||
      p.connectionId !== req.connectionId
    )
      return { exit: EXIT.refused, problem: "the request is not for this profile's account" };
    const t = await accessToken(deps, name);
    const lacking = missing(t.scopes, req.scopes);
    if (lacking.length > 0) return { exit: EXIT.revoked, problem: "scope not granted" };
    return {
      exit: EXIT.ok,
      stdout: JSON.stringify({
        access_token: t.token,
        expires_at: t.expiresAt,
        scope: t.scopes.join(" "),
      }),
    };
  } catch (error) {
    const code = error instanceof HelperError ? error.code : "unavailable";
    return {
      exit:
        code === "revoked" || code === "scope" || code === "setup"
          ? EXIT.revoked
          : code === "refused" || code === "invalid"
            ? EXIT.refused
            : EXIT.unavailable,
      problem: error instanceof HelperError ? error.message : "unavailable",
    };
  }
}

// ------------------------------------------------------------------ inventory, logout, status

export async function calendars(deps: Deps, name: string) {
  const p = loadProfile(deps.store, name);
  if (p.purpose !== "read" || p.resource !== "calendar")
    throw new HelperError("scope", "calendar inventory requires a calendar read profile");
  if (p.provider === "google" && !p.inventory)
    throw new HelperError(
      "scope",
      "this Google profile does not request the calendar-list scope (create a profile with --calendar-inventory and log in)",
    );
  const t = await accessToken(deps, name);
  return listCalendars(deps.transport, p, t.token);
}

/**
 * Forget the local grant. With `revoke` (explicit operator action; Google only) the refresh token
 * is revoked at Google first. Microsoft has no token revocation endpoint for this kind of app:
 * access is removed in the account's app settings.
 */
export async function logout(
  deps: Deps,
  name: string,
  revoke: boolean,
): Promise<{ removed: boolean; revoked: boolean; remains: string }> {
  const p = loadProfile(deps.store, name);
  return deps.store.withLock(name, async () => {
    const g = deps.store.grant(name);
    let revoked = false;
    if (revoke && g?.refreshToken && p.provider === "google") {
      // Only a grant that really belongs to this profile is revoked at the provider.
      const problem = grantBindingProblem(g, p, undefined);
      if (problem)
        throw new HelperError("invalid", `${problem}; not revoked (use logout without --revoke)`);
      await revokeGoogle(deps.transport, g.refreshToken);
      revoked = true;
    }
    const removed = deps.store.removeGrant(name);
    const remains = revoked
      ? "Revoked at Google and removed locally."
      : p.provider === "google"
        ? "Removed locally. The consent still exists at Google until you revoke it (logout --revoke, or https://myaccount.google.com/connections)."
        : "Removed locally. The consent still exists at Microsoft until you remove the app (personal: https://account.live.com/consent/Manage; work/school: https://myapps.microsoft.com).";
    return { removed, revoked, remains };
  });
}

export interface ProfileStatus {
  profile: string;
  provider: Profile["provider"];
  connectionId: string;
  chosenAccount: string;
  accountType?: string;
  requestedScopes: string[];
  client: "registered" | "missing";
  grant:
    | { state: "none" }
    | { state: "unreadable"; problem: string }
    | {
        state: Grant["state"];
        verifiedAccount: string;
        subjectPinned: true;
        grantedScopes: string[];
        refreshToken: "present" | "absent";
        /** "ok", or why the record is not used for this profile (account/tenant/client). */
        binding: string;
        accessTokenValidUntil?: string;
        problem?: string;
        obtainedAt: string;
        updatedAt: string;
      };
}

/** A safe summary: never a token, secret or client secret. */
export function status(
  store: CredentialStore,
  requested: (p: Profile) => string[],
): {
  clients: { google: string; microsoft: string };
  profiles: ProfileStatus[];
} {
  const safe = <T>(fn: () => T): T | Error => {
    try {
      return fn();
    } catch (error) {
      return error as Error;
    }
  };
  const g = safe(() => store.googleClient());
  const m = safe(() => store.microsoftClient());
  const clients = {
    google:
      g instanceof Error
        ? `unreadable: ${g.message}`
        : g
          ? `registered (client …${g.clientId.split(".")[0]?.slice(-6)}; secret ${g.clientSecret ? "present, not shown" : "absent"})`
          : "not registered",
    microsoft:
      m instanceof Error
        ? `unreadable: ${m.message}`
        : m
          ? `registered (client …${m.clientId.slice(-6)})`
          : "not registered",
  };
  const profiles: ProfileStatus[] = [];
  for (const name of store.profiles()) {
    const p = safe(() => store.profile(name));
    if (!p || p instanceof Error) continue;
    const gr = safe(() => store.grant(name));
    const c = p.provider === "google" ? g : m;
    const clientId = c && !(c instanceof Error) ? c.clientId : undefined;
    profiles.push({
      profile: name,
      provider: p.provider,
      connectionId: p.connectionId,
      chosenAccount: p.account,
      ...(p.microsoft ? { accountType: `${p.microsoft.accountType} (${p.microsoft.tenant})` } : {}),
      requestedScopes: requested(p),
      client:
        (p.provider === "google" ? g : m) && !((p.provider === "google" ? g : m) instanceof Error)
          ? "registered"
          : "missing",
      grant:
        gr instanceof Error
          ? { state: "unreadable", problem: gr.message }
          : !gr
            ? { state: "none" }
            : {
                state: gr.state,
                verifiedAccount: gr.account.username,
                subjectPinned: true,
                grantedScopes: gr.grantedScopes,
                refreshToken: gr.refreshToken ? "present" : "absent",
                binding: grantBindingProblem(gr, p, clientId) ?? "ok",
                ...(gr.access ? { accessTokenValidUntil: gr.access.expiresAt } : {}),
                ...(gr.problem ? { problem: gr.problem } : {}),
                obtainedAt: gr.obtainedAt,
                updatedAt: gr.updatedAt,
              },
    });
  }
  return { clients, profiles };
}
